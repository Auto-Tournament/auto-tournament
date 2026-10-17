import { test, expect, type Page } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Manage › Live matches (`/manage/live`, pages/LiveMatches.tsx): one row per
 * match from the live overview API, the ones needing an admin first with a
 * severity mark, and "No matches running" with none. The API is mocked so the
 * rows' states are exact.
 *
 * @tag ui
 * @tag manage
 */

const team = (name: string, side: 'ct' | 't' | null, connected: boolean[]) => ({
  id: null,
  name,
  side,
  score: side === 'ct' ? 7 : 5,
  seriesScore: 0,
  players: connected.map((c, i) => ({
    steamId: `${name}-${i}`,
    name: `${name} ${i + 1}`,
    connected: c,
    ready: c,
  })),
});

const base = {
  status: 'live',
  source: 'tournament',
  tournament: { id: 1, name: 'Cup' },
  map: { number: 1, name: 'de_mirage' },
  numMaps: 3,
  round: 13,
  ready: null,
  pause: null,
  call: null,
  server: { id: 's1', name: 'Server 1', online: true },
  updatedAt: 1,
};

const all5 = [true, true, true, true, true];

const MATCHES = [
  // Fine: last.
  {
    ...base,
    slug: 'quiet',
    phase: 'live',
    team1: team('Alpha', 'ct', all5),
    team2: team('Bravo', 't', all5),
  },
  // A player missing on a live map.
  {
    ...base,
    slug: 'missing',
    phase: 'live',
    team1: team('Charlie', 'ct', [true, true, true, true, false]),
    team2: team('Delta', 't', all5),
  },
  // Paused.
  {
    ...base,
    slug: 'paused',
    phase: 'paused',
    team1: team('Echo', 'ct', all5),
    team2: team('Foxtrot', 't', all5),
    pause: {
      active: true,
      type: 'technical',
      by: 'Echo 1',
      since: Math.floor(Date.now() / 1000) - 75,
      unpause: { team1: true, team2: false },
    },
  },
  // An open call: first.
  {
    ...base,
    slug: 'called',
    phase: 'warmup',
    round: null,
    team1: team('Golf', null, all5),
    team2: team('Hotel', null, all5),
    call: {
      id: 42,
      playerName: 'Golf 1',
      playerTeam: 'team1',
      message: 'server lag',
      calledAt: new Date().toISOString(),
      claimedBy: null,
      claimedByName: null,
    },
  },
];

async function mockOverview(page: Page, matches: unknown[]) {
  await page.route('**/api/game/cs2/live-overview', (route) =>
    route.fulfill({ json: { success: true, matches } })
  );
}

test.describe('Manage live matches', () => {
  test(
    'rows needing an admin come first, marked',
    { tag: ['@ui', '@manage'] },
    async ({ page }) => {
      await ensureSignedIn(page);
      await mockOverview(page, MATCHES);
      await page.goto('/manage/live');
      await expect(page.getByTestId('live-matches-page')).toBeVisible({ timeout: 15000 });

      const rows = page.locator('[data-testid^="live-row-"]');
      await expect(rows).toHaveCount(4, { timeout: 15000 });
      await expect(rows.nth(0)).toHaveAttribute('data-testid', 'live-row-called');
      await expect(rows.nth(1)).toHaveAttribute('data-testid', 'live-row-paused');
      await expect(rows.nth(2)).toHaveAttribute('data-testid', 'live-row-missing');
      await expect(rows.nth(3)).toHaveAttribute('data-testid', 'live-row-quiet');
      await expect(rows.nth(0)).toHaveAttribute('data-severity', 'call');
      await expect(rows.nth(3)).toHaveAttribute('data-severity', 'none');

      const called = page.getByTestId('live-row-called');
      await expect(called.getByTestId('live-call')).toContainText('server lag');
      await expect(called.getByTestId('live-call-claim')).toBeVisible();
      await expect(called.getByTestId('live-phase')).toHaveAttribute('data-phase', 'warmup');

      const paused = page.getByTestId('live-row-paused');
      await expect(paused.getByTestId('live-pause')).toContainText('Technical');
      await expect(paused.getByTestId('live-pause')).toContainText(/1:\d\d/);
      await expect(paused.getByTestId('live-score')).toHaveText('7–5');

      await expect(page.getByTestId('live-row-missing')).toContainText('4/5 in · 4 ready');
      await expect(
        page.getByTestId('live-row-quiet').getByTestId('live-match-link')
      ).toHaveAttribute('href', '/manage/tournaments/1/matches/quiet');
    }
  );

  test('says so when nothing is running', { tag: ['@ui', '@manage'] }, async ({ page }) => {
    await ensureSignedIn(page);
    await mockOverview(page, []);
    await page.goto('/manage/live');
    await expect(page.getByTestId('live-matches-empty')).toHaveText('No matches running', {
      timeout: 15000,
    });
  });
});
