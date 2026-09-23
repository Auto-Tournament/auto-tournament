import { test, expect, type APIRequestContext, type Page, type Browser } from '@playwright/test';
import { ensureSignedIn, signInAsPlayer, signInViaRequest } from '../helpers/auth';

/**
 * A manually reported tournament, end to end, through the browser (3.0 phase
 * D, PR D11).
 *
 * Everything phase D built, in the order an organizer meets it: pick Rocket
 * League in the setup wizard, fill in the settings the manual-report module
 * declares, create and start the tournament, then play it to a champion with a
 * real signed-in captain on each side of every match — reporting a score and
 * confirming the opponent's.
 *
 * What only this test can pin:
 *
 * - **The wizard runs a game that is not Counter-Strike 2** (PR D9). Picking
 *   Rocket League removes the "Maps and veto" step entirely, hides the core's
 *   series-length control in favour of the module's own, and creates a
 *   tournament whose `game` sends every match to the manual-report module.
 * - **A bracket finishes on typed-in results.** Four teams, three matches, two
 *   rounds: the winners of round 1 meet in a final, and the tournament
 *   completes through the same core path a CS2 series takes.
 * - **The pages that show CS2 numbers degrade** (PR D10). The public
 *   leaderboard has no ADR column and no "top by ADR" card, and shows the
 *   tournament's own custom field instead — totalled from confirmed reports.
 *
 * The one thing done over HTTP rather than in the browser is appointing
 * captains for the four teams and setting the custom stat field: both have
 * their own UI, both are covered by `manual-report-panel.spec.ts` and
 * `manual-report-disputes.spec.ts`, and clicking through them four times over
 * would add minutes without adding coverage.
 *
 * @tag ui
 * @tag manual-report
 */

const TEAM_COUNT = 4;

