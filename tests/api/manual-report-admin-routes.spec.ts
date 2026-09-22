import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * The admin side of manual reporting over HTTP (3.0 phase D, PR D5).
 *
 * The queue an admin works from, the two decisions they can make about a
 * reported match, the extra fields a tournament asks reporters for, and the
 * route that says who may report for a team at all.
 *
 * That last one is not a convenience. D1's backfill found no captain
 * information anywhere in 2.x and created none, so on a real upgraded instance
 * every `team_members` row is a plain member and D4's routes refuse everybody.
 * `POST /teams/:teamId/captain` is what makes the feature reachable, and this
 * spec promotes through it rather than through the test-only helper.
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

type Dispute = {
  matchSlug: string;
  tournamentId: number;
  matchStatus: string;
  reason: 'disputed' | 'timeout';
  team1: { id: string | null; name: string | null };
  team2: { id: string | null; name: string | null };
  report: { revision: number; status: string; submittedByTeam: Side | null; disputeReason: string | null };
};

type Field = {
  id: number;
  key: string;
  label: string;
  valueType: 'number' | 'text';
  scope: 'player' | 'team';
  required: boolean;
  displayOrder: number;
};

const captainSteamIds = new Map<string, string>();
/** `teams.id` -> the `players.uid` of that team's captain. */
const captainUids = new Map<string, string>();

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
  return ids;
}

type Member = { accountUid: string; role: string; playerId: string | null; name: string | null };

/**
 * The `players.uid` of a team member, read the way an admin screen would:
 * the membership listing is the only thing that exposes a uid at all, which
 * is the point of it carrying the player behind each row.
 */
async function uidOf(admin: APIRequestContext, teamId: string, steamId: string): Promise<string> {
  const res = await admin.get(`${API}/teams/${teamId}/members`);
  expect(res.status(), `listing ${teamId}: ${await res.text()}`).toBe(200);
  const members = ((await res.json()) as { members: Member[] }).members;
  const member = members.find((m) => m.playerId === steamId);
  expect(member, `${steamId} should be a member of ${teamId} (roster mirror)`).toBeTruthy();
  return member!.accountUid;
}

