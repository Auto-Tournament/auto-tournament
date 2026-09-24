import { test, expect, type APIRequestContext } from '@playwright/test';
import { decideUpdateHold } from '../../api/src/integrations/cs2/services/updateHoldService';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

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
}

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
    await expect
      .poll(async () => (await getHold(request)).body.hold, { timeout: 15_000 })
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
