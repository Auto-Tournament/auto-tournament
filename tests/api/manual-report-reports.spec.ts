import { test, expect, type APIRequestContext } from '@playwright/test';
import { impersonatePlayer, signInViaRequest, stopImpersonating } from '../helpers/auth';
import { validateResult } from '../../api/src/integrations/manual-report/reports';
import { SWEEP_INTERVAL_MS, reportSweeper } from '../../api/src/integrations/manual-report/sweeper';
import { getIntegration } from '../../api/src/integrations/registry';

/**
 * The manual-report state machine (3.0 phase D, PR D3).
 *
 * A whole tournament played with nothing but typed-in results: report,
 * confirm, dispute, the two timeout actions, an admin resolving and
 * overriding, and a bracket that advances to a champion — all through
 * `matchLifecycle.applySeriesResult`, the same call CS2's `series.ended`
 * makes.
 *
 * The captain and admin HTTP routes are PR D4 and D5, so the machine is driven
 * here through the module's test-only routes
 * (`/api/test/integration/manual-report`), which resolve the acting account
 * exactly as the real routes will: a `players.uid` from
 * `resolveViewerAccount`, never a Steam ID.
 *
 * Each team gets its **own** captain account, and the admin impersonates one
 * to act as them (`asCaptain`). Two real accounts on two real memberships is
 * the only way "a team cannot confirm its own report" means anything; with one
 * account captaining both sides the rule would be untestable. `?as=captain`
 * stops the impersonating admin being treated as an admin.
 *
 * @tag api
 */

const MR = '/api/test/integration/manual-report';

type ListedMatch = {
  slug: string;
  game: string;
  round: number;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
  winner?: { id: string } | null;
};

type Side = 'team1' | 'team2';