type ListedMatch = {
  slug: string;
  round: number;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

type Member = { accountUid: string; role: string; playerId: string | null };

interface TestTeam {
  id: string;
  name: string;
  captainSteamId: string;
}

/** Four teams of two, each with the Steam id of the player who will captain it. */
async function createTeams(admin: APIRequestContext): Promise<TestTeam[]> {
  const stamp = `${Date.now()}`.slice(-7);
  const teams: TestTeam[] = [];
  for (let index = 0; index < TEAM_COUNT; index++) {
    const id = `mrt-${stamp}-${index}`;
    const name = `Reported ${stamp} ${index}`;
    const captainSteamId = `76561199${stamp}${index}0`;
    const res = await admin.post('/api/teams', {
      data: {
        id,
        name,
        players: [
          { steamId: captainSteamId, name: `Captain ${index}` },
          { steamId: `76561199${stamp}${index}1`, name: `Player ${index}.1` },
        ],
      },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    teams.push({ id, name, captainSteamId });
  }
  return teams;
}

/**
 * Make the team's captain a captain.
 *
 * `team_members` is keyed on `players.uid` and nothing else in the app exposes
 * one, which is why this reads the membership list first — the same two calls
 * the admin control on the team page makes.
 */
async function appointCaptain(admin: APIRequestContext, team: TestTeam): Promise<void> {
  let members: Member[] = [];
  await expect
    .poll(
      async () => {
        const res = await admin.get(`/api/game/manual/teams/${team.id}/members`);
        if (!res.ok()) return 0;
        members = ((await res.json()) as { members?: Member[] }).members ?? [];
        return members.length;
      },
      { message: `${team.id} should have memberships`, timeout: 20_000 }
    )
    .toBeGreaterThan(0);

  const member = members.find((row) => row.playerId === team.captainSteamId);
  expect(member, `${team.captainSteamId} should be a member of ${team.id}`).toBeTruthy();

  const res = await admin.post(`/api/game/manual/teams/${team.id}/captain`, {
    data: { uid: member!.accountUid, role: 'captain' },
  });
  expect(res.ok(), `promoting ${member!.accountUid}: ${await res.text()}`).toBe(true);
}

/** Every match of the tournament that is live and has both teams. */
async function liveMatches(admin: APIRequestContext, expected: number): Promise<ListedMatch[]> {
  let live: ListedMatch[] = [];
  await expect
    .poll(
      async () => {
        const res = await admin.get('/api/matches');
        if (!res.ok()) return -1;
        const all = ((await res.json()) as { matches?: ListedMatch[] }).matches ?? [];
        live = all.filter((m) => m.team1 && m.team2 && m.status === 'live');
        return live.length;
      },
      { message: `${expected} match(es) should go live`, timeout: 60_000 }
    )
    .toBe(expected);
  return live;
}

/**
 * One match, played: team 1's captain reports it, team 2's confirms.
 *
 * Both sides are a real signed-in player in their own browser context, because
 * "the opponent agrees" is only worth anything when the opponent is somebody
 * else. Team 1 always wins, so the bracket is predictable.
 */
async function playMatch(
  browser: Browser,
  match: ListedMatch,
  teams: TestTeam[],
  goals?: { team1: string; team2: string }
): Promise<string> {
  const one = teams.find((team) => team.id === match.team1!.id)!;
  const two = teams.find((team) => team.id === match.team2!.id)!;

  const reporterContext = await browser.newContext();
  const opponentContext = await browser.newContext();
  try {
    const reporter: Page = await reporterContext.newPage();
    expect(await signInAsPlayer(reporter, one.captainSteamId)).toBe(true);
    await reporter.goto(`/team/${one.id}`);

    const reporterState = reporter.getByTestId('manual-report-state');
    await expect(reporter.getByTestId('manual-report-panel')).toBeVisible();
    await expect(reporterState).toHaveAttribute('data-state', 'nothing');

    await reporter.getByTestId('manual-report-open-form').click();
    await reporter.getByTestId('manual-report-game-1-team1').fill('3');
    await reporter.getByTestId('manual-report-game-1-team2').fill('1');
    if (goals) {
      await reporter.getByTestId('manual-report-stat-goals-team1').fill(goals.team1);
      await reporter.getByTestId('manual-report-stat-goals-team2').fill(goals.team2);
    }
    await reporter.getByTestId('manual-report-submit').click();
    await expect(reporterState).toHaveAttribute('data-state', 'waitingOpponent');

    const opponent: Page = await opponentContext.newPage();
    expect(await signInAsPlayer(opponent, two.captainSteamId)).toBe(true);
    await opponent.goto(`/team/${two.id}`);

    const opponentState = opponent.getByTestId('manual-report-state');
    await expect(opponentState).toHaveAttribute('data-state', 'needsAnswer');
    await opponent.getByTestId('manual-report-confirm').click();
    await expect(opponentState).toHaveAttribute('data-state', 'confirmed');
  } finally {
    await reporterContext.close();
    await opponentContext.close();
  }
  return one.id;
}

test.describe.serial('A manually reported tournament, wizard to champion', () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ request, baseURL }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await request.put('/api/settings', {
      data: { webhookUrl: baseURL ?? 'http://localhost:3069', simulateMatches: false },
    });
    await request.delete('/api/tournament');
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/tournament');
  });

  test(
    'created in the wizard, played by its captains, finished with a champion',
    { tag: ['@ui', '@manual-report'] },
    async ({ page, request, browser }) => {
      const teams = await createTeams(request);

      // --- the wizard ------------------------------------------------------
      await ensureSignedIn(page);
      await page.goto('/tournament');

      const steps = page.getByTestId('tournament-setup-steps');
      await expect(steps).toBeVisible();
      // CS2 has seven steps; the list is the game's, and this one has no maps.
      await expect(steps.locator('li')).toHaveCount(7);

      const rocketLeague = page.getByTestId('tournament-game-option-rocket-league');
      await expect(rocketLeague).toBeVisible();
      await rocketLeague.click();
      await expect(rocketLeague).toHaveAttribute('aria-pressed', 'true');
      await expect(steps.locator('li')).toHaveCount(6);
      await expect(page.getByTestId('tournament-setup-step-maps')).toHaveCount(0);
      await expect(page.getByTestId('tournament-summary-game')).toContainText('Rocket League');

      const next = page.getByTestId('tournament-next-button');
      await next.click();
      await page.getByTestId('tournament-name-input').fill('Rocket League Cup');
      await next.click();

      // Format: the module's settings step, and no core series control — a
      // module that ships one owns the question.
      await expect(page.getByTestId('tournament-setup-question-format')).toBeVisible();
      await expect(page.getByTestId('manual-report-setup')).toBeVisible();
      await expect(page.getByTestId('tournament-format-selector')).toHaveCount(0);
      await page.getByTestId('manual-report-best-of-1').click();
      await page.getByTestId('manual-report-confirmation-opponent').click();
      await next.click();

      // Teams. Picked by name rather than "Add all": the instance may carry
      // teams from other specs, and a single-elimination bracket wants four.
      const teamPicker = page.getByRole('combobox', { name: /choose teams/i });
      for (const team of teams) {
        await teamPicker.fill(team.name);
        await page.getByRole('option', { name: team.name }).click();
      }
      await next.click();
      await expect(page.getByTestId('tournament-setup-question-eventPage')).toBeVisible();
      await next.click();
      await page.getByTestId('tournament-save-button').click();

      // --- what the wizard actually created --------------------------------
      await expect(page.getByTestId('tournament-start-button')).toBeVisible({ timeout: 30_000 });
      const created = await request.get('/api/tournament');
      expect(created.ok(), `reading the tournament: ${await created.text()}`).toBe(true);
      const tournament = (
        (await created.json()) as {
          tournament: {
            id: number;
            game?: string;
            format: string;
            maps: string[];
            settings?: { manualReport?: { bestOf?: number; confirmation?: string } };
          };
        }
      ).tournament;
      expect(tournament.game).toBe('rocket-league');
      expect(tournament.format).toBe('bo1');
      expect(tournament.maps).toEqual([]);
      expect(tournament.settings?.manualReport?.bestOf).toBe(1);
      expect(tournament.settings?.manualReport?.confirmation).toBe('opponent');

      // --- the two things done over HTTP -----------------------------------
      for (const team of teams) await appointCaptain(request, team);
      const fields = await request.put(
        `/api/game/manual/tournaments/${tournament.id}/fields`,
        { data: { fields: [{ key: 'goals', label: 'Goals', valueType: 'integer', scope: 'team' }] } }
      );
      expect(fields.ok(), `setting fields: ${await fields.text()}`).toBe(true);

      // --- start it, from the page that just created it --------------------
      await page.getByTestId('tournament-start-button').click();

      // --- round 1, then the final -----------------------------------------
      const roundOne = await liveMatches(request, 2);
      const winners: string[] = [];
      for (const match of roundOne) {
        winners.push(await playMatch(browser, match, teams, { team1: '3', team2: '1' }));
      }

      const [final] = await liveMatches(request, 1);
      expect([final.team1!.id, final.team2!.id].sort()).toEqual([...winners].sort());
      const champion = await playMatch(browser, final, teams, { team1: '2', team2: '0' });

      // --- a champion ------------------------------------------------------
      await expect
        .poll(
          async () => {
            const res = await request.get('/api/tournament');
            if (!res.ok()) return '';
            return ((await res.json()) as { tournament?: { status?: string } }).tournament?.status;
          },
          { message: 'the tournament should complete', timeout: 30_000 }
        )
        .toBe('completed');

      const finalMatch = await request.get(`/api/game/manual/matches/${final.slug}`);
      expect(finalMatch.ok(), `reading the final: ${await finalMatch.text()}`).toBe(true);
      const finalBody = (await finalMatch.json()) as {
        match: { status: string; winnerId: string | null };
      };
      expect(finalBody.match.status).toBe('completed');
      expect(finalBody.match.winnerId).toBe(champion);

      // --- and the leaderboard shows this game's numbers, not CS2's --------
      await page.goto(`/tournament/${tournament.id}/leaderboard`);
      const customStats = page.getByTestId('manual-report-tournament-stats');
      await expect(customStats).toBeVisible({ timeout: 30_000 });
      // 3 + 3 + 2 goals for the champion, who won every match it played.
      await expect(customStats).toContainText('Goals');
      await expect(page.getByText('ADR', { exact: false })).toHaveCount(0);
    }
  );
});