/** Promote each team's captain through the real admin route. */
async function promoteCaptains(admin: APIRequestContext, teamIds: string[]) {
  for (const teamId of teamIds) {
    const uid = await uidOf(admin, teamId, captainSteamIds.get(teamId)!);
    captainUids.set(teamId, uid);
    const res = await admin.post(`${API}/teams/${teamId}/captain`, { data: { uid } });
    expect(res.status(), `promoting in ${teamId}: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as { members: Member[] };
    expect(body.members.find((m) => m.accountUid === uid)?.role).toBe('captain');
  }
}

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

async function waitForLive(admin: APIRequestContext, round: number, count: number) {
  let live: ListedMatch[] = [];
  await expect
    .poll(
      async () => {
        const res = await admin.get('/api/matches');
        const all = ((await res.json()) as { matches?: ListedMatch[] }).matches ?? [];
        live = all.filter((m) => m.round === round && m.team1 && m.team2 && m.status === 'live');
        return live.length;
      },
      { message: `round ${round} should go live`, timeout: 20_000 }
    )
    .toBe(count);
  return live;
}

function sweep(seriesLength: number, winner: Side) {
  const wins = Math.floor(seriesLength / 2) + 1;
  return {
    maps: Array.from({ length: wins }, () => ({
      team1Score: winner === 'team1' ? 3 : 1,
      team2Score: winner === 'team2' ? 3 : 1,
    })),
  };
}

async function disputes(admin: APIRequestContext, query = ''): Promise<Dispute[]> {
  const res = await admin.get(`${API}/disputes${query}`);
  expect(res.status(), `listing disputes: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { disputes: Dispute[] }).disputes;
}

async function fieldsOf(admin: APIRequestContext, tournamentId = 1): Promise<Field[]> {
  const res = await admin.get(`${API}/tournaments/${tournamentId}/fields`);
  expect(res.status(), `reading fields: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { fields: Field[] }).fields;
}

async function expectOk(res: Awaited<ReturnType<APIRequestContext['post']>>, what: string) {
  expect(res.status(), `${what}: ${await res.text()}`).toBe(200);
  return (await res.json()) as { report: { revision: number; status: string; source: string }; finalized: boolean };
}

// ---------------------------------------------------------------------------

test.describe.serial('Manual reporting over HTTP: admin', () => {
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
    'a dispute reaches the queue, the admin settles it, and can reopen it',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      // Four teams, so the tournament is still running after this match is
      // settled — `reopen` refuses to touch a finished tournament, and that
      // refusal would hide everything this test is about.
      const teamIds = await createTeams(request, 'mra-dispute', 4);
      await createTournament(request, {
        name: 'Argued',
        type: 'single_elimination',
        format: 'bo1',
        game: 'chess',
        teamIds,
      });
      const [match] = await waitForLive(request, 1, 2);

      expect(await disputes(request), 'nothing is waiting yet').toEqual([]);

      const one = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);
      const two = await playerContext(playwright, baseURL, captainSteamIds.get(match.team2!.id)!);

      try {
        await expectOk(
          await one.post(`${API}/matches/${match.slug}/report`, { data: { result: sweep(1, 'team1') } }),
          'reporting'
        );
        const disputed = await two.post(`${API}/matches/${match.slug}/dispute`, {
          data: { revision: 1, reason: 'We won that one' },
        });
        expect(disputed.status(), await disputed.text()).toBe(200);

        // It is now on the admin's desk, with everything needed to judge it.
        const queue = await disputes(request);
        expect(queue).toHaveLength(1);
        expect(queue[0]).toMatchObject({
          matchSlug: match.slug,
          matchStatus: 'needs_decision',
          reason: 'disputed',
          tournamentId: 1,
        });
        expect(queue[0].team1.name).toBeTruthy();
        expect(queue[0].report).toMatchObject({
          revision: 1,
          status: 'disputed',
          submittedByTeam: 'team1',
          disputeReason: 'We won that one',
        });

        // Filtering by a tournament that is not this one empties it.
        expect(await disputes(request, '?tournamentId=99')).toEqual([]);

        // The admin rules for team2, as their own revision.
        const resolved = await expectOk(
          await request.post(`${API}/matches/${match.slug}/resolve`, {
            data: { result: sweep(1, 'team2') },
          }),
          'resolving'
        );
        expect(resolved.report).toMatchObject({ revision: 2, source: 'admin', status: 'confirmed' });
        expect(resolved.finalized).toBe(true);
        expect(await disputes(request), 'the queue empties once it is settled').toEqual([]);

        const settled = await one.get(`${API}/matches/${match.slug}`);
        const settledBody = (await settled.json()) as { match: { status: string; winnerId: string } };
        expect(settledBody.match.status).toBe('completed');
        expect(settledBody.match.winnerId).toBe(match.team2!.id);

        // And they can undo it: the match goes back to live, and the teams
        // report again over a clean slate.
        const reopened = await request.post(`${API}/matches/${match.slug}/reopen`);
        expect(reopened.status(), await reopened.text()).toBe(200);

        const live = (await (await one.get(`${API}/matches/${match.slug}`)).json()) as {
          match: { status: string; winnerId: string | null };
          open: unknown;
        };
        expect(live.match.status).toBe('live');
        expect(live.match.winnerId).toBeNull();
        expect(live.open).toBeNull();

        const again = await expectOk(
          await one.post(`${API}/matches/${match.slug}/report`, { data: { result: sweep(1, 'team1') } }),
          'reporting again after the reopen'
        );
        expect(again.report.revision).toBe(3);
        await expectOk(
          await two.post(`${API}/matches/${match.slug}/confirm`, { data: { revision: 3 } }),
          'confirming the replacement'
        );
        const final = (await (await one.get(`${API}/matches/${match.slug}`)).json()) as {
          match: { status: string; winnerId: string };
        };
        expect(final.match.status).toBe('completed');
        expect(final.match.winnerId).toBe(match.team1!.id);
      } finally {
        await one.dispose();
        await two.dispose();
      }
    }
  );

  test(
    'the tournament says what extra numbers it wants reported',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'mra-fields', 2);
      await createTournament(request, {
        name: 'With stats',
        type: 'single_elimination',
        format: 'bo1',
        game: 'rocket-league',
        teamIds,
      });

      expect(await fieldsOf(request), 'a tournament asks for nothing by default').toEqual([]);

      const put = await request.put(`${API}/tournaments/1/fields`, {
        data: {
          fields: [
            { key: 'goals', label: 'Goals', valueType: 'number', scope: 'player', required: true },
            { key: 'saves', label: 'Saves' },
            { key: 'notes', label: 'Match notes', valueType: 'text', scope: 'team' },
          ],
        },
      });
      expect(put.status(), await put.text()).toBe(200);

      const stored = await fieldsOf(request);
      expect(stored.map((f) => f.key)).toEqual(['goals', 'saves', 'notes']);
      expect(stored[0]).toMatchObject({ label: 'Goals', valueType: 'number', scope: 'player', required: true });
      // The defaults: a number, per player, not required.
      expect(stored[1]).toMatchObject({ valueType: 'number', scope: 'player', required: false });
      expect(stored[2]).toMatchObject({ valueType: 'text', scope: 'team' });
      expect(stored.map((f) => f.displayOrder)).toEqual([0, 1, 2]);

      // A field that keeps its key keeps its row — and therefore anything
      // already recorded against it — while everything else about it changes.
      const goalsId = stored[0].id;
      const replaced = await request.put(`${API}/tournaments/1/fields`, {
        data: {
          fields: [
            { key: 'notes', label: 'Notes', valueType: 'text', scope: 'team' },
            { key: 'goals', label: 'Goals scored', valueType: 'number', scope: 'player' },
          ],
        },
      });
      expect(replaced.status(), await replaced.text()).toBe(200);

      const after = await fieldsOf(request);
      expect(after.map((f) => f.key)).toEqual(['notes', 'goals']);
      expect(after.find((f) => f.key === 'goals')).toMatchObject({
        id: goalsId,
        label: 'Goals scored',
        required: false,
        displayOrder: 1,
      });
      // 'saves' was not in the list, so it is gone.
      expect(after.some((f) => f.key === 'saves')).toBe(false);

      // A captain sees them on the match they are about to report, so the
      // form is one request rather than two.
      const [match] = await waitForLive(request, 1, 1);
      const one = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);
      try {
        const body = (await (await one.get(`${API}/matches/${match.slug}`)).json()) as { fields: Field[] };
        expect(body.fields.map((f) => f.key)).toEqual(['notes', 'goals']);
      } finally {
        await one.dispose();
      }

      // What is not a set of fields.
      const bad: Array<[unknown, string]> = [
        [[{ key: 'Goals!', label: 'Goals' }], 'key must be'],
        [[{ key: 'goals', label: '' }], 'label is required'],
        [[{ key: 'goals', label: 'Goals' }, { key: 'goals', label: 'Again' }], 'listed twice'],
        [[{ key: 'goals', label: 'Goals', valueType: 'boolean' }], "valueType must be 'number' or 'text'"],
        [[{ key: 'goals', label: 'Goals', scope: 'league' }], "scope must be 'player' or 'team'"],
      ];
      for (const [fields, message] of bad) {
        const res = await request.put(`${API}/tournaments/1/fields`, { data: { fields } });
        expect(res.status(), `refusing ${JSON.stringify(fields)}`).toBe(400);
        expect(await res.text()).toContain(message);
      }
      // A refused set changes nothing.
      expect((await fieldsOf(request)).map((f) => f.key)).toEqual(['notes', 'goals']);

      // An empty list clears them.
      const cleared = await request.put(`${API}/tournaments/1/fields`, { data: { fields: [] } });
      expect(cleared.status()).toBe(200);
      expect(await fieldsOf(request)).toEqual([]);

      expect((await request.get(`${API}/tournaments/404/fields`)).status()).toBe(404);
      expect((await request.get(`${API}/tournaments/nope/fields`)).status()).toBe(400);
    }
  );

  test(
    'only an admin may say who captains a team, and only a member can be one',
    { tag: ['@api', '@security'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'mra-captain', 2);
      await createTournament(request, {
        name: 'Captains',
        type: 'single_elimination',
        format: 'bo1',
        game: 'chess',
        teamIds,
      });
      const [match] = await waitForLive(request, 1, 1);
      const team = match.team1!.id;

      // Somebody who is not on the roster cannot be made its captain: the
      // roster is the record, and this route sets a role rather than a squad.
      const strangerUid = '00000000-0000-4000-8000-000000000000';
      const notAMember = await request.post(`${API}/teams/${team}/captain`, {
        data: { uid: strangerUid },
      });
      expect(notAMember.status()).toBe(409);
      expect(await notAMember.text()).toContain('is not on team');

      expect((await request.post(`${API}/teams/no-such-team/captain`, { data: { uid: strangerUid } })).status()).toBe(404);
      expect((await request.post(`${API}/teams/${team}/captain`, { data: {} })).status()).toBe(400);

      // Demoting the captain takes their right to report with it.
      const uid = captainUids.get(team)!;
      const demoted = await request.post(`${API}/teams/${team}/captain`, {
        data: { uid, role: 'member' },
      });
      expect(demoted.status(), await demoted.text()).toBe(200);

      const one = await playerContext(playwright, baseURL, captainSteamIds.get(team)!);
      try {
        const refused = await one.post(`${API}/matches/${match.slug}/report`, {
          data: { result: sweep(1, 'team1') },
        });
        expect(refused.status(), 'a plain member may not report').toBe(403);

        // And promoting them again gives it back.
        expect((await request.post(`${API}/teams/${team}/captain`, { data: { uid } })).status()).toBe(200);
        const allowed = await one.post(`${API}/matches/${match.slug}/report`, {
          data: { result: sweep(1, 'team1') },
        });
        expect(allowed.status(), await allowed.text()).toBe(200);
      } finally {
        await one.dispose();
      }
    }
  );

  test(
    'every admin route refuses a caller who is not an admin',
    { tag: ['@api', '@security'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'mra-auth', 2);
      await createTournament(request, {
        name: 'Admin only',
        type: 'single_elimination',
        format: 'bo1',
        game: 'chess',
        teamIds,
      });
      const [match] = await waitForLive(request, 1, 1);

      const anon = await playwright.request.newContext({ baseURL });
      // A captain: as player-facing as this API gets, and still not an admin.
      const captain = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);

      const calls: Array<[string, 'get' | 'post' | 'put', string]> = [
        ['disputes', 'get', `${API}/disputes`],
        ['resolve', 'post', `${API}/matches/${match.slug}/resolve`],
        ['reopen', 'post', `${API}/matches/${match.slug}/reopen`],
        ['read fields', 'get', `${API}/tournaments/1/fields`],
        ['set fields', 'put', `${API}/tournaments/1/fields`],
        ['promote', 'post', `${API}/teams/${match.team1!.id}/captain`],
        ['members', 'get', `${API}/teams/${match.team1!.id}/members`],
      ];

      try {
        for (const [what, method, path] of calls) {
          const anonRes = await anon[method](path, { data: {} });
          expect(anonRes.status(), `anonymous ${what}`).toBe(401);

          const captainRes = await captain[method](path, { data: {} });
          expect(captainRes.status(), `a captain calling ${what}`).toBe(403);
        }
      } finally {
        await anon.dispose();
        await captain.dispose();
      }
    }
  );
});
