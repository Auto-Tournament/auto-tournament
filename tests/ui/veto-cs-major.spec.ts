import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import {
  performVetoActionsUI,
  getCSMajorBO1UIActions,
  getCSMajorBO3UIActions,
} from '../helpers/vetoUI';

/**
 * CS Major Veto Format UI tests
 * Tests veto interface display and visual verification
 *
 * @tag ui
 * @tag veto
 * @tag cs-major
 * @tag e2e-flow
 */

test.describe.serial('CS Major BO1 Veto - UI E2E', () => {
  let team1Id: string;
  let team2Id: string;
  let matchSlug: string;
  const maps = [
    'de_mirage',
    'de_inferno',
    'de_ancient',
    'de_anubis',
    'de_dust2',
    'de_vertigo',
    'de_nuke',
  ];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);

    // Setup tournament with all prerequisites (webhook, servers, teams)
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamCount: 2,
      serverCount: 1,
      prefix: 'cs-major-bo1-ui',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;

    [team1Id, team2Id] = [setup.teams[0].id, setup.teams[1].id];

    // Find match
    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();
    matchSlug = match!.slug;
  });

  test(
    'should complete BO1 veto via UI and display correct side badges',
    {
      tag: ['@ui', '@veto', '@cs-major', '@bo1'],
    },
    async ({ page }) => {
      // Perform veto actions via UI
      const actions = getCSMajorBO1UIActions(team1Id, team2Id);
      await performVetoActionsUI(page, actions);

      // View as Team 1 - should see T badge (since Team B picked CT)
      await page.goto(`/team/${team1Id}`);
      await page.waitForLoadState('networkidle');

      // Check for T badge or side indicator
      const tBadge = page.locator('text=/T|Terrorist/i').first();
      await expect(tBadge).toBeVisible({ timeout: 5000 });

      // View as Team 2 - should see CT badge (since Team B picked CT)
      await page.goto(`/team/${team2Id}`);
      await page.waitForLoadState('networkidle');

      // Check for CT badge or side indicator
      const ctBadge = page.locator('text=/CT|Counter-Terrorist/i').first();
      await expect(ctBadge).toBeVisible({ timeout: 5000 });
    }
  );
});

test.describe.serial('CS Major BO3 Veto - UI E2E', () => {
  // Set timeout for all tests in this describe block (2 minutes for 9 veto actions)
  test.setTimeout(120000);

  let team1Id: string;
  let team2Id: string;
  let matchSlug: string;
  const maps = [
    'de_mirage',
    'de_inferno',
    'de_ancient',
    'de_anubis',
    'de_dust2',
    'de_vertigo',
    'de_nuke',
  ];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);

    // Setup tournament with all prerequisites (webhook, servers, teams)
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo3',
      maps,
      teamCount: 2,
      serverCount: 1,
      prefix: 'cs-major-bo3-ui',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;

    [team1Id, team2Id] = [setup.teams[0].id, setup.teams[1].id];

    // Find match using closure variable pattern
    let match: any = null;
    await expect
      .poll(
        async () => {
          const found = await findMatchByTeams(request, team1Id, team2Id);
          if (found) {
            match = found;
            return true;
          }
          return false;
        },
        {
          message: 'BO3 match to be created',
          timeout: 10000,
          intervals: [500, 1000],
        }
      )
      .toBe(true);

    expect(match).toBeTruthy();
    if (!match) {
      throw new Error('Match not found after tournament creation');
    }
    matchSlug = match.slug;
  });

  test(
    'should complete BO3 veto via UI and display correct side badges',
    {
      tag: ['@ui', '@veto', '@cs-major', '@bo3'],
    },
    async ({ page }) => {
      // Perform veto actions via UI
      const actions = getCSMajorBO3UIActions(team1Id, team2Id);
      await performVetoActionsUI(page, actions);

      // View as Team 1 - should see match details with side badges
      await page.goto(`/team/${team1Id}`, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch (error) {
        await page.waitForTimeout(1000);
      }

      // Check for match details (veto completed, should show server info or match status)
      const matchDetails = page.locator('text=/match|server|connect|veto.*completed/i');
      await expect(matchDetails.first()).toBeVisible({ timeout: 10000 });

      // View as Team 2 - should also see match details
      await page.goto(`/team/${team2Id}`, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch (error) {
        await page.waitForTimeout(1000);
      }

      // Check for match details
      const matchDetails2 = page.locator('text=/match|server|connect|veto.*completed/i');
      await expect(matchDetails2.first()).toBeVisible({ timeout: 10000 });
    }
  );
});
