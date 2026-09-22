import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ensureSignedIn, signInAsPlayer, signInViaRequest } from '../helpers/auth';

/**
 * Reporting a result from the team page (3.0 phase D, PR D7).
 *
 * The whole flow, through the UI, with a real signed-in captain on each side:
 * an admin appoints team 1's captain with the control on the team page, that
 * captain reports a score, team 2's captain — who cannot even see the panel
 * until they are a captain too — confirms it, and both pages end up on the
 * confirmed result.
 *
 * Two things this pins that an API test cannot:
 *
 * - **The panel is the API's answer, rendered.** A player who captains neither
 *   team gets a 403 from `GET /api/game/manual/matches/:slug`, and the panel is
 *   absent rather than broken. That is the same check that decides whether a
 *   button is offered at all.
 * - **Both captains see the change without reloading.** The reporter's page is
 *   never reloaded after their own report; it arrives at the confirmed state on
 *   the module's `match:report` emit alone.
 *
 * It also covers the reason the captain control exists: D1's backfill created
 * no captains, so on an upgraded instance nobody can report until an admin
 * appoints one. Team 1's is appointed by clicking the control; team 2's goes
 * through the route behind it, so both doors are exercised.
 *
 * @tag ui
 * @tag manual-report
 */

const MR = '/api/test/integration/manual-report';

type ListedMatch = {
  slug: string;
  round: number;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

type Member = { accountUid: string; role: string; playerId: string | null };

/** Two teams of two, with the Steam id of the player we will make captain. */
async function createTeams(admin: APIRequestContext, prefix: string) {
  const stamp = `${Date.now()}`.slice(-7);
  const teams: Array<{ id: string; captainSteamId: string }> = [];
  for (let index = 0; index < 2; index++) {
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

/**
 * The `players.uid` behind a Steam id on a team.
 *
 * `team_members` is keyed on the account uid and nothing else in the app
 * exposes one — which is exactly why the admin control reads this route rather
 * than asking whoever is at the keyboard for a uid.
 */
async function captainUid(
  admin: APIRequestContext,
  teamId: string,
  steamId: string
): Promise<string> {
  let members: Member[] = [];
  await expect
    .poll(
      async () => {
        const res = await admin.get(`/api/game/manual/teams/${teamId}/members`);
        if (!res.ok()) return 0;
        members = ((await res.json()) as { members?: Member[] }).members ?? [];
        return members.length;
      },
      { message: `${teamId} should have memberships`, timeout: 20_000 }
    )
    .toBeGreaterThan(0);

  const member = members.find((row) => row.playerId === steamId);
  expect(member, `${steamId} should be a member of ${teamId}`).toBeTruthy();
  return member!.accountUid;
}

async function waitForLiveMatch(admin: APIRequestContext): Promise<ListedMatch> {
  let live: ListedMatch[] = [];
  await expect
    .poll(
      async () => {
        const res = await admin.get('/api/matches');
        if (!res.ok()) return 0;
        const all = ((await res.json()) as { matches?: ListedMatch[] }).matches ?? [];
        live = all.filter((m) => m.round >= 1 && m.team1 && m.team2 && m.status === 'live');
        return live.length;
      },
      { message: 'the first round should go live', timeout: 30_000 }
    )
    .toBe(1);
  return live[0];
}

test.describe.serial('Manual reporting on the team page', () => {
  test.setTimeout(180_000);

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
    'a captain reports, the opponent confirms, and the panel ends up confirmed',
    { tag: ['@ui', '@manual-report'] },
    async ({ page, request, browser }) => {
      const teams = await createTeams(request, 'mrui');
      const created = await request.post(`${MR}/tournament`, {
        data: {
          name: 'Reported from the team page',
          type: 'single_elimination',
          format: 'bo1',
          game: 'rocket-league',
          teamIds: teams.map((team) => team.id),
          settings: { manualReport: { confirmation: 'opponent', confirmTimeoutMin: 60 } },
        },
      });
      expect(created.status(), `creating: ${await created.text()}`).toBe(200);

      const started = await request.post('/api/tournament/start', { data: {} });
      expect(started.ok(), `starting: ${await started.text()}`).toBe(true);

      const match = await waitForLiveMatch(request);
      const one = teams.find((team) => team.id === match.team1!.id)!;
      const two = teams.find((team) => team.id === match.team2!.id)!;

      const oneUid = await captainUid(request, one.id, one.captainSteamId);
      const twoUid = await captainUid(request, two.id, two.captainSteamId);

      // --- an admin appoints team 1's captain, with the control on the page --
      await ensureSignedIn(page);
      await page.goto(`/team/${one.id}`);
      const toggle = page.getByTestId(`team-captain-toggle-${oneUid}`);
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.getByTestId(`team-captain-chip-${oneUid}`)).toBeVisible();

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
        await reporter.getByTestId('manual-report-submit').click();

        await expect(reporterState).toHaveAttribute('data-state', 'waitingOpponent');
        // A one-game series reads back the game's own score, not maps won: a
        // captain who typed 3-1 must not be shown "1 - 0".
        await expect(reporter.getByTestId('manual-report-score')).toContainText('3 \u2013 1');

        // --- the opponent is not a captain yet, so there is nothing to answer -
        const opponent: Page = await opponentContext.newPage();
        expect(await signInAsPlayer(opponent, two.captainSteamId)).toBe(true);
        await opponent.goto(`/team/${two.id}`);
        await expect(opponent.getByTestId('manual-report-panel')).toHaveCount(0);

        const promoted = await request.post(`/api/game/manual/teams/${two.id}/captain`, {
          data: { uid: twoUid, role: 'captain' },
        });
        expect(promoted.ok(), `promoting ${twoUid}: ${await promoted.text()}`).toBe(true);

        // --- and now they can confirm -----------------------------------------
        await opponent.reload();
        const opponentState = opponent.getByTestId('manual-report-state');
        await expect(opponentState).toHaveAttribute('data-state', 'needsAnswer');
        await opponent.getByTestId('manual-report-confirm').click();
        await expect(opponentState).toHaveAttribute('data-state', 'confirmed');

        // The reporter's page has not been reloaded since they reported. It
        // arrives at the same place on the module's socket emit alone.
        await expect(reporterState).toHaveAttribute('data-state', 'confirmed', {
          timeout: 20_000,
        });

        // And the result really was applied, not just drawn.
        const detail = await request.get(`/api/game/manual/matches/${match.slug}`);
        expect(detail.ok(), `reading ${match.slug}: ${await detail.text()}`).toBe(true);
        const body = (await detail.json()) as { match: { status: string; winnerId: string | null } };
        expect(body.match.status).toBe('completed');
        expect(body.match.winnerId).toBe(one.id);
      } finally {
        await reporterContext.close();
        await opponentContext.close();
      }
    }
  );
});
