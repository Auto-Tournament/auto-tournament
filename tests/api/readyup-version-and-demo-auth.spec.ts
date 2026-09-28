import { test, expect } from '@playwright/test';
import type { NextFunction, Request, Response } from 'express';
import { readyUpUpdateStatus, compareVersions } from '../../api/src/integrations/cs2/services/readyUpVersion';
import {
  getLatestReadyUpRelease,
  resetReadyUpReleaseCache,
} from '../../api/src/integrations/cs2/services/pluginVersionService';
import {
  createServerOrFleetTokenGuard,
  demoMapNumber,
  presentedFleetToken,
  FLEET_UPLOAD_SERVER_ID,
} from '../../api/src/integrations/cs2/fleet/uploadAuth';
import type { TokenCheck } from '../../api/src/integrations/cs2/fleet/registry';

/**
 * Ready Up support in the platform, without a database or server:
 * - the version status never warns while Ready Up has no release;
 * - a 404 from GitHub means "no release";
 * - demo upload accepts the old SERVER_TOKEN or a valid fleet token, and a
 *   fleet upload's 1-based map number becomes 0-based.
 *
 * @tag api
 */

const RELEASE = { version: '1.2.0', releaseUrl: 'https://github.com/Auto-Tournament/ready-up/releases/tag/v1.2.0' };

test.describe('Ready Up version status', () => {
  test('never outdated while there is no release', { tag: ['@api'] }, () => {
    for (const running of ['0.0.1', '9.9.9', null, undefined, 'weird']) {
      const s = readyUpUpdateStatus(running, null);
      expect(s.state).toBe('unknown');
      expect(s.latest).toBeNull();
    }
    expect(readyUpUpdateStatus('0.3.1', null).running).toBe('0.3.1');
  });

  test('compares against the latest release once one exists', { tag: ['@api'] }, () => {
    expect(readyUpUpdateStatus('1.1.9', RELEASE).state).toBe('outdated');
    expect(readyUpUpdateStatus('v1.2.0', RELEASE).state).toBe('current');
    expect(readyUpUpdateStatus('1.3.0', RELEASE).state).toBe('current'); // unreleased build: no warning
    expect(readyUpUpdateStatus(null, RELEASE).state).toBe('unknown');
    expect(readyUpUpdateStatus('dev-build', RELEASE).state).toBe('unknown');
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
  });

  test('a 404 from GitHub is "no release"; a release is parsed and cached', { tag: ['@api'] }, async () => {
    resetReadyUpReleaseCache();
    let calls = 0;
    const notFound = async () => {
      calls++;
      return { ok: false, status: 404, json: async () => ({}) };
    };
    expect(await getLatestReadyUpRelease({ fetchImpl: notFound })).toBeNull();
    expect(await getLatestReadyUpRelease({ fetchImpl: notFound })).toBeNull();
    expect(calls).toBe(1);

    const released = async (url: string) => {
      expect(url).toContain('/repos/Auto-Tournament/ready-up/releases/latest');
      return { ok: true, status: 200, json: async () => ({ tag_name: 'v1.2.0', html_url: RELEASE.releaseUrl }) };
    };
    expect(await getLatestReadyUpRelease({ forceRefresh: true, fetchImpl: released })).toEqual(RELEASE);

    resetReadyUpReleaseCache();
    const boom = async () => {
      throw new Error('network');
    };
    expect(await getLatestReadyUpRelease({ fetchImpl: boom })).toBeNull();
    resetReadyUpReleaseCache();
  });
});

function fakeReq(headers: Record<string, string>): Request {
  return { headers, path: '/x/upload' } as unknown as Request;
}

function fakeRes() {
  const state: { status?: number; body?: unknown; locals: Record<string, unknown> } = { locals: {} };
  const res = {
    locals: state.locals,
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, state };
}

async function run(headers: Record<string, string>, verify: (t: string) => Promise<TokenCheck>) {
  const guard = createServerOrFleetTokenGuard(verify);
  const { res, state } = fakeRes();
  let nexted = false;
  await guard(fakeReq(headers), res, (() => {
    nexted = true;
  }) as NextFunction);
  return { nexted, ...state };
}

const okFleet = (id: string) => async (): Promise<TokenCheck> =>
  ({ ok: true, server: { id } as never, token: {} as never });

test.describe('demo upload authentication', () => {
  test.beforeAll(() => {
    process.env.SERVER_TOKEN = 'legacy-secret';
  });

  test('the old SERVER_TOKEN still works and never touches the fleet check', { tag: ['@api'] }, async () => {
    let verified = false;
    const r = await run({ 'x-auto-tournament-token': 'legacy-secret' }, async () => {
      verified = true;
      return { ok: false, reason: 'bad' };
    });
    expect(r.nexted).toBe(true);
    expect(verified).toBe(false);
    expect(r.locals[FLEET_UPLOAD_SERVER_ID]).toBeUndefined();
  });

  test('wrong or missing old token is 401', { tag: ['@api'] }, async () => {
    for (const headers of [{ 'x-auto-tournament-token': 'nope' }, {}]) {
      const r = await run(headers, okFleet('s_1'));
      expect(r.nexted).toBe(false);
      expect(r.status).toBe(401);
    }
  });

  test('a valid fleet token is accepted and identifies the server', { tag: ['@api'] }, async () => {
    const r = await run({ 'x-auto-tournament-token': 'rus_abc123abc123_x' }, okFleet('s_7'));
    expect(r.nexted).toBe(true);
    expect(r.locals[FLEET_UPLOAD_SERVER_ID]).toBe('s_7');
    const bearer = await run({ authorization: 'Bearer rus_abc123abc123_x' }, okFleet('s_8'));
    expect(bearer.locals[FLEET_UPLOAD_SERVER_ID]).toBe('s_8');
  });

  test('an invalid or revoked fleet token is 401', { tag: ['@api'] }, async () => {
    for (const reason of ['bad', 'revoked'] as const) {
      const r = await run({ 'x-auto-tournament-token': 'rus_abc123abc123_x' }, async () => ({ ok: false, reason }));
      expect(r.nexted).toBe(false);
      expect(r.status).toBe(401);
    }
  });

  test('only rus_-prefixed values are routed to the fleet check', { tag: ['@api'] }, () => {
    expect(presentedFleetToken(fakeReq({ 'x-auto-tournament-token': 'legacy-secret' }))).toBeNull();
    expect(presentedFleetToken(fakeReq({ authorization: 'Bearer legacy-secret' }))).toBeNull();
  });

  test('fleet map numbers are converted from 1-based to 0-based', { tag: ['@api'] }, () => {
    expect(demoMapNumber('1', true)).toBe(0);
    expect(demoMapNumber('3', true)).toBe(2);
    expect(demoMapNumber('0', true)).toBe(0);
    expect(demoMapNumber('2', false)).toBe(2);
    expect(demoMapNumber('abc', true)).toBeNaN();
  });
});
