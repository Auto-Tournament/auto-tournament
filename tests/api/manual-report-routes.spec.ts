import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * The captain side of manual reporting over HTTP (3.0 phase D, PR D4).
 *
 * D3's spec drives the state machine through the module's test-only helpers,
 * with one admin impersonating both captains. This one drives the **real**
 * routes at `/api/game/manual`, and every captain is a separate signed-in,
 * non-admin browser context — which is the only way the authorization rules
 * mean anything. "A player who is not on this team is refused" cannot be
 * tested by an admin pretending to be one.
 *
 * What it pins:
 *  - report → confirm finishes the series and advances the bracket
 *  - confirming a revision that has been superseded is a 409
 *  - every refusal: anonymous, a player on neither team, a captain of a team
 *    in a different match, the reporting side answering itself, a CS2 match,
 *    a slug that does not exist, and confirming without naming a revision
 *  - the GET tells a client what it may do before it tries
 *
 * @tag api
 */

const MR = '/api/test/integration/manual-report';
const API = '/api/game/manual';

type Side = 'team1' | 'team2';

type ListedMatch = {
  slug: string;
  round: number;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

type ReportRow = {
  id: number;
  revision: number;
  status: string;
  source: string;
  submittedByTeam: Side | null;
  confirmDeadline: number | null;
};

type MatchView = {
  success: boolean;
  match: { slug: string; status: string; winnerId: string | null; team1: { id: string | null; name: string | null } };
  rules: { seriesLength: number; allowDraw: boolean; confirmation: string; timeoutAction: string };
  viewer: { team: Side | null; role: string; canReport: boolean; canConfirm: boolean; canWithdraw: boolean };
  open: ReportRow | null;
  reports: ReportRow[];
};

// ---------------------------------------------------------------------------
// A cast of real accounts
// ---------------------------------------------------------------------------

/** `teams.id` -> the Steam id of that team's captain, for this run. */
const captainSteamIds = new Map<string, string>();
/** Steam ids that are on no team at all. */
let outsiderSteamId = '';

/**
 * Teams with a captain each. Two real accounts on two real memberships: with
 * one account on both sides, "a team cannot answer its own report" and "a
 * stranger is refused" are both untestable.
 */
async function createTeams(admin: APIRequestContext, prefix: string, count: number) {
  const stamp = `${Date.now()}`.slice(-7);
  const ids: string[] = [];
  for (let t = 0; t < count; t++) {
    const id = `${prefix}-${stamp}-${t}`;
    const captain = `76561199${stamp}${t}0`;
    const res = await admin.post('/api/teams', {
      data: {
        id,
        name: `${prefix} ${stamp} ${t}`,
        players: [
          { steamId: captain, name: `${prefix} ${t} captain` },
          { steamId: `76561199${stamp}${t}1`, name: `${prefix} ${t}.1` },
        ],
      },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    captainSteamIds.set(id, captain);
    ids.push(id);
  }
  outsiderSteamId = `76561199${stamp}99`;
  return ids;
}

/**
 * Promote each team's captain. D5 adds the admin route for this; until it is
 * mounted the module's test-only helper is the only way to make one at all
 * (D1's backfill found no captain information in 2.x and created none).
 */
async function promoteCaptains(admin: APIRequestContext, teamIds: string[]) {
  for (const teamId of teamIds) {
    const res = await admin.post(`${MR}/teams/${teamId}/captain`, {
      data: { steamId: captainSteamIds.get(teamId) },
    });
    expect(res.ok(), `promoting in ${teamId}: ${await res.text()}`).toBe(true);
  }
}

/** A signed-in, non-admin context for a Steam id. The caller disposes it. */
async function playerContext(
  playwright: Playwright,
  baseURL: string | undefined,
  steamId: string
): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL });
  expect(await signInAsPlayerViaRequest(ctx, steamId), `signing in ${steamId}`).toBe(true);
  return ctx;
}

