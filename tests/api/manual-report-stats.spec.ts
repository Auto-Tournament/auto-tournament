import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Custom stat fields, end to end (3.0 phase D, PR D6).
 *
 * D5 let an admin say which extra numbers a tournament asks for. This is the
 * other half: a captain fills them in with the score, they are checked against
 * those fields, and they read back — on the match, and added up over the
 * tournament.
 *
 * What it pins:
 *  - a field of each type (`integer`, `number`, `text`), per player and per
 *    team, defined through the real admin route
 *  - a report carrying values: they land keyed on `players.uid`, come back on
 *    the match GET with the field and the person on them, and reach the
 *    tournament listing once the report is confirmed
 *  - the tournament listing ignores a report nobody has agreed to yet, and
 *    needs no session
 *  - every refusal, and that a refused report stores nothing at all: an
 *    unknown key, the wrong type, a fraction in an integer field, a required
 *    field left blank for one side, a player who is on neither team, a
 *    per-team field given a player, a game number that was never played, and
 *    a series total mixed with per-game values
 *  - a second report replaces the first report's values rather than sitting
 *    beside them, and withdrawing one clears them
 *  - the score is untouched by all of it, so ratings are unchanged
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

type Field = {
  id: number;
  key: string;
  label: string;
  valueType: 'number' | 'integer' | 'text';
  scope: 'player' | 'team';
  required: boolean;
  displayOrder: number;
};

type StatValue = {
  fieldId: number;
  key: string;
  label: string;
  valueType: 'number' | 'integer' | 'text';
  scope: 'player' | 'team';
  mapNumber: number;
  playerUid: string | null;
  playerId: string | null;
  playerName: string | null;
  team: Side | null;
  value: number | string | null;
  reportId: number | null;
};

type MatchView = {
  match: { slug: string; tournamentId: number; status: string };
  fields: Field[];
  stats: StatValue[];
  open: { revision: number; status: string } | null;
};

type StatTotal = {
  key: string;
  label: string;
  valueType: string;
  total: number | null;
  average: number | null;
  count: number;
  texts?: string[];
};

type TournamentStats = {
  tournamentId: number;
  fields: Field[];
  players: Array<{ uid: string; playerId: string | null; name: string | null; matches: number; totals: StatTotal[]; teams: Array<{ id: string; name: string | null }> }>;
  teams: Array<{ id: string; name: string | null; matches: number; totals: StatTotal[] }>;
};

type Member = { accountUid: string; role: string; playerId: string | null; name: string | null };

// ---------------------------------------------------------------------------
// A cast of real accounts
// ---------------------------------------------------------------------------

/** `teams.id` -> the Steam id of that team's captain. */
const captainSteamIds = new Map<string, string>();
/** `teams.id` -> every member's `players.uid`, captain first. */
const memberUids = new Map<string, string[]>();
/** A Steam id that is on no team at all. */
let outsiderSteamId = '';

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
          { steamId: `76561199${stamp}${t}1`, name: `${prefix} ${t} second` },
        ],
      },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    captainSteamIds.set(id, captain);
    ids.push(id);
  }
  // On the roster of no team, so "this account is on neither side" has someone
  // real to be about.
  outsiderSteamId = `76561199${stamp}99`;
  const outsider = await admin.post('/api/teams', {
    data: {
      id: `${prefix}-${stamp}-out`,
      name: `${prefix} ${stamp} outsiders`,
      players: [{ steamId: outsiderSteamId, name: `${prefix} outsider` }],
    },
  });
  expect(outsider.ok(), `creating the outsider team: ${await outsider.text()}`).toBe(true);
  return ids;
}

/**
 * Every member's uid, and the captain promoted, through the real admin routes.
 * `team_members` is the only thing that exposes a `players.uid`, and a
 * per-player stat value is keyed on one.
 */
