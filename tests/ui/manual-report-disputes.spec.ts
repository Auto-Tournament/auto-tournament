import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ensureSignedIn, signInAsPlayer, signInViaRequest } from '../helpers/auth';

/**
 * A dispute, from the two captains arguing to an admin settling it
 * (3.0 phase D, PR D8).
 *
 * The whole round trip in the browser, with a real signed-in captain on each
 * side and an admin on the Disputes page: one captain reports a score *and*
 * the tournament's custom stat field, the other reads both, disagrees and says
 * why, the dispute appears in the admin queue with what each side said, and
 * the admin rules the other way. The match ends up completed, with the winner
 * the admin chose rather than the one who reported.
 *
 * Three things this pins that an API test cannot:
 *
 * - **The custom fields are fillable.** D7 shipped the form as scores only.
 *   A per-player field is filed against a `players.uid`, which nothing a
 *   captain could call handed out before this PR, so "the API accepts stats"
 *   and "a captain can enter one" were different claims.
 * - **The queue is reachable and it empties.** The Disputes page is a sibling
 *   of the admin home, linked from it, and the row leaves the moment the
 *   ruling lands — an admin should not have to guess whether it worked.
 * - **Both captains find out without reloading.** Neither captain's page is
 *   reloaded after the dispute; they arrive at the admin's result on the
 *   module's `match:report` emit alone.
 *
 * @tag ui
 * @tag manual-report
 */

const MR = '/api/test/integration/manual-report';
const API = '/api/game/manual';

