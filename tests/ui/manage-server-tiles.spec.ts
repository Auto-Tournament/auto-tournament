import { test, expect, type Page } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * The Manage page's server tiles: a server in a match says its phase, map and
 * score and opens the match; the tiles sort by status with matches first.
 *
 * @tag ui
 * @tag fleet
 */

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  online: true,
  status: null,
  matchSlug: null,
  matchNumber: null,
  matchRound: null,
  updatedAt: Math.floor(Date.now() / 1000),
  inGraceWindow: false,
  secondsUntilReady: null,
  allocatable: false,
  notAllocatableReason: 'busy',
  ...over,
});

const match = (slug: string, over: Record<string, unknown> = {}) => ({
  id: 1,
  slug,
  status: 'live',
  round: 1,
  matchNumber: 1,
  team1: { id: 't1', name: 'Alpha' },
  team2: { id: 't2', name: 'Bravo' },
  maps: ['de_inferno'],
  mapNumber: 0,
  currentMap: 'de_inferno',
  liveStatus: 'live',
  vetoCompleted: true,
  team1MapScore: 7,
  team2MapScore: 5,
  ...over,
});

async function mockFleet(page: Page, servers: unknown[], matches: Record<string, unknown>) {
  await page.route('**/api/tournament/server-availability', (route) =>
    route.fulfill({
      json: {
        success: true,
        availableServerCount: 0,
        gracePeriodSeconds: 0,
        nextAllocationInSeconds: null,
        requiredServerCount: 0,
        simulationEnabled: false,
        servers,
      },
    })
  );
  await page.route('**/api/matches/*', (route) => {
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
    const found = matches[slug];
    return found ? route.fulfill({ json: { success: true, match: found } }) : route.continue();
  });
}

test('a server in a match shows its phase, map and score and opens the match', async ({ page }) => {
  await ensureSignedIn(page);
  await mockFleet(
    page,
    [
      entry('s-live', {
        matchSlug: 'ub-r1-m1',
        matchRound: 1,
        matchNumber: 1,
        matchBracket: 'WB',
        notAllocatableReason: null,
      }),
      entry('s-warm', { matchSlug: 'friendly', notAllocatableReason: null }),
      entry('s-free', { allocatable: true, notAllocatableReason: null }),
    ],
    {
      'ub-r1-m1': match('ub-r1-m1'),
      friendly: match('friendly', {
        liveStatus: 'warmup',
        team1MapScore: 0,
        team2MapScore: 0,
      }),
    }
  );
  await page.goto('/manage');
  const grid = page.getByTestId('manage-servers');
  const live = grid.getByRole('button', { name: /s-live/ });
  await expect(live).toBeVisible({ timeout: 15000 });
  await expect(live).toContainText('Live');
  await expect(live).toContainText('UB R1 M1 · de_inferno 7 – 5');
  const warm = grid.getByRole('button', { name: /s-warm/ });
  await expect(warm).toContainText('Warmup');
  await expect(warm).toContainText('Alpha vs Bravo · de_inferno');
  await expect(warm).not.toContainText('0 – 0');
  await expect(grid.getByRole('button', { name: /s-free/ })).toHaveCount(0);
  await expect(grid.getByText('Free', { exact: true })).toBeVisible();

  await live.click();
  await expect(page).toHaveURL(/\/match\/ub-r1-m1$/);
});

test('server tiles sort by status, matches first', async ({ page }) => {
  await ensureSignedIn(page);
  await mockFleet(
    page,
    [
      entry('a-offline', { online: false, updatedAt: 1 }),
      entry('b-free', { allocatable: true, notAllocatableReason: null }),
      entry('d-warm', { matchSlug: 'm-warm', notAllocatableReason: null }),
      entry('e-live', { matchSlug: 'm-live', notAllocatableReason: null }),
      entry('f-busy'),
    ],
    {
      'm-warm': match('m-warm', { liveStatus: 'warmup' }),
      'm-live': match('m-live'),
    }
  );
  await page.goto('/manage');
  const grid = page.getByTestId('manage-servers');
  await expect(grid.getByText('e-live')).toBeVisible({ timeout: 15000 });
  await expect(grid.locator('b')).toHaveText(['e-live', 'd-warm', 'b-free', 'f-busy', 'a-offline']);
});

test('a stale slug on an allocatable server reads Free and sorts with the free ones', async ({
  page,
}) => {
  await ensureSignedIn(page);
  await mockFleet(
    page,
    [
      entry('a-stale', { matchSlug: 'gone', allocatable: true, notAllocatableReason: null }),
      entry('b-live', { matchSlug: 'm-live', notAllocatableReason: null }),
      entry('c-free', { allocatable: true, notAllocatableReason: null }),
    ],
    { 'm-live': match('m-live') }
  );
  await page.goto('/manage');
  const grid = page.getByTestId('manage-servers');
  await expect(grid.getByText('b-live')).toBeVisible({ timeout: 15000 });
  await expect(grid.locator('b')).toHaveText(['b-live', 'a-stale', 'c-free']);
  await expect(grid.getByRole('button', { name: /a-stale/ })).toHaveCount(0);
  await expect(grid.getByText('Free', { exact: true })).toHaveCount(2);
});

test('a finished match leaves the tile on its availability state, not a button', async ({
  page,
}) => {
  await ensureSignedIn(page);
  await mockFleet(page, [entry('s-done', { matchSlug: 'm-done' })], {
    'm-done': match('m-done', { status: 'completed' }),
  });
  await page.goto('/manage');
  const grid = page.getByTestId('manage-servers');
  await expect(grid.getByText('s-done')).toBeVisible({ timeout: 15000 });
  await expect(grid.getByText('Busy', { exact: true })).toBeVisible();
  await expect(grid.getByRole('button', { name: /s-done/ })).toHaveCount(0);
});