async function promoteAndRead(admin: APIRequestContext, teamIds: string[]) {
  for (const teamId of teamIds) {
    const listed = await admin.get(`${API}/teams/${teamId}/members`);
    expect(listed.status(), `listing ${teamId}: ${await listed.text()}`).toBe(200);
    const members = ((await listed.json()) as { members: Member[] }).members;
    const captain = members.find((m) => m.playerId === captainSteamIds.get(teamId));
    expect(captain, `${teamId} should mirror its roster`).toBeTruthy();

    const promoted = await admin.post(`${API}/teams/${teamId}/captain`, {
      data: { uid: captain!.accountUid },
    });
    expect(promoted.status(), `promoting in ${teamId}: ${await promoted.text()}`).toBe(200);
    memberUids.set(teamId, [
      captain!.accountUid,
      ...members.filter((m) => m.accountUid !== captain!.accountUid).map((m) => m.accountUid),
    ]);
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
  data: { name: string; type: string; format: string; game?: string; teamIds: string[] }
) {
  const res = await admin.post(`${MR}/tournament`, { data });
  expect(res.status(), `creating: ${await res.text()}`).toBe(200);
  await promoteAndRead(admin, data.teamIds);
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

async function setFields(admin: APIRequestContext, tournamentId: number, fields: unknown[]) {
  const res = await admin.put(`${API}/tournaments/${tournamentId}/fields`, { data: { fields } });
  expect(res.status(), `setting fields: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { fields: Field[] }).fields;
}

async function view(ctx: APIRequestContext, slug: string): Promise<MatchView> {
  const res = await ctx.get(`${API}/matches/${slug}`);
  expect(res.status(), `reading ${slug}: ${await res.text()}`).toBe(200);
  return (await res.json()) as MatchView;
}

async function tournamentStats(ctx: APIRequestContext, tournamentId: number): Promise<TournamentStats> {
  const res = await ctx.get(`${API}/tournaments/${tournamentId}/stats`);
  expect(res.status(), `reading tournament stats: ${await res.text()}`).toBe(200);
  return (await res.json()) as TournamentStats;
}

/** A value from a match view, by field key and subject. */
function valueOf(stats: StatValue[], key: string, subject: { uid?: string; team?: Side }) {
  return stats.find(
    (s) =>
      s.key === key &&
      (subject.uid === undefined || s.playerUid === subject.uid) &&
      (subject.team === undefined || s.team === subject.team)
  );
}

function totalOf(totals: StatTotal[], key: string) {
  return totals.find((t) => t.key === key);
}

// ---------------------------------------------------------------------------

test.describe.serial('Manual reporting: custom stat fields', () => {
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
    'an admin defines fields, a captain fills them in, and they read back on the match and the tournament',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'd6-happy', 2);
      await createTournament(request, {
        name: 'Goals and cars',
        type: 'single_elimination',
        format: 'bo1',
        game: 'rocket-league',
        teamIds,
      });
      const [match] = await waitForLive(request, 1, 1);
      const one = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);
      const two = await playerContext(playwright, baseURL, captainSteamIds.get(match.team2!.id)!);

      try {
        const tournamentId = (await view(one, match.slug)).match.tournamentId;

        // One field of each type, and both scopes.
        const fields = await setFields(request, tournamentId, [
          { key: 'goals', label: 'Goals', valueType: 'integer', scope: 'player', required: true },
          { key: 'possession', label: 'Possession %', valueType: 'number', scope: 'team', required: true },
          { key: 'car', label: 'Car', valueType: 'text', scope: 'player' },
        ]);
        expect(fields.map((f) => f.valueType)).toEqual(['integer', 'number', 'text']);

        // A type nobody implements is refused rather than stored as a number.
        const unknownType = await request.put(`${API}/tournaments/${tournamentId}/fields`, {
          data: { fields: [{ key: 'rating', label: 'Rating', valueType: 'decimal' }] },
        });
        expect(unknownType.status(), await unknownType.text()).toBe(400);
        expect(((await unknownType.json()) as { error: string }).error).toContain(
          "valueType must be 'number', 'integer' or 'text'"
        );
        expect(await (await request.get(`${API}/tournaments/${tournamentId}/fields`)).json()).toMatchObject({
          fields: [{ key: 'goals' }, { key: 'possession' }, { key: 'car' }],
        });

        // The report form sees them before anyone has typed anything.
        const before = await view(one, match.slug);
        expect(before.fields).toHaveLength(3);
        expect(before.stats, 'nothing reported yet').toEqual([]);

        const [aCaptain, aSecond] = memberUids.get(match.team1!.id)!;
        const [bCaptain] = memberUids.get(match.team2!.id)!;

        const reported = await one.post(`${API}/matches/${match.slug}/report`, {
          data: {
            result: sweep(1, 'team1'),
            stats: [
              { key: 'goals', playerUid: aCaptain, value: 3 },
              { key: 'goals', playerUid: aSecond, value: 2 },
              { key: 'goals', playerUid: bCaptain, value: 1 },
              { key: 'possession', team: 'team1', value: 58.5 },
              { key: 'possession', team: 'team2', value: 41.5 },
              { key: 'car', playerUid: aCaptain, value: '  Octane  ' },
              // Left blank, and the field is optional, so it is simply dropped.
              { key: 'car', playerUid: bCaptain, value: '' },
            ],
          },
        });
        expect(reported.status(), `reporting: ${await reported.text()}`).toBe(200);

        // On the match, with the field and the person on each value.
        const after = await view(one, match.slug);
        expect(after.stats).toHaveLength(6);
        const goals = valueOf(after.stats, 'goals', { uid: aCaptain })!;
        expect(goals).toMatchObject({
          label: 'Goals',
          valueType: 'integer',
          scope: 'player',
          mapNumber: 0,
          team: 'team1',
          value: 3,
        });
        expect(goals.playerId, 'the account behind the uid').toBe(captainSteamIds.get(match.team1!.id));
        expect(goals.playerName).toBeTruthy();
        expect(goals.reportId, 'filed against the report that carried it').toBeTruthy();

        // The side of a player value is read off the membership, not the body.
        expect(valueOf(after.stats, 'goals', { uid: bCaptain })!.team).toBe('team2');
        expect(valueOf(after.stats, 'possession', { team: 'team2' })!.value).toBe(41.5);
        // Text is trimmed; a blank one was never stored.
        expect(valueOf(after.stats, 'car', { uid: aCaptain })!.value).toBe('Octane');
        expect(valueOf(after.stats, 'car', { uid: bCaptain })).toBeUndefined();

        // The opponent sees the same numbers before deciding whether to agree.
        expect((await view(two, match.slug)).stats).toHaveLength(6);

        // Nobody has agreed yet, so the tournament listing says nothing.
        const unsettled = await tournamentStats(request, tournamentId);
        expect(unsettled.players, 'an unconfirmed report is not a statistic').toEqual([]);
        expect(unsettled.teams).toEqual([]);
        expect(unsettled.fields, 'the columns are known even so').toHaveLength(3);

        const confirmed = await two.post(`${API}/matches/${match.slug}/confirm`, {
          data: { revision: 1 },
        });
        expect(confirmed.status(), `confirming: ${await confirmed.text()}`).toBe(200);

        // And now it is one, to anyone: this listing needs no session.
        const anon = await playwright.request.newContext({ baseURL });
        try {
          const settled = await tournamentStats(anon, tournamentId);
          expect(settled.players).toHaveLength(3);
          const top = settled.players.find((p) => p.uid === aCaptain)!;
          expect(totalOf(top.totals, 'goals')).toMatchObject({ total: 3, average: 3, count: 1 });
          expect(totalOf(top.totals, 'car')).toMatchObject({ total: null, texts: ['Octane'] });
          expect(top.matches).toBe(1);
          expect(top.teams.map((t) => t.id)).toEqual([match.team1!.id]);
          expect(top.teams[0].name).toBeTruthy();

          const home = settled.teams.find((t) => t.id === match.team1!.id)!;
          expect(totalOf(home.totals, 'possession')).toMatchObject({ total: 58.5, count: 1 });
          expect(totalOf(home.totals, 'goals'), 'a player field is not a team total').toBeUndefined();
        } finally {
          await anon.dispose();
        }

        // The series itself finished exactly as it would have without any of
        // this: custom fields are display only, and the rating maths never
        // sees them.
        const finished = await request.get(`${MR}/${match.slug}/reports`);
        expect(((await finished.json()) as { winnerId: string | null }).winnerId).toBe(match.team1!.id);
      } finally {
        await one.dispose();
        await two.dispose();
      }
    }
  );

  test(
    'a report with a bad value is refused whole, and stores nothing',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'd6-bad', 2);
      await createTournament(request, {
        name: 'Refused',
        type: 'single_elimination',
        format: 'bo3',
        game: 'rocket-league',
        teamIds,
      });
      const [match] = await waitForLive(request, 1, 1);
      const one = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);
      const outsider = await playerContext(playwright, baseURL, outsiderSteamId);

      try {
        const tournamentId = (await view(one, match.slug)).match.tournamentId;
        await setFields(request, tournamentId, [
          { key: 'goals', label: 'Goals', valueType: 'integer', scope: 'player', required: true },
          { key: 'possession', label: 'Possession %', valueType: 'number', scope: 'team' },
          { key: 'car', label: 'Car', valueType: 'text', scope: 'player' },
        ]);

        const [aCaptain] = memberUids.get(match.team1!.id)!;
        const [bCaptain] = memberUids.get(match.team2!.id)!;
        /** Every required field filled in, so only the value under test is wrong. */
        const required = [
          { key: 'goals', playerUid: aCaptain, value: 1 },
          { key: 'goals', playerUid: bCaptain, value: 0 },
        ];
        // A best-of-3 decided in two games: `mapNumber` may be 0, 1 or 2.
        const result = sweep(3, 'team1');

        const refusals: Array<[string, unknown[], string]> = [
          [
            'a key the tournament does not ask for',
            [...required, { key: 'assits', playerUid: aCaptain, value: 2 }],
            "does not ask for 'assits'",
          ],
          [
            'a fraction in an integer field',
            [{ key: 'goals', playerUid: aCaptain, value: 1.5 }, ...required.slice(1)],
            'whole number',
          ],
          [
            'words in a number field',
            [...required, { key: 'possession', team: 'team1', value: 'lots' }],
            'must be a number',
          ],
          [
            'a number in a text field',
            [...required, { key: 'car', playerUid: aCaptain, value: 12 }],
            'must be text',
          ],
          [
            'a required field left blank for the other side',
            [required[0]],
            "'Goals' is required, and nothing was reported for team2",
          ],
          [
            'a player on neither team',
            [...required, { key: 'goals', playerUid: '00000000-0000-4000-8000-000000000000', value: 9 }],
            'is not on either team',
          ],
          [
            'a per-team field given a player',
            [...required, { key: 'possession', playerUid: aCaptain, value: 50 }],
            'takes no playerUid',
          ],
          [
            'a per-player field with no player',
            [...required, { key: 'goals', team: 'team1', value: 4 }],
            'playerUid is required',
          ],
          [
            'a player filed against the wrong side',
            [...required, { key: 'car', playerUid: aCaptain, team: 'team2', value: 'Dominus' }],
            'plays for team1',
          ],
          [
            'a game that was never played',
            [...required, { key: 'goals', playerUid: aCaptain, mapNumber: 3, value: 1 }],
            'mapNumber must be 0',
          ],
          [
            'the same player twice for one field',
            [...required, { key: 'goals', playerUid: aCaptain, value: 2 }],
            'given twice',
          ],
          [
            'a series total and a per-game value for the same player',
            [...required, { key: 'goals', playerUid: aCaptain, mapNumber: 1, value: 1 }],
            'not both',
          ],
          ['stats that are not a list', 'goals: 3' as unknown as unknown[], 'must be an array'],
        ];

        for (const [what, stats, message] of refusals) {
          const res = await one.post(`${API}/matches/${match.slug}/report`, {
            data: { result, stats },
          });
          expect(res.status(), `${what}: ${await res.text()}`).toBe(400);
          expect(((await res.json()) as { error: string }).error, what).toContain(message);
        }

        // Thirteen refusals later, the match is exactly where it started: no
        // report, no score, no half-written values.
        const untouched = await view(one, match.slug);
        expect(untouched.open, 'a refused report is not a report').toBeNull();
        expect(untouched.stats).toEqual([]);

        // And the authorization rules are unchanged by any of it.
        const stranger = await outsider.post(`${API}/matches/${match.slug}/report`, {
          data: { result, stats: required },
        });
        expect(stranger.status(), 'a captain of no team in this match').toBe(403);
      } finally {
        await one.dispose();
        await outsider.dispose();
      }
    }
  );

  test(
    'a new report replaces the values, and withdrawing one clears them',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'd6-again', 2);
      await createTournament(request, {
        name: 'Typed it wrong',
        type: 'single_elimination',
        format: 'bo1',
        game: 'chess',
        teamIds,
      });
      const [match] = await waitForLive(request, 1, 1);
      const one = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);

      try {
        const tournamentId = (await view(one, match.slug)).match.tournamentId;
        await setFields(request, tournamentId, [
          { key: 'moves', label: 'Moves', valueType: 'integer', scope: 'team', required: true },
        ]);

        const first = await one.post(`${API}/matches/${match.slug}/report`, {
          data: {
            result: sweep(1, 'team1'),
            stats: [
              { key: 'moves', team: 'team1', value: 40 },
              { key: 'moves', team: 'team2', value: 40 },
            ],
          },
        });
        expect(first.status(), await first.text()).toBe(200);
        expect(valueOf((await view(one, match.slug)).stats, 'moves', { team: 'team1' })!.value).toBe(40);

        // Reported again over the top: the second report supersedes the first,
        // and its numbers replace the first's rather than colliding with them.
        const second = await one.post(`${API}/matches/${match.slug}/report`, {
          data: {
            result: sweep(1, 'team1'),
            stats: [
              { key: 'moves', team: 'team1', value: 37 },
              { key: 'moves', team: 'team2', value: 37 },
            ],
          },
        });
        expect(second.status(), await second.text()).toBe(200);

        const redone = await view(one, match.slug);
        expect(redone.open!.revision).toBe(2);
        expect(redone.stats, 'one set, not two').toHaveLength(2);
        expect(valueOf(redone.stats, 'moves', { team: 'team1' })!.value).toBe(37);
        expect(redone.stats.every((s) => s.reportId !== null)).toBe(true);

        // Taken back: nothing this report said stands, its numbers included.
        const withdrawn = await one.post(`${API}/matches/${match.slug}/withdraw`, {
          data: { revision: 2 },
        });
        expect(withdrawn.status(), await withdrawn.text()).toBe(200);
        expect((await view(one, match.slug)).stats).toEqual([]);
        expect(await tournamentStats(request, tournamentId)).toMatchObject({ players: [], teams: [] });

        // A required field still has to be filled in when reporting again.
        const blank = await one.post(`${API}/matches/${match.slug}/report`, {
          data: { result: sweep(1, 'team1') },
        });
        expect(blank.status(), 'a required field cannot be skipped').toBe(400);
      } finally {
        await one.dispose();
      }
    }
  );

  test(
    'per-game values add up over a tournament, and a dropped field takes its values with it',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 'd6-sum', 2);
      await createTournament(request, {
        name: 'Added up',
        type: 'single_elimination',
        format: 'bo3',
        game: 'rocket-league',
        teamIds,
      });
      const [match] = await waitForLive(request, 1, 1);
      const one = await playerContext(playwright, baseURL, captainSteamIds.get(match.team1!.id)!);
      const two = await playerContext(playwright, baseURL, captainSteamIds.get(match.team2!.id)!);

      try {
        const tournamentId = (await view(one, match.slug)).match.tournamentId;
        await setFields(request, tournamentId, [
          { key: 'goals', label: 'Goals', valueType: 'integer', scope: 'player' },
          { key: 'shots', label: 'Shots', valueType: 'integer', scope: 'player' },
        ]);
        const [aCaptain] = memberUids.get(match.team1!.id)!;
        const [bCaptain] = memberUids.get(match.team2!.id)!;

        // Two games, a value per game rather than a series total.
        const reported = await one.post(`${API}/matches/${match.slug}/report`, {
          data: {
            result: sweep(3, 'team1'),
            stats: [
              { key: 'goals', playerUid: aCaptain, mapNumber: 1, value: 2 },
              { key: 'goals', playerUid: aCaptain, mapNumber: 2, value: 4 },
              { key: 'goals', playerUid: bCaptain, mapNumber: 1, value: 1 },
              { key: 'shots', playerUid: aCaptain, value: 9 },
            ],
          },
        });
        expect(reported.status(), await reported.text()).toBe(200);
        expect(
          (await view(one, match.slug)).stats.filter((s) => s.key === 'goals' && s.playerUid === aCaptain)
        ).toHaveLength(2);

        const confirmed = await two.post(`${API}/matches/${match.slug}/confirm`, {
          data: { revision: 1 },
        });
        expect(confirmed.status(), await confirmed.text()).toBe(200);

        const stats = await tournamentStats(request, tournamentId);
        const top = stats.players.find((p) => p.uid === aCaptain)!;
        expect(totalOf(top.totals, 'goals'), 'summed across the games').toMatchObject({
          total: 6,
          average: 3,
          count: 2,
        });
        expect(totalOf(top.totals, 'shots')).toMatchObject({ total: 9, count: 1 });
        expect(top.matches, 'one match, however many games').toBe(1);

        // Drop a field: its column and every value recorded against it go with
        // it, which is the honest reading of "these are the fields now".
        await setFields(request, tournamentId, [
          { key: 'goals', label: 'Goals scored', valueType: 'integer', scope: 'player' },
        ]);
        const trimmed = await tournamentStats(request, tournamentId);
        expect(trimmed.fields.map((f) => f.key)).toEqual(['goals']);
        // The row that stayed keeps its values, under its new label.
        expect(totalOf(trimmed.players.find((p) => p.uid === aCaptain)!.totals, 'goals')).toMatchObject({
          label: 'Goals scored',
          total: 6,
        });
        expect(
          (await view(one, match.slug)).stats.some((s) => s.key === 'shots'),
          'the dropped field took its values'
        ).toBe(false);
      } finally {
        await one.dispose();
        await two.dispose();
      }
    }
  );

  test(
    'the stats listing refuses a tournament that is not one',
    { tag: ['@api'] },
    async ({ request }) => {
      const missing = await request.get(`${API}/tournaments/99999/stats`);
      expect(missing.status()).toBe(404);
      const nonsense = await request.get(`${API}/tournaments/nope/stats`);
      expect(nonsense.status()).toBe(400);
    }
  );
});