type ListedMatch = {
  slug: string;
  round: number;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

type Member = { accountUid: string; role: string; playerId: string | null };

/** Two teams of two, with the Steam id of the player we make captain. */
async function createTeams(admin: APIRequestContext, prefix: string, count: number) {
  const stamp = `${Date.now()}`.slice(-7);
  const teams: Array<{ id: string; captainSteamId: string }> = [];
  for (let index = 0; index < count; index++) {
    const id = `${prefix}-${stamp}-${index}`;
    const captainSteamId = `76561199${stamp}${index}0`;
    const res = await admin.post('/api/teams', {
      data: {
        id,
        name: `${prefix} ${stamp} ${index}`,
        players: [
          { steamId: captainSteamId, name: `${prefix} ${index} captain` },
          { steamId: `76561199${stamp}${index}1`, name: `${prefix} ${index}.1` },
        ],
      },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    teams.push({ id, captainSteamId });
  }
  return teams;
}

/** The `players.uid` behind a Steam id, and make that account a captain. */
async function makeCaptain(
  admin: APIRequestContext,
  teamId: string,
  steamId: string
): Promise<string> {
  let members: Member[] = [];
  await expect
    .poll(
      async () => {
        const res = await admin.get(`${API}/teams/${teamId}/members`);
        if (!res.ok()) return 0;
        members = ((await res.json()) as { members?: Member[] }).members ?? [];
        return members.length;
      },
      { message: `${teamId} should have memberships`, timeout: 20_000 }
    )
    .toBeGreaterThan(0);

  const member = members.find((row) => row.playerId === steamId);
  expect(member, `${steamId} should be a member of ${teamId}`).toBeTruthy();
  const promoted = await admin.post(`${API}/teams/${teamId}/captain`, {
    data: { uid: member!.accountUid, role: 'captain' },
  });
  expect(promoted.ok(), `promoting in ${teamId}: ${await promoted.text()}`).toBe(true);
  return member!.accountUid;
}

async function waitForLiveMatch(admin: APIRequestContext, count: number): Promise<ListedMatch[]> {
  let live: ListedMatch[] = [];
  await expect
    .poll(
      async () => {
        const res = await admin.get('/api/matches');
        if (!res.ok()) return 0;
        const all = ((await res.json()) as { matches?: ListedMatch[] }).matches ?? [];
        live = all.filter((m) => m.round === 1 && m.team1 && m.team2 && m.status === 'live');
        return live.length;
      },
      { message: 'the first round should go live', timeout: 30_000 }
    )
    .toBe(count);
  return live;
}

test.describe.serial('Disputes, from the team page to the admin queue', () => {
  test.setTimeout(240_000);

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
    'a captain disputes a reported result and an admin settles it from the Disputes page',
    { tag: ['@ui', '@manual-report'] },
    async ({ page, request, browser }) => {
      // Four teams, so the tournament is still running once this match is
      // settled. A finished tournament refuses a reopen and would change what
      // the page offers.
      const teams = await createTeams(request, 'mrd', 4);
      const created = await request.post(`${MR}/tournament`, {
        data: {
          name: 'Argued on the team page',
          type: 'single_elimination',
          format: 'bo1',
          game: 'rocket-league',
          teamIds: teams.map((team) => team.id),
          settings: { manualReport: { confirmation: 'opponent', confirmTimeoutMin: 60 } },
        },
      });
      expect(created.status(), `creating: ${await created.text()}`).toBe(200);

      // One custom field, per player, so the report form has something beyond
      // the score to render — and filing it needs a uid the captain's own
      // request has to have been given.
      const fields = await request.put(`${API}/tournaments/1/fields`, {
        data: {
          fields: [
            { key: 'goals', label: 'Goals', valueType: 'integer', scope: 'player', required: false },
          ],
        },
      });
      expect(fields.status(), `setting fields: ${await fields.text()}`).toBe(200);

      const started = await request.post('/api/tournament/start', { data: {} });
      expect(started.ok(), `starting: ${await started.text()}`).toBe(true);

      const [match] = await waitForLiveMatch(request, 2);
      const one = teams.find((team) => team.id === match.team1!.id)!;
      const two = teams.find((team) => team.id === match.team2!.id)!;
      const oneUid = await makeCaptain(request, one.id, one.captainSteamId);
      await makeCaptain(request, two.id, two.captainSteamId);

      const reporterContext = await browser.newContext();
      const opponentContext = await browser.newContext();

      try {
        // --- team 1's captain reports a score and a stat ---------------------
        const reporter: Page = await reporterContext.newPage();
        expect(await signInAsPlayer(reporter, one.captainSteamId)).toBe(true);
        await reporter.goto(`/team/${one.id}`);

        const reporterState = reporter.getByTestId('manual-report-state');
        await expect(reporter.getByTestId('manual-report-panel')).toBeVisible();
        await expect(reporterState).toHaveAttribute('data-state', 'nothing');

        await reporter.getByTestId('manual-report-open-form').click();
        await reporter.getByTestId('manual-report-game-1-team1').fill('3');
        await reporter.getByTestId('manual-report-game-1-team2').fill('1');
        // The field the tournament asks for, against a real membership.
        await expect(reporter.getByTestId('manual-report-stats')).toBeVisible();
        await reporter.getByTestId(`manual-report-stat-goals-${oneUid}`).fill('2');
        await reporter.getByTestId('manual-report-submit').click();

        await expect(reporterState).toHaveAttribute('data-state', 'waitingOpponent');
        await expect(reporter.getByTestId('manual-report-score')).toContainText('3 – 1');

        // --- team 2's captain reads it, including the stat, and disputes -----
        const opponent: Page = await opponentContext.newPage();
        expect(await signInAsPlayer(opponent, two.captainSteamId)).toBe(true);
        await opponent.goto(`/team/${two.id}`);

        const opponentState = opponent.getByTestId('manual-report-state');
        await expect(opponentState).toHaveAttribute('data-state', 'needsAnswer');
        // The numbers filed with the score are on screen before the buttons
        // that agree or disagree with them.
        await expect(
          opponent.getByTestId(`manual-report-recorded-stats-goals-${oneUid}`)
        ).toContainText('2');

        await opponent.getByTestId('manual-report-dispute').click();
        await opponent.getByTestId('manual-report-dispute-reason').fill('We scored the last one');
        await opponent.getByTestId('manual-report-dispute-submit').click();
        await expect(opponentState).toHaveAttribute('data-state', 'disputed');

        // --- the admin picks it up from the Disputes page --------------------
        await ensureSignedIn(page);
        await page.goto('/');
        // It is a sibling of the admin home, and linked from it.
        const link = page.getByTestId('admin-home-site-link-disputes');
        await expect(link).toBeVisible({ timeout: 20_000 });
        await link.click();

        await expect(page.getByTestId('disputes-page')).toBeVisible();
        const row = page.getByTestId(`dispute-row-${match.slug}`);
        await expect(row).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId(`dispute-reason-${match.slug}`)).toHaveAttribute(
          'data-reason',
          'disputed'
        );
        // Both teams, the score that is being argued about, and the reason.
        await expect(row).toContainText('We scored the last one');

        await page.getByTestId(`dispute-review-${match.slug}`).click();
        const detail = page.getByTestId('dispute-detail');
        await expect(detail).toBeVisible();
        // What each side reported: revision 1, the disputed one.
        await expect(page.getByTestId('dispute-report-1')).toHaveAttribute(
          'data-status',
          'disputed'
        );
        await expect(page.getByTestId(`dispute-recorded-stats-goals-${oneUid}`)).toContainText('2');

        // The admin rules the other way, with a result of their own.
        await page.getByTestId('dispute-resolve-own').click();
        await page.getByTestId('dispute-game-1-team1').fill('1');
        await page.getByTestId('dispute-game-1-team2').fill('3');
        await page.getByTestId('dispute-note').fill('Watched the recording');
        await page.getByTestId('dispute-resolve-submit').click();

        // The queue empties: there is nothing left waiting for an admin.
        await expect(page.getByTestId('disputes-empty')).toBeVisible({ timeout: 20_000 });

        // --- and both captains find out, without reloading -------------------
        await expect(opponentState).toHaveAttribute('data-state', 'confirmed', { timeout: 20_000 });
        await expect(reporterState).toHaveAttribute('data-state', 'confirmed', { timeout: 20_000 });

        // The result really was applied, with the admin's winner.
        const settled = await request.get(`${API}/matches/${match.slug}`);
        expect(settled.ok(), `reading ${match.slug}: ${await settled.text()}`).toBe(true);
        const body = (await settled.json()) as {
          match: { status: string; winnerId: string | null };
          reports: Array<{ revision: number; status: string; source: string }>;
        };
        expect(body.match.status).toBe('completed');
        expect(body.match.winnerId, "the admin's winner, not the reporter's").toBe(two.id);
        // The argument and the ruling are both on the record.
        expect(body.reports.find((r) => r.revision === 1)?.status).toBe('superseded');
        expect(body.reports.find((r) => r.revision === 2)).toMatchObject({
          status: 'confirmed',
          source: 'admin',
        });
      } finally {
        await reporterContext.close();
        await opponentContext.close();
      }
    }
  );

  test(
    'the Disputes page says so when there is nothing waiting',
    { tag: ['@ui', '@manual-report'] },
    async ({ page, request }) => {
      const teams = await createTeams(request, 'mrd-empty', 2);
      const created = await request.post(`${MR}/tournament`, {
        data: {
          name: 'Nothing to settle',
          type: 'single_elimination',
          format: 'bo1',
          game: 'rocket-league',
          teamIds: teams.map((team) => team.id),
        },
      });
      expect(created.status(), `creating: ${await created.text()}`).toBe(200);

      await ensureSignedIn(page);
      await page.goto('/disputes');
      await expect(page.getByTestId('disputes-page')).toBeVisible();
      await expect(page.getByTestId('disputes-empty')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('disputes-list')).toHaveCount(0);
    }
  );
});