type ReportRow = {
  id: number;
  revision: number;
  status: string;
  source: string;
  submittedByTeam: Side | null;
  confirmDeadline: number | null;
  timeoutAction: string | null;
  disputeReason: string | null;
  result: { seriesTeam1Score: number; seriesTeam2Score: number; winner: Side | null };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `teams.id` -> the Steam id of that team's captain, for this run. */
const captains = new Map<string, string>();

/** Teams with a captain account each, so the two sides are really two people. */
async function createTeams(request: APIRequestContext, prefix: string, count: number) {
  const stamp = `${Date.now()}`.slice(-7);
  const ids: string[] = [];
  for (let t = 0; t < count; t++) {
    const id = `${prefix}-${stamp}-${t}`;
    const captain = `76561199${stamp}${t}0`;
    const players = [
      { steamId: captain, name: `${prefix} ${t} captain` },
      { steamId: `76561199${stamp}${t}1`, name: `${prefix} ${t}.1` },
    ];
    const res = await request.post('/api/teams', {
      data: { id, name: `${prefix} ${stamp} ${t}`, players },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    captains.set(id, captain);
    ids.push(id);
  }
  return ids;
}

async function makeCaptain(request: APIRequestContext, teamId: string) {
  const steamId = captains.get(teamId);
  expect(steamId, `no captain recorded for ${teamId}`).toBeTruthy();
  const res = await request.post(`${MR}/teams/${teamId}/captain`, { data: { steamId } });
  expect(res.ok(), `promoting in ${teamId}: ${await res.text()}`).toBe(true);
}

/**
 * Run something as a team's captain: the admin impersonates that account, so
 * the request really is a different person than the one who reported.
 */
async function asCaptain<T>(
  request: APIRequestContext,
  teamId: string,
  run: () => Promise<T>
): Promise<T> {
  expect(await impersonatePlayer(request, captains.get(teamId)!)).toBe(true);
  try {
    return await run();
  } finally {
    await stopImpersonating(request);
  }
}

async function createTournament(
  request: APIRequestContext,
  data: {
    name: string;
    type: string;
    format: string;
    game?: string;
    teamIds: string[];
    settings?: unknown;
  }
) {
  const res = await request.post(`${MR}/tournament`, { data });
  expect(res.status(), `creating: ${await res.text()}`).toBe(200);
  for (const teamId of data.teamIds) await makeCaptain(request, teamId);
}

async function listMatches(request: APIRequestContext): Promise<ListedMatch[]> {
  const res = await request.get('/api/matches');
  expect(res.ok(), `listing matches: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { matches?: ListedMatch[] };
  return (body.matches ?? []).filter((m) => m.round >= 1);
}

async function start(request: APIRequestContext) {
  const res = await request.post('/api/tournament/start', { data: {} });
  expect(res.ok(), `starting: ${await res.text()}`).toBe(true);
}

async function waitForLive(request: APIRequestContext, round: number, count: number) {
  let live: ListedMatch[] = [];
  await expect
    .poll(
      async () => {
        live = (await listMatches(request)).filter(
          (m) => m.round === round && m.team1 && m.team2 && m.status === 'live'
        );
        return live.length;
      },
      { message: `round ${round} should go live`, timeout: 20_000 }
    )
    .toBe(count);
  return live;
}

async function reportsOf(request: APIRequestContext, slug: string) {
  const res = await request.get(`${MR}/${slug}/reports`);
  expect(res.ok(), `reading reports for ${slug}: ${await res.text()}`).toBe(true);
  return (await res.json()) as {
    matchStatus: string;
    winnerId: string | null;
    open: ReportRow | null;
    reports: ReportRow[];
  };
}

/** A best-of-N sweep for `winner`: the fewest games that decide it. */
function sweep(seriesLength: number, winner: Side) {
  const wins = Math.floor(seriesLength / 2) + 1;
  return {
    maps: Array.from({ length: wins }, () => ({
      team1Score: winner === 'team1' ? 3 : 1,
      team2Score: winner === 'team2' ? 3 : 1,
    })),
  };
}

type Action = 'report' | 'confirm' | 'dispute' | 'withdraw' | 'resolve' | 'override' | 'reopen';

/** Act on a match. `as: 'captain'` makes the signed-in admin act as a captain. */
async function act(
  request: APIRequestContext,
  slug: string,
  action: Action,
  opts: { as?: 'captain' | 'admin'; data?: unknown } = {}
) {
  const query = opts.as === 'captain' ? '?as=captain' : '';
  return request.post(`${MR}/${slug}/${action}${query}`, { data: opts.data ?? {} });
}

async function expectOk(res: Awaited<ReturnType<typeof act>>, what: string) {
  expect(res.status(), `${what}: ${await res.text()}`).toBe(200);
  return (await res.json()) as { report: ReportRow; finalized: boolean };
}

// ---------------------------------------------------------------------------
// The result check (no database)
// ---------------------------------------------------------------------------

test.describe('Manual-report: what counts as a result', () => {
  const bo3 = { seriesLength: 3, allowDraw: false };

  test('a decisive best-of-3 is normalized to games and a series score', () => {
    const checked = validateResult(
      { maps: [{ team1Score: 3, team2Score: 1 }, { team1Score: 2, team2Score: 4 }, { team1Score: 5, team2Score: 2 }] },
      bo3
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.result.seriesTeam1Score).toBe(2);
    expect(checked.result.seriesTeam2Score).toBe(1);
    expect(checked.result.winner).toBe('team1');
    // Game numbers are 1-based, and a game with no map stores no name.
    expect(checked.result.maps.map((m) => m.mapNumber)).toEqual([1, 2, 3]);
    expect(checked.result.maps.every((m) => m.mapName === null)).toBe(true);
  });

  test('a stated winner beats the scores, so a forfeit can be reported', () => {
    const checked = validateResult(
      { maps: [{ team1Score: 0, team2Score: 0, winner: 'team2' }, { team1Score: 0, team2Score: 0, winner: 'team2' }], note: 'Forfeit' },
      bo3
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.result.winner).toBe('team2');
    expect(checked.result.note).toBe('Forfeit');
  });

  test('refuses what a best-of-3 cannot be', () => {
    const errors = [
      validateResult({ maps: [] }, bo3),
      validateResult({ maps: [{ team1Score: 3, team2Score: 1 }] }, bo3),
      validateResult({ maps: Array(4).fill({ team1Score: 3, team2Score: 1 }) }, bo3),
      validateResult({ maps: [{ team1Score: -1, team2Score: 1 }] }, bo3),
      validateResult({ maps: [{ team1Score: 'x', team2Score: 1 }] }, bo3),
      // A level game, in a tournament that allows no draw.
      validateResult({ maps: [{ team1Score: 2, team2Score: 2 }] }, { seriesLength: 1, allowDraw: false }),
    ];
    for (const [i, result] of errors.entries()) {
      expect(result.ok, `case ${i}`).toBe(false);
    }
  });

  test('a draw is a result when the tournament allows one', () => {
    const checked = validateResult(
      { maps: [{ team1Score: 2, team2Score: 2 }] },
      { seriesLength: 1, allowDraw: true }
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.result.winner).toBeNull();
    expect(checked.result.maps[0].winner).toBeNull();

    // A level series that is genuinely over is a result too.
    const drawn = validateResult(
      { maps: [{ team1Score: 2, team2Score: 1 }, { team1Score: 0, team2Score: 3 }] },
      { seriesLength: 3, allowDraw: true }
    );
    expect(drawn.ok).toBe(true);
  });

  test('allowing draws does not let a series be cut short', () => {
    // "We won the first, then went home" must not finish a best-of-three,
    // whether or not the tournament allows a drawn series.
    for (const allowDraw of [false, true]) {
      const checked = validateResult({ maps: [{ team1Score: 3, team2Score: 1 }] }, {
        seriesLength: 3,
        allowDraw,
      });
      expect(checked.ok, `allowDraw: ${allowDraw}`).toBe(false);
      if (checked.ok) continue;
      expect(checked.error).toContain('Neither side has won 2 of 3');
    }
  });
});

// ---------------------------------------------------------------------------
// The sweeper's own lifecycle
// ---------------------------------------------------------------------------

test.describe('Manual-report: the timeout sweeper', () => {
  test('starts and stops with the module, and never twice', () => {
    const module = getIntegration('manual-report');
    expect(typeof module.start).toBe('function');
    expect(typeof module.stop).toBe('function');

    // This process is not the API, so the sweeper is idle here.
    expect(reportSweeper.isRunning()).toBe(false);
    reportSweeper.start(SWEEP_INTERVAL_MS);
    expect(reportSweeper.isRunning()).toBe(true);
    // Starting again is a no-op, not a second interval.
    reportSweeper.start(SWEEP_INTERVAL_MS);
    expect(reportSweeper.isRunning()).toBe(true);

    reportSweeper.stop();
    expect(reportSweeper.isRunning()).toBe(false);
    // Stopping when it was never started is safe.
    reportSweeper.stop();
    expect(reportSweeper.isRunning()).toBe(false);
  });

  test('sweeps often enough to be useful and rarely enough to be cheap', () => {
    // Deadlines are minutes to days away; a minute of lag costs nothing, and
    // a sweep that ran every second would be a query per second forever.
    expect(SWEEP_INTERVAL_MS).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// Against a live API
// ---------------------------------------------------------------------------

test.describe.serial('Manual-report: reporting a tournament to a champion', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await request.put('/api/settings', {
      data: { webhookUrl: 'http://localhost:3069', simulateMatches: false },
    });
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/tournament');
  });

  test('report and confirm finishes the series and advances the bracket', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-happy', 4);
    await createTournament(request, {
      name: 'Reported cup',
      type: 'single_elimination',
      format: 'bo3',
      game: 'rocket-league',
      teamIds,
      settings: { manualReport: { confirmation: 'opponent', confirmTimeoutMin: 60 } },
    });
    await start(request);
    const round1 = await waitForLive(request, 1, 2);

    // team1's captain reports. The match stays live: nobody has agreed yet.
    const submitted = await expectOk(
      await asCaptain(request, round1[0].team1!.id, () =>
        act(request, round1[0].slug, 'report', { as: 'captain', data: { result: sweep(3, 'team1') } })
      ),
      'reporting'
    );
    expect(submitted.report).toMatchObject({
      revision: 1,
      status: 'submitted',
      source: 'report',
      submittedByTeam: 'team1',
      timeoutAction: 'auto_confirm',
    });
    expect(submitted.report.confirmDeadline).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(submitted.finalized).toBe(false);
    expect((await reportsOf(request, round1[0].slug)).matchStatus).toBe('live');

    // The opponent confirms, and that is what finishes the series.
    const confirmed = await expectOk(
      await asCaptain(request, round1[0].team2!.id, () =>
        act(request, round1[0].slug, 'confirm', { as: 'captain' })
      ),
      'confirming'
    );
    expect(confirmed.report.status).toBe('confirmed');
    expect(confirmed.finalized).toBe(true);

    const after = await reportsOf(request, round1[0].slug);
    expect(after.matchStatus).toBe('completed');
    expect(after.winnerId).toBe(round1[0].team1!.id);
    expect(after.open).toBeNull();

    // The result went through applySeriesResult: the games are map results
    // with no map name, and the source is on the record as a report.
    const detail = await request.get(`/api/matches/${round1[0].slug}`);
    const match = ((await detail.json()) as {
      match: { mapResults?: Array<{ mapNumber: number; mapName: string | null; winnerTeam: string }> };
    }).match;
    expect(match.mapResults).toHaveLength(2);
    expect(match.mapResults!.every((r) => r.mapName === null)).toBe(true);
    expect(match.mapResults!.map((r) => r.winnerTeam)).toEqual(['team1', 'team1']);

    // Finish the other semi and the bracket advances by itself.
    await expectOk(
      await asCaptain(request, round1[1].team2!.id, () =>
        act(request, round1[1].slug, 'report', { as: 'captain', data: { result: sweep(3, 'team2') } })
      ),
      'reporting the other semi'
    );
    await expectOk(
      await asCaptain(request, round1[1].team1!.id, () =>
        act(request, round1[1].slug, 'confirm', { as: 'captain' })
      ),
      'confirming'
    );

    const [final] = await waitForLive(request, 2, 1);
    expect([final.team1!.id, final.team2!.id].sort()).toEqual(
      [round1[0].team1!.id, round1[1].team2!.id].sort()
    );

    // And a champion.
    await expectOk(
      await asCaptain(request, final.team1!.id, () =>
        act(request, final.slug, 'report', { as: 'captain', data: { result: sweep(3, 'team1') } })
      ),
      'reporting the final'
    );
    await expectOk(
      await asCaptain(request, final.team2!.id, () =>
        act(request, final.slug, 'confirm', { as: 'captain' })
      ),
      'confirming the final'
    );

    await expect
      .poll(
        async () => {
          const res = await request.get('/api/tournament');
          return ((await res.json()) as { tournament?: { status?: string } }).tournament?.status;
        },
        { message: 'the tournament should complete', timeout: 20_000 }
      )
      .toBe('completed');

    const done = await request.get('/api/tournament');
    const tournament = ((await done.json()) as { tournament: { winner?: { id: string } | null } }).tournament;
    expect(tournament.winner?.id).toBe(final.team1!.id);
    expect((await listMatches(request)).every((m) => m.status === 'completed')).toBe(true);
  });

  test('a team cannot answer its own report, and a newer one supersedes it', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-rules', 2);
    await createTournament(request, {
      name: 'Rules',
      type: 'single_elimination',
      format: 'bo1',
      game: 'chess',
      teamIds,
    });
    await start(request);
    const [match] = await waitForLive(request, 1, 1);

    await expectOk(
      await asCaptain(request, match.team1!.id, () =>
        act(request, match.slug, 'report', { as: 'captain', data: { result: sweep(1, 'team1') } })
      ),
      'reporting'
    );

    // The side that reported cannot also answer: the whole point of asking is
    // that somebody else agrees.
    for (const action of ['confirm', 'dispute'] as const) {
      const res = await asCaptain(request, match.team1!.id, () =>
        act(request, match.slug, action, { as: 'captain' })
      );
      expect(res.status(), `${action} by the reporting side`).toBe(403);
      expect(await res.text()).toContain('cannot confirm or dispute its own report');
    }

    // Nor can someone who captains neither team.
    const outsider = await act(request, match.slug, 'confirm', { as: 'captain' });
    expect(outsider.status()).toBe(403);
    expect(await outsider.text()).toContain('captains neither team');

    // A second report from the same side supersedes the first rather than
    // replacing it: at most one open report, and the history stays whole.
    const second = await expectOk(
      await asCaptain(request, match.team1!.id, () =>
        act(request, match.slug, 'report', { as: 'captain', data: { result: sweep(1, 'team2') } })
      ),
      'reporting again'
    );
    expect(second.report.revision).toBe(2);

    const state = await reportsOf(request, match.slug);
    expect(state.reports.map((r) => [r.revision, r.status])).toEqual([
      [2, 'submitted'],
      [1, 'superseded'],
    ]);
    expect(state.open?.revision).toBe(2);
    expect(state.matchStatus).toBe('live');

    // Withdrawing it leaves the match with nothing open and still live.
    const withdrawn = await expectOk(
      await asCaptain(request, match.team1!.id, () =>
        act(request, match.slug, 'withdraw', { as: 'captain' })
      ),
      'withdrawing'
    );
    expect(withdrawn.report.status).toBe('withdrawn');
    const empty = await reportsOf(request, match.slug);
    expect(empty.open).toBeNull();
    expect(empty.matchStatus).toBe('live');
  });

  test('a dispute parks the match for an admin, who resolves it', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-dispute', 2);
    await createTournament(request, {
      name: 'Disputed',
      type: 'single_elimination',
      format: 'bo1',
      game: 'chess',
      teamIds,
    });
    await start(request);
    const [match] = await waitForLive(request, 1, 1);

    await expectOk(
      await asCaptain(request, match.team1!.id, () =>
        act(request, match.slug, 'report', { as: 'captain', data: { result: sweep(1, 'team1') } })
      ),
      'reporting'
    );
    const disputed = await expectOk(
      await asCaptain(request, match.team2!.id, () =>
        act(request, match.slug, 'dispute', { as: 'captain', data: { reason: 'We won 1-0' } })
      ),
      'disputing'
    );
    expect(disputed.report).toMatchObject({ status: 'disputed', disputeReason: 'We won 1-0' });
    expect(disputed.report.confirmDeadline).toBeNull();
    expect(disputed.finalized).toBe(false);

    const parked = await reportsOf(request, match.slug);
    expect(parked.matchStatus).toBe('needs_decision');
    expect(parked.winnerId).toBeNull();
    // A disputed report is still the open one, so nothing can be reported over it.
    expect(parked.open?.status).toBe('disputed');

    // The admin settles it with a result of their own: a new admin revision,
    // the disputed one superseded, and the series finished.
    const resolved = await expectOk(
      await act(request, match.slug, 'resolve', { data: { result: sweep(1, 'team2') } }),
      'resolving'
    );
    expect(resolved.report).toMatchObject({ revision: 2, source: 'admin', status: 'confirmed' });
    expect(resolved.finalized).toBe(true);

    const settled = await reportsOf(request, match.slug);
    expect(settled.matchStatus).toBe('completed');
    expect(settled.winnerId).toBe(match.team2!.id);
    expect(settled.reports.map((r) => [r.revision, r.status])).toEqual([
      [2, 'confirmed'],
      [1, 'superseded'],
    ]);
  });

  test('the deadline passes: auto_confirm takes the report', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-auto', 2);
    await createTournament(request, {
      name: 'Auto confirm',
      type: 'single_elimination',
      format: 'bo1',
      game: 'chess',
      teamIds,
      settings: { manualReport: { confirmTimeoutMin: 60, timeoutAction: 'auto_confirm' } },
    });
    await start(request);
    const [match] = await waitForLive(request, 1, 1);

    await expectOk(
      await asCaptain(request, match.team1!.id, () =>
        act(request, match.slug, 'report', { as: 'captain', data: { result: sweep(1, 'team1') } })
      ),
      'reporting'
    );
    // A sweep before the deadline does nothing.
    expect((await request.post(`${MR}/sweep`, { data: {} })).ok()).toBe(true);
    expect((await reportsOf(request, match.slug)).open?.status).toBe('submitted');

    // Move the deadline into the past and sweep again.
    expect(
      (await request.post(`${MR}/${match.slug}/deadline`, { data: { minutesFromNow: -1 } })).ok()
    ).toBe(true);
    expect((await request.post(`${MR}/sweep`, { data: {} })).ok()).toBe(true);

    const swept = await reportsOf(request, match.slug);
    expect(swept.open).toBeNull();
    expect(swept.reports[0].status).toBe('confirmed');
    expect(swept.matchStatus).toBe('completed');
    expect(swept.winnerId).toBe(match.team1!.id);

    // Sweeping again changes nothing: the report is closed and the match is done.
    expect((await request.post(`${MR}/sweep`, { data: {} })).ok()).toBe(true);
    expect((await reportsOf(request, match.slug)).reports).toHaveLength(1);
  });

  test('the deadline passes: escalate asks an admin instead', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-esc', 2);
    await createTournament(request, {
      name: 'Escalate',
      type: 'single_elimination',
      format: 'bo1',
      game: 'chess',
      teamIds,
      settings: { manualReport: { confirmTimeoutMin: 30, timeoutAction: 'escalate' } },
    });
    await start(request);
    const [match] = await waitForLive(request, 1, 1);

    const submitted = await expectOk(
      await asCaptain(request, match.team1!.id, () =>
        act(request, match.slug, 'report', { as: 'captain', data: { result: sweep(1, 'team1') } })
      ),
      'reporting'
    );
    expect(submitted.report.timeoutAction).toBe('escalate');

    await request.post(`${MR}/${match.slug}/deadline`, { data: { minutesFromNow: -1 } });
    expect((await request.post(`${MR}/sweep`, { data: {} })).ok()).toBe(true);

    // The match waits for an admin, and the report stays open so nothing can
    // be reported over it while they look. Nothing was finalized.
    const escalated = await reportsOf(request, match.slug);
    expect(escalated.matchStatus).toBe('needs_decision');
    expect(escalated.winnerId).toBeNull();
    expect(escalated.open).toMatchObject({ status: 'submitted', confirmDeadline: null });

    // Clearing the deadline is what takes it out of the sweep, so a second
    // sweep does not act on it twice.
    expect((await request.post(`${MR}/sweep`, { data: {} })).ok()).toBe(true);
    expect((await reportsOf(request, match.slug)).matchStatus).toBe('needs_decision');

    // The admin takes it as reported.
    const resolved = await expectOk(await act(request, match.slug, 'resolve'), 'resolving');
    expect(resolved.report).toMatchObject({ revision: 1, status: 'confirmed' });
    expect(resolved.finalized).toBe(true);
    const done = await reportsOf(request, match.slug);
    expect(done.matchStatus).toBe('completed');
    expect(done.winnerId).toBe(match.team1!.id);
  });

  test('no confirmation required: a report stands on its own', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-none', 2);
    await createTournament(request, {
      name: 'No confirmation',
      type: 'single_elimination',
      format: 'bo1',
      game: 'chess',
      teamIds,
      settings: { manualReport: { confirmation: 'none' } },
    });
    await start(request);
    const [match] = await waitForLive(request, 1, 1);

    const reported = await expectOk(
      await asCaptain(request, match.team2!.id, () =>
        act(request, match.slug, 'report', { as: 'captain', data: { result: sweep(1, 'team2') } })
      ),
      'reporting'
    );
    expect(reported.report).toMatchObject({ status: 'confirmed', confirmation: 'none' });
    expect(reported.report.confirmDeadline).toBeNull();
    expect(reported.finalized).toBe(true);

    const done = await reportsOf(request, match.slug);
    expect(done.matchStatus).toBe('completed');
    expect(done.winnerId).toBe(match.team2!.id);
  });

  test('an admin overrides, and reopens only while nothing downstream has finished', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-admin', 4);
    await createTournament(request, {
      name: 'Admin',
      type: 'single_elimination',
      format: 'bo1',
      game: 'chess',
      teamIds,
      settings: { manualReport: { confirmation: 'opponent', confirmTimeoutMin: 0 } },
    });
    await start(request);
    const round1 = await waitForLive(request, 1, 2);
    const [first, second] = round1;

    // An admin sets the result outright, with no report to settle.
    const overridden = await expectOk(
      await act(request, first.slug, 'override', { data: { result: sweep(1, 'team1') } }),
      'overriding'
    );
    expect(overridden.report).toMatchObject({ source: 'admin', status: 'confirmed', submittedByTeam: null });
    expect(overridden.finalized).toBe(true);
    expect((await reportsOf(request, first.slug)).winnerId).toBe(first.team1!.id);

    // A finished match cannot simply be overridden again: the result is
    // downstream already.
    const again = await act(request, first.slug, 'override', { data: { result: sweep(1, 'team2') } });
    expect(again.status()).toBe(409);
    expect(await again.text()).toContain('reopen it first');

    // Nothing downstream has finished yet, so it can be reopened...
    const reopened = await act(request, first.slug, 'reopen');
    expect(reopened.status(), await reopened.text()).toBe(200);
    const live = await reportsOf(request, first.slug);
    expect(live.matchStatus).toBe('live');
    expect(live.winnerId).toBeNull();
    // Its recorded games went with it, and the result that stood is superseded.
    expect(live.reports.every((r) => r.status === 'superseded')).toBe(true);

    // ...and reported again, the other way.
    const redone = await expectOk(
      await act(request, first.slug, 'override', { data: { result: sweep(1, 'team2') } }),
      'overriding after the reopen'
    );
    expect(redone.finalized).toBe(true);
    expect((await reportsOf(request, first.slug)).winnerId).toBe(first.team2!.id);

    // Finish the other semi so the final has both teams and goes live; the
    // first match now feeds a match that has started, so reopening it is
    // refused.
    await expectOk(
      await act(request, second.slug, 'override', { data: { result: sweep(1, 'team1') } }),
      'overriding the other semi'
    );
    await waitForLive(request, 2, 1);

    const refused = await act(request, first.slug, 'reopen');
    expect(refused.status()).toBe(409);
    expect(await refused.text()).toContain('already started or finished');
  });

  test('a match that is not reported manually is refused', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-cs2', 2);
    const created = await request.post('/api/tournament', {
      data: {
        name: 'CS2',
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno', 'de_nuke'],
        teamIds,
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const [cs2Match] = await listMatches(request);
    expect(cs2Match.game).toBe('cs2');

    for (const action of ['report', 'override', 'reopen'] as const) {
      const res = await act(request, cs2Match.slug, action, { data: { result: sweep(1, 'team1') } });
      expect(res.status(), action).toBe(409);
      expect(await res.text()).toContain('not reported manually');
    }
    expect((await act(request, 'no-such-match', 'report')).status()).toBe(404);
  });
});
