import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * The Manage page's server tiles say why a busy Ready Up server takes no
 * match (fleet/busyReason.ts), and show the failover spare as one. A reason
 * the page does not know, or none, keeps the old line.
 *
 * @tag ui
 * @tag fleet
 */

const entry = (id: string, busyReason: string | null, busyDetail: string | null = null) => ({
  id,
  name: `srv-${id}`,
  online: true,
  status: null,
  matchSlug: null,
  matchNumber: null,
  matchRound: null,
  updatedAt: Math.floor(Date.now() / 1000),
  inGraceWindow: false,
  secondsUntilReady: null,
  allocatable: false,
  notAllocatableReason: busyReason === 'reserved' ? 'reserved' : 'busy',
  busyReason,
  busyDetail,
});

test('a busy server tile says why it takes no match', async ({ page }) => {
  await ensureSignedIn(page);
  await page.route('**/api/tournament/server-availability', (route) =>
    route.fulfill({
      json: {
        success: true,
        availableServerCount: 0,
        gracePeriodSeconds: 0,
        nextAllocationInSeconds: null,
        requiredServerCount: 0,
        simulationEnabled: false,
        servers: [
          entry('a', 'local_match', 'cup-final'),
          entry('b', 'awaiting_reset', 'm1'),
          entry('c', 'match_disabled'),
          entry('d', 'draining', 'cs2 update'),
          entry('e', 'reserved'),
          entry('f', null),
          entry('g', 'coffee'),
        ],
      },
    })
  );
  await page.goto('/manage');
  const grid = page.getByTestId('manage-servers');
  await expect(grid).toBeVisible({ timeout: 15000 });
  await expect(grid.getByText('Local match cup-final still loaded')).toBeVisible();
  await expect(grid.getByText('Waiting for reset after the series')).toBeVisible();
  await expect(grid.getByText('Match plugin off')).toBeVisible();
  await expect(grid.getByText('Draining', { exact: true })).toBeVisible();
  await expect(grid.getByText('Spare', { exact: true })).toBeVisible();
  await expect(grid.getByText('Spare for failover')).toBeVisible();
  // No reason, or one this page does not know: the old line, never a raw key.
  await expect(grid.getByText('Not taking matches right now')).toHaveCount(2);
  await expect(grid.getByText(/managePage\./)).toHaveCount(0);
});
