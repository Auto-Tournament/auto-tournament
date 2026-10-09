import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  decideUpdateHold,
  licenseHandoffFor,
  NO_LICENSE_REVISION,
} from '../../api/src/integrations/cs2/services/updateHoldService';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { resetEnrollRateLimit } from '../helpers/fleet';
import { createPendingHost, enrollHost, newMachineId } from '../helpers/fleetHost';

/**
 * `GET /api/servers/update-hold` — the answer CS2 Server Manager polls before
 * it restarts an idle server for a Valve update.
 *
 * The hold exists because "idle" is a local judgement: a server with nobody on
 * it and no match loaded is idle right up to the moment MAT's allocator hands
 * it the next match of a running tournament. Only MAT knows that, so csm asks.
 *
 * csm holds updates on anything that is not a 200 with `hold: false`, so the
 * credential matters as much as the answer: a rejected poll is a held host.
 *
 * @tag api
 * @tag servers
 */

const TOKEN = process.env.SERVER_TOKEN ?? 'server123';
const PATH = '/api/servers/update-hold';

interface HoldBody {
  success?: boolean;
  hold?: boolean;
  reason?: string;
  tournamentStatus?: string | null;
  activeMatches?: Array<{ slug: string; serverId: string | null; status: string }>;
  checkedAt?: number;
  license?: { key: string | null; revision: string; use?: string } | null;
}

const json = { 'Content-Type': 'application/json' };
/** Well-formed, signed by no one: stored as-is (see license-api.spec.ts). */
const UNSIGNED_KEY = `ATL1.${Buffer.from(JSON.stringify({ v: 1, kid: 'tWl_YS3_AzLgqdkm', id: 'lic_csm_handoff' })).toString('base64url')}.${'A'.repeat(86)}`;

async function getHold(
  request: APIRequestContext,
  headers: Record<string, string> = { 'X-Auto-Tournament-Token': TOKEN }
): Promise<{ status: number; body: HoldBody }> {
  const response = await request.get(PATH, { headers });
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as HoldBody };
}

