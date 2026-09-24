import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import { ensureSignedIn, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * The leaderboard and the player profile show what the tournament's game
 * measured, and nothing it did not (3.0, after phases C/D/E).
 *
 * Kills, deaths, ADR, headshots and demo links are things Counter-Strike 2
 * measures and records. Rocket League reported by its captains does neither,
 * so those pages leave the columns out instead of filling them with zeroes or
 * "N/A" — which would say the data went missing when it was never going to
 * exist. What they show instead is the module's own statistics: the custom
 * fields the tournament asked reporters for.
 *
 * Every negative here sits next to a positive, so an empty page cannot pass.
 * The CS2 side — the same pages *with* every column — is pinned by
 * player-profile-redesign.spec.ts.
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

type Member = { accountUid: string; role: string; playerId: string | null; name: string | null };

/** `teams.id` -> that team's captain: Steam id, `players.uid` and name. */
const captains = new Map<string, { steamId: string; uid: string; name: string }>();
/** Steam id -> the name the roster gave that player. */
const rosterNames = new Map<string, string>();

async function createTeams(admin: APIRequestContext, count: number): Promise<string[]> {
  const stamp = `${Date.now()}`.slice(-7);
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = `mrstats-${stamp}-${index}`;
    const players = [
      { steamId: `76561199${stamp}${index}0`, name: `Stats ${stamp} ${index} captain` },
      { steamId: `76561199${stamp}${index}1`, name: `Stats ${stamp} ${index} second` },
    ];
    for (const player of players) rosterNames.set(player.steamId, player.name);
    const res = await admin.post('/api/teams', {
      data: { id, name: `Stats ${stamp} ${index}`, players },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    ids.push(id);
  }
  return ids;
}

/** Appoint each team's first player captain, through the real admin routes. */
async function promoteCaptains(admin: APIRequestContext, teamIds: string[]) {
  for (const teamId of teamIds) {
    const listed = await admin.get(`${API}/teams/${teamId}/members`);
    expect(listed.status(), `listing ${teamId}: ${await listed.text()}`).toBe(200);
    const members = ((await listed.json()) as { members: Member[] }).members;
    // The first roster entry, whose Steam id ends in 0.
    const captain = members.find((m) => m.playerId?.endsWith('0'));
    expect(captain, `${teamId} should mirror its roster`).toBeTruthy();
    const promoted = await admin.post(`${API}/teams/${teamId}/captain`, {
      data: { uid: captain!.accountUid },
    });
    expect(promoted.status(), `promoting in ${teamId}: ${await promoted.text()}`).toBe(200);
    captains.set(teamId, {
      steamId: captain!.playerId!,
      uid: captain!.accountUid,
      name: rosterNames.get(captain!.playerId!) ?? '',
    });
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

test.describe.serial('Stats pages follow the tournament game', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page, request, baseURL }) => {
    await ensureSignedIn(page);
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
    'a Rocket League tournament shows no kills, deaths, ADR or demo link — and its own stats',
    { tag: ['@ui', '@manual-report'] },
    async ({ page, request, playwright, baseURL }) => {
      const teamIds = await createTeams(request, 2);
      const created = await request.post(`${MR}/tournament`, {
        data: {
          name: 'Rocket League stats night',
          type: 'single_elimination',
          format: 'bo1',
          game: 'rocket-league',
          teamIds,
          settings: { manualReport: { confirmation: 'opponent', confirmTimeoutMin: 60 } },
        },
      });
      expect(created.status(), `creating: ${await created.text()}`).toBe(200);
      await promoteCaptains(request, teamIds);
      const started = await request.post('/api/tournament/start', { data: {} });
      expect(started.ok(), `starting: ${await started.text()}`).toBe(true);

      let match: ListedMatch | undefined;
      await expect
        .poll(
          async () => {
            const res = await request.get('/api/matches');
            const all = ((await res.json()) as { matches?: ListedMatch[] }).matches ?? [];
            match = all.find((m) => m.round === 1 && m.team1 && m.team2 && m.status === 'live');
            return Boolean(match);
          },
          { message: 'the final should go live', timeout: 20_000 }
        )
        .toBe(true);

      const home = captains.get(match!.team1!.id)!;
      const away = captains.get(match!.team2!.id)!;
      const one = await playerContext(playwright, baseURL, home.steamId);
      const two = await playerContext(playwright, baseURL, away.steamId);

      let tournamentId: number;
      try {
        const viewed = await one.get(`${API}/matches/${match!.slug}`);
        expect(viewed.status(), `reading the match: ${await viewed.text()}`).toBe(200);
        tournamentId = ((await viewed.json()) as { match: { tournamentId: number } }).match
          .tournamentId;

        // The one thing this game does report: a custom field the admin asked for.
        const fields = await request.put(`${API}/tournaments/${tournamentId}/fields`, {
          data: {
            fields: [{ key: 'goals', label: 'Goals', valueType: 'integer', scope: 'player' }],
          },
        });
        expect(fields.status(), `setting fields: ${await fields.text()}`).toBe(200);

        const reported = await one.post(`${API}/matches/${match!.slug}/report`, {
          data: {
            result: { maps: [{ team1Score: 3, team2Score: 1 }] },
            stats: [
              { key: 'goals', playerUid: home.uid, value: 3 },
              { key: 'goals', playerUid: away.uid, value: 1 },
            ],
          },
        });
        expect(reported.status(), `reporting: ${await reported.text()}`).toBe(200);
        const confirmed = await two.post(`${API}/matches/${match!.slug}/confirm`, {
          data: { revision: 1 },
        });
        expect(confirmed.status(), `confirming: ${await confirmed.text()}`).toBe(200);
      } finally {
        await one.dispose();
        await two.dispose();
      }

      // The finished series lands in the captain's match history before the
      // pages are opened, so neither page races the write.
      await expect
        .poll(
          async () => {
            const res = await request.get(`/api/players/${home.steamId}/summary`);
            if (!res.ok()) return false;
            const rows = ((await res.json()) as { matches?: Array<{ slug: string }> }).matches ?? [];
            return rows.some((row) => row.slug === match!.slug);
          },
          { message: 'the match in the player history', timeout: 20_000, intervals: [500, 1000] }
        )
        .toBe(true);

      // --- Leaderboard -----------------------------------------------------
      await page.goto(`/tournament/${tournamentId!}/leaderboard`);
      await expect(page.getByTestId('public-leaderboard-page')).toBeVisible({ timeout: 15000 });
      const board = page.getByTestId('public-leaderboard');
      // Positive: the captain is ranked, and the module's own table is there.
      await expect(board.getByRole('columnheader', { name: 'Win Rate' })).toBeVisible();
      await expect(board.getByText(home.name, { exact: true }).first()).toBeVisible();
      const leaderboardStats = page.getByTestId('manual-report-tournament-stats');
      await expect(leaderboardStats).toBeVisible();
      await expect(leaderboardStats).toContainText('Goals');
      // Negative: nothing the game never measured.
      await expect(board.getByRole('columnheader', { name: 'Avg ADR' })).toHaveCount(0);
      await expect(page.getByText('Top Players by ADR')).toHaveCount(0);
      await expect(page.getByText(/\bN\/A\b/)).toHaveCount(0);

      // --- Player profile --------------------------------------------------
      await page.goto(`/player/${home.steamId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('public-player-page')).toBeVisible({ timeout: 15000 });

      // The way from a player to their tournament. It never appeared: the
      // query aliased `tournament_id as tournamentId` unquoted, Postgres
      // returned `tournamentid`, and the page's `m.tournamentId` was
      // undefined for every match, CS2's included.
      await expect(page.getByTestId('profile-tournament-leaderboard')).toBeVisible();

      // The match list shows the reported match, with no kills/deaths (the
      // game measures none) and no demo to download.
      await expect(page.getByTestId('profile-recent-matches')).toBeVisible();
      await expect(page.getByTestId('profile-recent-matches')).not.toContainText(' / ');
      await expect(page.getByRole('link', { name: 'Download demo' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Download demo' })).toHaveCount(0);

      // Stats grid: the tiles that exist, and not the ones that cannot.
      await expect(page.getByTestId('profile-stat-matches')).toContainText('1');
      await expect(page.getByTestId('profile-stat-win-rate')).toContainText('100%');
      await expect(page.getByTestId('profile-stat-adr')).toHaveCount(0);
      await expect(page.getByTestId('profile-stat-kd')).toHaveCount(0);

      // Recent matches: the match is listed, with no kills / deaths beside it
      // and no footnote explaining a column that is not there.
      const row = page.getByTestId(`profile-recent-match-${match!.slug}`);
      await expect(row).toBeVisible();
      await expect(row).not.toContainText('/');
      await expect(page.getByText('Kills / deaths.', { exact: false })).toHaveCount(0);

      // No ADR highlights beside the recent-form timeline.
      await expect(page.getByText('Recent Form & Highlights')).toBeVisible();
      await expect(page.getByText('Best Match (ADR)')).toHaveCount(0);
      await expect(page.getByText('Toughest Match (ADR)')).toHaveCount(0);

      // What the game did report, from the module that owns it.
      const profileStats = page.getByTestId('manual-report-tournament-stats');
      await expect(profileStats).toBeVisible();
      await expect(profileStats).toContainText('Goals');
    }
  );
});