async function createTournament(
  admin: APIRequestContext,
  data: { name: string; type: string; format: string; game?: string; teamIds: string[]; settings?: unknown }
) {
  const res = await admin.post(`${MR}/tournament`, { data });
  expect(res.status(), `creating: ${await res.text()}`).toBe(200);
  await promoteCaptains(admin, data.teamIds);

  const started = await admin.post('/api/tournament/start', { data: {} });
  expect(started.ok(), `starting: ${await started.text()}`).toBe(true);
}

async function listMatches(admin: APIRequestContext): Promise<ListedMatch[]> {
  const res = await admin.get('/api/matches');
  expect(res.ok(), `listing matches: ${await res.text()}`).toBe(true);
  return (((await res.json()) as { matches?: ListedMatch[] }).matches ?? []).filter((m) => m.round >= 1);
}

async function waitForLive(admin: APIRequestContext, round: number, count: number) {
  let live: ListedMatch[] = [];
  await expect
    .poll(
      async () => {
        live = (await listMatches(admin)).filter(
          (m) => m.round === round && m.team1 && m.team2 && m.status === 'live'
        );
        return live.length;
      },
      { message: `round ${round} should go live`, timeout: 20_000 }
    )
    .toBe(count);
  return live;
}

/** The fewest games that decide a best-of-N for `winner`. */
function sweep(seriesLength: number, winner: Side) {
  const wins = Math.floor(seriesLength / 2) + 1;
  return {
    maps: Array.from({ length: wins }, () => ({
      team1Score: winner === 'team1' ? 3 : 1,
      team2Score: winner === 'team2' ? 3 : 1,
    })),
  };
}

async function view(ctx: APIRequestContext, slug: string): Promise<MatchView> {
  const res = await ctx.get(`${API}/matches/${slug}`);
  expect(res.status(), `reading ${slug}: ${await res.text()}`).toBe(200);
  return (await res.json()) as MatchView;
}

async function expectOk(res: Awaited<ReturnType<APIRequestContext['post']>>, what: string) {
  expect(res.status(), `${what}: ${await res.text()}`).toBe(200);
  return (await res.json()) as { report: ReportRow; finalized: boolean };
}

// ---------------------------------------------------------------------------

