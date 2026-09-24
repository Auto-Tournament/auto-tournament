import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader } from '../helpers/auth';
import type { Team } from '../helpers/teams';

/**
 * The team page (`/team/:teamId`) follows the team into its next match without
 * a reload (Discord: "pages show stale state until a hard refresh").
 *
 * Two ways it went stale:
 *  - Events naming any match other than the one on screen were dropped, even
 *    after that match had finished. So once a team won, the page sat on the
 *    finished match while its next match was created and readied.
 *  - Nothing was refetched when the socket reconnected, and the server keeps
 *    no backlog, so anything sent while the connection was down was lost.
 *
 * @tag ui
 * @tag teams
 * @tag regression
 */

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
};

type ListedMatch = {
  slug: string;
  round: number;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

async function playBo1(request: APIRequestContext, match: ListedMatch, winner: 'team1' | 'team2') {
  const [t1, t2] = winner === 'team1' ? [13, 4] : [4, 13];
  const side = winner === 'team1' ? '3' : '2';
  const mapRes = await request.post(`/api/events/${match.slug}`, {
    headers: SERVER_HEADERS,
    data: {
      event: 'map_result',
      matchid: match.slug,
      map_number: 0,
      map_name: 'de_mirage',
      team1_score: t1,
      team2_score: t2,
      winner: { side, team: winner },
      team1: { score: t1, series_score: winner === 'team1' ? 1 : 0 },
      team2: { score: t2, series_score: winner === 'team2' ? 1 : 0 },
    },
  });
  expect(mapRes.ok(), `map_result ${match.slug}: ${await mapRes.text()}`).toBe(true);
  const endRes = await request.post(`/api/events/${match.slug}`, {
    headers: SERVER_HEADERS,
    data: {
      event: 'series_end',
      matchid: match.slug,
      team1_series_score: winner === 'team1' ? 1 : 0,
      team2_series_score: winner === 'team2' ? 1 : 0,
      winner: { side, team: winner },
      time_until_restore: 0,
    },
  });
  expect(endRes.status(), `series_end ${match.slug}: ${await endRes.text()}`).toBe(200);
}

/**
 * A 4-team bracket, and the two semifinals from team A's point of view.
 * Team A wins its semi; the other semi's winner is A's final opponent.
 */
async function setupSemis(request: APIRequestContext, prefix: string) {
  await request.put('/api/settings', { data: { simulateMatches: false } });
  const setup = await setupTournament(request, {
    type: 'single_elimination',
    format: 'bo1',
    teamCount: 4,
    serverCount: 1,
    prefix,
  });
  expect(setup, 'tournament setup failed').toBeTruthy();

  const res = await request.get('/api/matches', { headers: getAuthHeader() });
  const semis = ((await res.json()) as { matches: ListedMatch[] }).matches.filter(
    (m) => m.round === 1 && m.team1 && m.team2
  );
  expect(semis).toHaveLength(2);
  const [ours, theirs] = semis;
  const teamA = setup!.teams.find((t) => t.id === ours.team1!.id) as Team;
  const finalOpponent = setup!.teams.find((t) => t.id === theirs.team1!.id) as Team;
  return { ours, theirs, teamA, finalOpponent };
}

async function openTeamPage(page: Page, team: Team, opponentOfSemi: string) {
  await page.goto(`/team/${team.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(team.name).first()).toBeVisible({ timeout: 15000 });
  // The semi is on screen: the current opponent is shown, the final's is not.
  await expect(page.getByText(opponentOfSemi).first()).toBeVisible({ timeout: 15000 });
}

test.describe.serial('Team page live updates', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test.afterEach(async ({ request }) => {
    await request.delete('/api/tournament', { headers: getAuthHeader() }).catch(() => undefined);
  });

  test(
    'moves on to the next match once the current one finishes',
    { tag: ['@ui', '@teams', '@regression'] },
    async ({ page, request }) => {
      const { ours, theirs, teamA, finalOpponent } = await setupSemis(request, `live-next-${Date.now()}`);
      const semiOpponent = await teamName(request, ours.team2!.id);
      await openTeamPage(page, teamA, semiOpponent);
      await expect(page.getByText(finalOpponent.name)).toHaveCount(0);

      await playBo1(request, ours, 'team1');
      await playBo1(request, theirs, 'team1');

      await expect(page.getByText(finalOpponent.name).first()).toBeVisible({ timeout: 15000 });
    }
  );

  test(
    'catches up on what it missed while the socket was disconnected',
    { tag: ['@ui', '@teams', '@regression'] },
    async ({ page, request }) => {
      const { ours, theirs, teamA, finalOpponent } = await setupSemis(request, `live-reconnect-${Date.now()}`);
      const semiOpponent = await teamName(request, ours.team2!.id);

      // Cut the connection the way a network drop does: the page's socket.io
      // WebSockets are closed under it, and new connections - WebSocket or
      // long-polling - are refused until the "network" is back.
      await page.addInitScript(() => {
        const NativeWebSocket = window.WebSocket;
        const open: InstanceType<typeof NativeWebSocket>[] = [];
        const w = window as unknown as {
          __cutSockets: () => void;
          __openSockets: () => number;
          __socketsDown: boolean;
        };
        w.__socketsDown = false;
        w.__openSockets = () => open.filter((ws) => ws.readyState === NativeWebSocket.OPEN).length;
        w.__cutSockets = () => {
          w.__socketsDown = true;
          open.splice(0).forEach((ws) => ws.close());
        };
        class TrackedWebSocket extends NativeWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            if (!String(url).includes('/socket.io/')) return;
            if (w.__socketsDown) this.close();
            else open.push(this);
          }
        }
        window.WebSocket = TrackedWebSocket;
      });
      let socketsDown = false;
      await page.route(/\/socket\.io\//, (route) => (socketsDown ? route.abort() : route.continue()));

      await openTeamPage(page, teamA, semiOpponent);
      // Let socket.io finish upgrading from long-polling to WebSocket first:
      // cutting a probe WebSocket mid-upgrade only makes it stay on polling.
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __openSockets: () => number }).__openSockets()))
        .toBeGreaterThan(0);
      await page.waitForTimeout(1500);
      socketsDown = true;
      await page.evaluate(() => (window as unknown as { __cutSockets: () => void }).__cutSockets());

      // Both semis finish while the page cannot hear about it.
      await playBo1(request, ours, 'team1');
      await playBo1(request, theirs, 'team1');
      await page.waitForTimeout(1000);
      await expect(page.getByText(finalOpponent.name)).toHaveCount(0);

      // Back online: the socket reconnects, but the events are gone. Only a
      // refetch on reconnect brings the page up to date.
      socketsDown = false;
      await page.evaluate(() => {
        (window as unknown as { __socketsDown: boolean }).__socketsDown = false;
      });
      await expect(page.getByText(finalOpponent.name).first()).toBeVisible({ timeout: 20000 });
    }
  );
});

async function teamName(request: APIRequestContext, teamId: string): Promise<string> {
  const res = await request.get(`/api/teams/${teamId}`, { headers: getAuthHeader() });
  const body = (await res.json()) as { team?: { name?: string } };
  return body.team?.name ?? '';
}
