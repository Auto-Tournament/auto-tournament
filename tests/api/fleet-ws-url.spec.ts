import type { Request } from 'express';
import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  createPendingServer,
  enrollBody,
  newInstallId,
  resetEnrollRateLimit,
} from '../helpers/fleet';
import { createPendingHost, newMachineId } from '../helpers/fleetHost';
import {
  configuredPublicOrigin,
  publicOrigin,
  publicWsOrigin,
} from '../../api/src/utils/publicOrigin';

/**
 * The `ws_url` a machine gets back from enrollment (utils/publicOrigin.ts).
 * Behind a TLS proxy the API itself sees plain http; it must still hand out
 * wss:// when the proxy says the client came in over https
 * (X-Forwarded-Proto), and FRONTEND_BASE_URL, when set to a real address,
 * wins over the request. csm refuses a ws:// URL to a public host.
 *
 * @tag api
 * @tag fleet
 */

function fakeReq(protocol: string, host: string): Request {
  return {
    protocol,
    get: (h: string) => (h.toLowerCase() === 'host' ? host : undefined),
  } as unknown as Request;
}

test.describe('public origin (no server)', () => {
  test('the request origin when no public URL is configured', () => {
    expect(publicOrigin(fakeReq('http', 'cs.example.com'), {})).toBe('http://cs.example.com');
    expect(publicWsOrigin(fakeReq('https', 'cs.example.com'), {})).toBe('wss://cs.example.com');
    expect(publicWsOrigin(fakeReq('http', '10.0.0.5:3069'), {})).toBe('ws://10.0.0.5:3069');
  });

  test('a configured FRONTEND_BASE_URL wins over the request', () => {
    const env = { FRONTEND_BASE_URL: 'https://cs.sivert.io/' };
    expect(publicOrigin(fakeReq('http', 'cs.sivert.io'), env)).toBe('https://cs.sivert.io');
    expect(publicWsOrigin(fakeReq('http', 'cs.sivert.io'), env)).toBe('wss://cs.sivert.io');
    expect(publicWsOrigin(fakeReq('http', '192.168.1.10:3069'), env)).toBe('wss://cs.sivert.io');
    expect(
      publicWsOrigin(fakeReq('http', 'x'), { FRONTEND_BASE_URL: 'http://192.168.1.10:3069' })
    ).toBe('ws://192.168.1.10:3069');
    expect(configuredPublicOrigin({ FRONTEND_BASE_URL: 'cs.sivert.io' })).toBe(
      'https://cs.sivert.io'
    );
  });

  test('a loopback or junk FRONTEND_BASE_URL is ignored (compose defaults it to localhost)', () => {
    for (const v of [
      'http://localhost:3069',
      'http://127.0.0.1:3000',
      'http://[::1]:3069',
      'http://app.localhost',
      '',
      '   ',
      'ftp://x',
      'http://',
    ]) {
      expect(configuredPublicOrigin({ FRONTEND_BASE_URL: v }), v).toBeNull();
    }
    expect(
      publicWsOrigin(fakeReq('https', 'cs.example.com'), {
        FRONTEND_BASE_URL: 'http://localhost:3069',
      })
    ).toBe('wss://cs.example.com');
  });
});

test.describe.serial('enrollment ws_url behind a TLS proxy', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test('server enrollment: X-Forwarded-Proto https gives wss://', async ({ request }) => {
    const { code } = await createPendingServer(request, 'ws-url-proxy');
    const res = await request.post('/api/fleet/enroll', {
      data: enrollBody({ code }, newInstallId()),
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(201);
    expect(body.ws_url).toMatch(/^wss:\/\/.+\/api\/fleet\/ws$/);
  });

  test('host enrollment and the link command: X-Forwarded-Proto https gives wss:// and https://', async ({
    request,
  }) => {
    const created = await request.post('/api/fleet/hosts', {
      data: { name: 'ws-url-proxy-host' },
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const pending = await created.json();
    expect(pending.command).toMatch(new RegExp(`^csm link https://\\S+ ${pending.code}$`));

    const res = await request.post('/api/fleet/enroll', {
      data: {
        kind: 'host',
        code: pending.code,
        machine_id: newMachineId(),
        hostname: 'csm-box',
        os: 'Ubuntu 24.04',
        csm_version: '2.0.0',
      },
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(201);
    expect(body.ws_url).toMatch(/^wss:\/\/.+\/api\/fleet\/host$/);
  });

  test('without the header it stays ws:// (plain http, no public URL configured)', async ({
    request,
  }) => {
    const pending = await createPendingHost(request, 'ws-url-plain-host');
    // Plain http: the link command carries csm's explicit --insecure opt-in.
    expect(pending.command).toMatch(
      new RegExp(`^csm link http://\\S+ ${pending.code} --insecure$`)
    );
    const res = await request.post('/api/fleet/enroll', {
      data: {
        kind: 'host',
        code: pending.code,
        machine_id: newMachineId(),
        hostname: 'csm-box',
        os: 'Ubuntu 24.04',
        csm_version: '2.0.0',
      },
    });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(201);
    expect(body.ws_url).toMatch(/^ws:\/\/.+\/api\/fleet\/host$/);
  });
});