test.describe('update hold rules (pure)', () => {
  test('a loaded or live match holds updates whatever the tournament says', () => {
    const decision = decideUpdateHold({
      tournamentStatus: 'setup',
      tournamentName: 'Ad hoc',
      activeMatches: [{ slug: 'r1m1', serverId: 'cs1', status: 'live' }],
    });
    expect(decision.hold).toBe(true);
    expect(decision.reason).toContain('r1m1');
    expect(decision.reason).toContain('cs1');
  });

  test('a tournament in progress holds updates with no match loaded yet', () => {
    const decision = decideUpdateHold({
      tournamentStatus: 'in_progress',
      tournamentName: 'Autumn Cup',
      activeMatches: [],
    });
    expect(decision.hold).toBe(true);
    expect(decision.reason).toContain('Autumn Cup');
  });

  test('a tournament that is only set up, or finished, does not hold', () => {
    for (const status of ['setup', 'ready', 'completed', 'cancelled', null]) {
      const decision = decideUpdateHold({
        tournamentStatus: status,
        tournamentName: 'Autumn Cup',
        activeMatches: [],
      });
      expect(decision.hold, `status ${status} should not hold`).toBe(false);
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  test('the reason names at most three matches and counts the rest', () => {
    const decision = decideUpdateHold({
      tournamentStatus: 'in_progress',
      tournamentName: 'Autumn Cup',
      activeMatches: ['r1m1', 'r1m2', 'r1m3', 'r1m4', 'r1m5'].map((slug) => ({
        slug,
        serverId: null,
        status: 'live',
      })),
    });
    expect(decision.reason).toContain('r1m3');
    expect(decision.reason).not.toContain('r1m4');
    expect(decision.reason).toContain('+2 more');
  });
});

test.describe('update hold endpoint', () => {
  test('refuses a poll with no token or the wrong one', async ({ request }) => {
    const none = await getHold(request, {});
    expect(none.status, 'an untokened poll must be refused').toBe(401);

    const wrong = await getHold(request, { 'X-Auto-Tournament-Token': `${TOKEN}-wrong` });
    expect(wrong.status, 'a wrong token must be refused').toBe(401);
  });

  test('a linked csm host may ask with its own host token (no csm updates platform needed)', async ({
    request,
  }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    const pending = await createPendingHost(request, `hold-host-${Date.now()}`);
    const enrolled = await enrollHost(request, { code: pending.code }, newMachineId());
    expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(201);
    const token = enrolled.body.token as string;

    const asHost = await getHold(request, { Authorization: `Bearer ${token}` });
    expect(asHost.status).toBe(200);
    expect(asHost.body.success).toBe(true);
    expect(typeof asHost.body.hold).toBe('boolean');

    const forged = await getHold(request, { Authorization: `Bearer rhs_${'x'.repeat(40)}` });
    expect(forged.status).toBe(401);
  });

  test('an admin session alone does not open it — the server token is the credential', async ({
    request,
  }) => {
    await signInViaRequest(request);
    const admin = await getHold(request, getAuthHeader());
    expect(admin.status).toBe(401);
  });

  test('answers a running tournament with a hold, and a cleared one without', async ({
    request,
  }) => {
    await signInViaRequest(request);

    const setup = await setupTournament(request, {
      prefix: 'update-hold',
      teamCount: 2,
      serverCount: 1,
    });
    expect(setup, 'tournament setup should succeed').not.toBeNull();

    // `POST /api/tournament/start` answers before the row reaches
    // `in_progress`, so the hold is eventually consistent with the start.
    // Flaked once in CI with `undefined` (a non-JSON or non-200 answer, not a
    // `false`), and passed on retry in 2 s: poll the HTTP status too, so a
    // repeat says what came back, and give a busy shard longer.
    await expect
      .poll(
        async () => {
          const { status, body } = await getHold(request);
          return status === 200 ? body.hold : `HTTP ${status}`;
        },
        { timeout: 30_000, message: 'update hold never answered hold: true' }
      )
      .toBe(true);

    const held = await getHold(request);
    expect(held.status).toBe(200);
    expect(held.body.success).toBe(true);
    expect(held.body.reason?.length ?? 0).toBeGreaterThan(0);
    expect(typeof held.body.checkedAt).toBe('number');
    expect(Array.isArray(held.body.activeMatches)).toBe(true);

    await request.delete('/api/tournament', { headers: getAuthHeader() });

    await expect
      .poll(async () => (await getHold(request)).body.hold, { timeout: 15_000 })
      .toBe(false);
  });
});

test.describe('license hand-off to csm (pure)', () => {
  test('no key is revision "none"; a key gets a stable hash revision', () => {
    expect(licenseHandoffFor(null)).toEqual({ key: null, revision: NO_LICENSE_REVISION });
    expect(licenseHandoffFor('   ')).toEqual({ key: null, revision: NO_LICENSE_REVISION });

    const a = licenseHandoffFor(UNSIGNED_KEY);
    expect(a.key).toBe(UNSIGNED_KEY);
    expect(a.revision).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(licenseHandoffFor(`  ${UNSIGNED_KEY}
`)).toEqual(a);
    expect(licenseHandoffFor(`${UNSIGNED_KEY}B`).revision).not.toBe(a.revision);
    // The revision must not leak the key.
    expect(a.revision).not.toContain('ATL1');
    // A free key stays with the platform: csm and Ready Up get no key.
    const freeKey = `ATL1.${Buffer.from(JSON.stringify({ v: 1, kid: 'tWl_YS3_AzLgqdkm', id: 'lic_free', kind: 'free' })).toString('base64url')}.${'A'.repeat(86)}`;
    expect(licenseHandoffFor(freeKey)).toEqual({ key: null, revision: NO_LICENSE_REVISION });
  });
});

test.describe.serial('license hand-off on the update-hold poll', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await request.delete('/api/license');
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/license');
  });

  test('a saved key reaches csm with its revision', async ({ request }) => {
    const saved = await request.put('/api/license', { data: { key: UNSIGNED_KEY }, headers: json });
    expect(saved.status()).toBe(200);

    const { status, body } = await getHold(request);
    expect(status).toBe(200);
    // `use` rides along when the instance has accepted the terms.
    expect(body.license).toMatchObject(licenseHandoffFor(UNSIGNED_KEY));
  });

  test('a cleared key reaches csm as null with revision "none"', async ({ request }) => {
    await request.put('/api/license', { data: { key: UNSIGNED_KEY }, headers: json });
    const before = (await getHold(request)).body.license?.revision;

    await request.delete('/api/license');
    const { status, body } = await getHold(request);
    expect(status).toBe(200);
    expect(body.license).toMatchObject({ key: null, revision: NO_LICENSE_REVISION });
    expect(body.license?.revision).not.toBe(before);
  });

  test('the accepted license use reaches csm, and is omitted before acceptance', async ({ request }) => {
    const seed = (data: Record<string, unknown>) =>
      request.post('/api/test/license-consent', { data, headers: json });
    const record = (use: string, termsVersion: number) => ({
      use,
      acceptedAt: new Date().toISOString(),
      acceptedBy: 'e2e',
      source: 'admin',
      termsVersion,
      termsHash: null,
    });
    try {
      expect((await seed({ action: 'clear' })).status()).toBe(200);
      let { status, body } = await getHold(request);
      expect(status).toBe(200);
      expect(body.license).toBeTruthy();
      expect(body.license).not.toHaveProperty('use');

      for (const use of ['noncommercial', 'commercial']) {
        expect((await seed({ action: 'set', record: record(use, 1) })).status()).toBe(200);
        ({ status, body } = await getHold(request));
        expect(status).toBe(200);
        expect(body.license?.use).toBe(use);
      }
    } finally {
      await seed({ action: 'restore' });
    }
  });

  test('the key only goes to the server token', async ({ request, playwright, baseURL }) => {
    await request.put('/api/license', { data: { key: UNSIGNED_KEY }, headers: json });
    const stranger = await playwright.request.newContext({ baseURL });
    try {
      for (const headers of [{}, { 'X-Auto-Tournament-Token': `${TOKEN}-wrong` }]) {
        const response = await stranger.get(PATH, { headers });
        expect(response.status()).toBe(401);
        expect(await response.text()).not.toContain('ATL1.');
      }
    } finally {
      await stranger.dispose();
    }
    // An admin session is not the server token either.
    const admin = await request.get(PATH, { headers: getAuthHeader() });
    expect(admin.status()).toBe(401);
    expect(await admin.text()).not.toContain('ATL1.');
  });
});