test.describe.serial('Manual reporting over HTTP: captains', () => {
  test.beforeEach(async ({ request, baseURL }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await request.put('/api/settings', {
      data: { webhookUrl: baseURL ?? 'http://localhost:3069', simulateMatches: false },
    });
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/tournament');
  });

  test(
    'a captain reports, the opponent confirms, and the bracket advances',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'mrr-happy', 4);
      await createTournament(request, {
        name: 'Reported over HTTP',
        type: 'single_elimination',
        format: 'bo3',
        game: 'rocket-league',
        teamIds,
        settings: { manualReport: { confirmation: 'opponent', confirmTimeoutMin: 60 } },
      });
      const round1 = await waitForLive(request, 1, 2);
      const match = round1[0];

      const one = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);
      const two = await playerContext(playwright, baseURL, captainSteamIds.get(match.team2!.id)!);

      try {
        // Before anyone reports, the page knows what it is looking at.
        const before = await view(one, match.slug);
        expect(before.match.status).toBe('live');
        expect(before.rules).toMatchObject({ seriesLength: 3, allowDraw: false, confirmation: 'opponent' });
        expect(before.viewer).toMatchObject({ team: 'team1', role: 'captain', canReport: true, canConfirm: false });
        expect(before.open).toBeNull();

        const submitted = await expectOk(
          await one.post(`${API}/matches/${match.slug}/report`, { data: { result: sweep(3, 'team1') } }),
          'reporting'
        );
        expect(submitted.report).toMatchObject({ revision: 1, status: 'submitted', submittedByTeam: 'team1' });
        expect(submitted.finalized).toBe(false);
        expect(submitted.report.confirmDeadline).toBeGreaterThan(Math.floor(Date.now() / 1000));

        // The reporter may take it back; the opponent is the one who answers.
        expect((await view(one, match.slug)).viewer).toMatchObject({ canConfirm: false, canWithdraw: true });
        const opponentView = await view(two, match.slug);
        expect(opponentView.viewer).toMatchObject({ team: 'team2', canConfirm: true, canWithdraw: false });
        expect(opponentView.open?.revision).toBe(1);

        const confirmed = await expectOk(
          await two.post(`${API}/matches/${match.slug}/confirm`, {
            data: { revision: opponentView.open!.revision },
          }),
          'confirming'
        );
        expect(confirmed.report.status).toBe('confirmed');
        expect(confirmed.finalized).toBe(true);

        const after = await view(one, match.slug);
        expect(after.match.status).toBe('completed');
        expect(after.match.winnerId).toBe(match.team1!.id);
        expect(after.open).toBeNull();
      } finally {
        await one.dispose();
        await two.dispose();
      }

      // The other semi, then the final: the bracket moves on typed-in results
      // alone, through `applySeriesResult` like any watched game.
      for (const m of [round1[1]]) {
        const a = await playerContext(playwright, baseURL, captainSteamIds.get(m.team1!.id)!);
        const b = await playerContext(playwright, baseURL, captainSteamIds.get(m.team2!.id)!);
        try {
          await expectOk(
            await a.post(`${API}/matches/${m.slug}/report`, { data: { result: sweep(3, 'team1') } }),
            'reporting the other semi'
          );
          await expectOk(
            await b.post(`${API}/matches/${m.slug}/confirm`, { data: { revision: 1 } }),
            'confirming the other semi'
          );
        } finally {
          await a.dispose();
          await b.dispose();
        }
      }

      const [final] = await waitForLive(request, 2, 1);
      expect([final.team1!.id, final.team2!.id].sort()).toEqual(
        [round1[0].team1!.id, round1[1].team1!.id].sort()
      );
    }
  );

  test(
    'confirming a revision that has been superseded is a 409',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'mrr-stale', 2);
      await createTournament(request, {
        name: 'Stale',
        type: 'single_elimination',
        format: 'bo1',
        game: 'chess',
        teamIds,
      });
      const [match] = await waitForLive(request, 1, 1);

      const one = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);
      const two = await playerContext(playwright, baseURL, captainSteamIds.get(match.team2!.id)!);

      try {
        await expectOk(
          await one.post(`${API}/matches/${match.slug}/report`, { data: { result: sweep(1, 'team1') } }),
          'reporting'
        );
        // team2 reads revision 1 — and while they are reading it, team1
        // corrects themselves. The correction supersedes, so the number team2
        // is holding is no longer the open report.
        const stale = (await view(two, match.slug)).open!.revision;
        expect(stale).toBe(1);

        const corrected = await expectOk(
          await one.post(`${API}/matches/${match.slug}/report`, { data: { result: sweep(1, 'team2') } }),
          'correcting'
        );
        expect(corrected.report.revision).toBe(2);

        const conflict = await two.post(`${API}/matches/${match.slug}/confirm`, {
          data: { revision: stale },
        });
        expect(conflict.status()).toBe(409);
        expect(await conflict.text()).toContain('revision 2, not 1');

        // Nothing moved: the match is still live and the correction still open.
        const held = await view(two, match.slug);
        expect(held.match.status).toBe('live');
        expect(held.open?.revision).toBe(2);

        // Confirming what they can actually see works, and finishes it.
        const ok = await expectOk(
          await two.post(`${API}/matches/${match.slug}/confirm`, { data: { revision: 2 } }),
          'confirming the current revision'
        );
        expect(ok.finalized).toBe(true);
        expect((await view(two, match.slug)).match.winnerId).toBe(match.team2!.id);

        // And a confirm with no revision at all never reaches the machine.
        const naked = await two.post(`${API}/matches/${match.slug}/confirm`, { data: {} });
        expect(naked.status()).toBe(400);
        expect(await naked.text()).toContain('revision is required');
      } finally {
        await one.dispose();
        await two.dispose();
      }
    }
  );

  test(
    'every caller who has no business here is refused',
    { tag: ['@api', '@security'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'mrr-auth', 4);
      await createTournament(request, {
        name: 'Refusals',
        type: 'single_elimination',
        format: 'bo1',
        game: 'chess',
        teamIds,
      });
      const round1 = await waitForLive(request, 1, 2);
      const [match, otherMatch] = round1;

      const anon = await playwright.request.newContext({ baseURL });
      const stranger = await playerContext(playwright, baseURL, outsiderSteamId);
      const elsewhere = await playerContext(
        playwright,
        baseURL,
        captainSteamIds.get(otherMatch.team1!.id)!
      );
      const one = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);

      const actions = ['report', 'confirm', 'dispute', 'withdraw'];

      try {
        // Not signed in at all: 401, on the read as well as the writes. A
        // match's disputed and withdrawn reports are an argument between two
        // teams, not a scoreboard.
        expect((await anon.get(`${API}/matches/${match.slug}`)).status()).toBe(401);
        for (const action of actions) {
          const res = await anon.post(`${API}/matches/${match.slug}/${action}`, {
            data: { revision: 1, result: sweep(1, 'team1') },
          });
          expect(res.status(), `anonymous ${action}`).toBe(401);
        }

        // Signed in, on no team: 403, not 401 — we know who they are, they are
        // just nobody in this match.
        for (const ctx of [stranger, elsewhere]) {
          expect((await ctx.get(`${API}/matches/${match.slug}`)).status()).toBe(403);
          for (const action of actions) {
            const res = await ctx.post(`${API}/matches/${match.slug}/${action}`, {
              data: { revision: 1, result: sweep(1, 'team1') },
            });
            expect(res.status(), `outsider ${action}`).toBe(403);
            expect(await res.text()).toContain('captain neither team');
          }
        }

        // A captain of a team in the *other* match of the same round is that
        // same outsider here — the check is the two teams on this match row,
        // not "are you in this tournament".
        expect((await view(elsewhere, otherMatch.slug)).viewer.role).toBe('captain');

        // The side that reported cannot answer its own report.
        await expectOk(
          await one.post(`${API}/matches/${match.slug}/report`, { data: { result: sweep(1, 'team1') } }),
          'reporting'
        );
        for (const action of ['confirm', 'dispute']) {
          const res = await one.post(`${API}/matches/${match.slug}/${action}`, { data: { revision: 1 } });
          expect(res.status(), `${action} by the reporting side`).toBe(403);
          expect(await res.text()).toContain('cannot confirm or dispute its own report');
        }

        // A match that does not exist, and one this module does not own.
        expect((await one.get(`${API}/matches/no-such-match`)).status()).toBe(404);
        const slug = `cs2-not-manual-${Date.now()}`;
        const cs2 = await request.post('/api/matches', {
          data: {
            slug,
            config: {
              matchid: slug,
              team1: { name: 'CS2 one', players: {} },
              team2: { name: 'CS2 two', players: {} },
              num_maps: 1,
              maplist: ['de_dust2'],
            },
          },
        });
        expect(cs2.ok(), `creating a CS2 match: ${await cs2.text()}`).toBe(true);

        // A match another module owns is refused rather than reported on:
        // this router is mounted for everyone, and a CS2 result comes from
        // the game.
        for (const call of [
          one.get(`${API}/matches/${slug}`),
          one.post(`${API}/matches/${slug}/report`, { data: { result: sweep(1, 'team1') } }),
        ]) {
          const res = await call;
          expect(res.status(), 'a CS2 match is not reported manually').toBe(409);
          expect(await res.text()).toContain('not reported manually');
        }
      } finally {
        await anon.dispose();
        await stranger.dispose();
        await elsewhere.dispose();
        await one.dispose();
      }
    }
  );
});
