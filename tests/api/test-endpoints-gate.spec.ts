import { test, expect } from '@playwright/test';
import type { Request, Response } from 'express';
import {
  isLoopbackAddress,
  requireLoopback,
  requireTestEndpoints,
  testEndpointsFlag,
} from '../../api/src/utils/testEndpoints';
import testRoutes from '../../api/src/routes/test';
import { fakeEventRoutes } from '../../api/src/integrations/fake/routes';
import { manualReportTestRoutes } from '../../api/src/integrations/manual-report/routes';
import { routeTable } from '../../api/src/routes/routeTable';

/**
 * The /api/test helpers: on only with ENABLE_TEST_ENDPOINTS, whatever
 * NODE_ENV says; the ones that sign someone in or seed admin access also
 * answer only a loopback peer (the socket's address, not X-Forwarded-For).
 *
 * @tag api
 * @tag auth
 */

const TAGS = { tag: ['@api', '@auth'] };

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function run(
  mw: (req: Request, res: Response, next: () => void) => void,
  req: Partial<Request>
): { status?: number; next: boolean } {
  const out: { status?: number; next: boolean } = { next: false };
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  mw(req as Request, res, () => {
    out.next = true;
  });
  return out;
}

function routeStack(method: string, path: string): string[] {
  const layer = (
    testRoutes as unknown as {
      stack: Array<{
        route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name?: string }> };
      }>;
    }
  ).stack.find((l) => l.route?.path === path && l.route.methods[method]);
  return layer?.route?.stack.map((h) => h.name ?? '') ?? [];
}

test.describe('test endpoints gate', () => {
  test('off without the flag, in development too', TAGS, () => {
    for (const NODE_ENV of ['development', 'test', undefined]) {
      withEnv({ NODE_ENV, ENABLE_TEST_ENDPOINTS: undefined }, () => {
        expect(testEndpointsFlag(), `NODE_ENV=${NODE_ENV}`).toBe(false);
        const gate = requireTestEndpoints({ tier: 'production', body: { success: false } });
        expect(run(gate, {})).toEqual({ status: 403, next: false });
      });
    }
    withEnv({ NODE_ENV: 'production', ENABLE_TEST_ENDPOINTS: 'true' }, () => {
      expect(testEndpointsFlag()).toBe(true);
    });
  });

  test('loopback is the socket peer, not a forwarded header', TAGS, () => {
    for (const a of ['127.0.0.1', '127.8.9.1', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackAddress(a), a).toBe(true);
    }
    for (const a of ['10.0.0.5', '192.168.1.11', '::ffff:10.0.0.5', 'fe80::1', '', undefined]) {
      expect(isLoopbackAddress(a), String(a)).toBe(false);
    }
    const remote = run(requireLoopback, {
      socket: { remoteAddress: '203.0.113.9' } as Request['socket'],
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    expect(remote).toEqual({ status: 403, next: false });
    const local = run(requireLoopback, {
      socket: { remoteAddress: '::ffff:127.0.0.1' } as Request['socket'],
    });
    expect(local.next).toBe(true);
  });

  test('the sign-in and admin-seeding helpers are loopback only', TAGS, () => {
    for (const path of [
      '/login-admin',
      '/login-player',
      '/env-import',
      '/setup-code',
      '/clear-admins',
    ]) {
      expect(routeStack('post', path), path).toContain('requireLoopback');
    }
  });

  test('every core helper is behind the flag', TAGS, () => {
    const first = (
      testRoutes as unknown as {
        stack: Array<{
          route?: unknown;
          handle: (req: Request, res: Response, next: () => void) => void;
        }>;
      }
    ).stack[0];
    expect(first.route).toBeUndefined();
    withEnv({ NODE_ENV: 'development', ENABLE_TEST_ENDPOINTS: undefined }, () => {
      expect(run(first.handle, {})).toEqual({ status: 404, next: false });
    });
  });

  test('the fake and manual-report test helpers need the flag too', TAGS, () => {
    for (const router of [fakeEventRoutes, manualReportTestRoutes]) {
      const gate = (
        router as unknown as {
          stack: Array<{
            name: string;
            handle: (req: Request, res: Response, next: () => void) => void;
          }>;
        }
      ).stack.find((l) => l.name === 'requireTestEndpoints');
      withEnv({ NODE_ENV: 'development', ENABLE_TEST_ENDPOINTS: undefined }, () => {
        expect(run(gate!.handle, {})).toEqual({ status: 403, next: false });
      });
    }
  });

  test('the CS2 test helpers need the flag in development too', TAGS, () => {
    type Layer = {
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response, next: () => void) => void }>;
      };
    };
    const stack = routeTable.flatMap((m) => (m.router as unknown as { stack: Layer[] }).stack);
    for (const path of ['/highlights/status', '/fleet/reset-enroll-rate-limit', '/stats-fixture']) {
      const layer = stack.find((l) => l.route?.path === path && l.route.methods.post);
      const handlers = layer!.route!.stack;
      const handler = handlers[handlers.length - 1].handle;
      withEnv({ NODE_ENV: 'development', ENABLE_TEST_ENDPOINTS: undefined }, () => {
        expect(run(handler, { body: {} }), path).toEqual({ status: 403, next: false });
      });
    }
  });
});
