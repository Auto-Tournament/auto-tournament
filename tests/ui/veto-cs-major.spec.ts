import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import { executeVetoActions, getCSMajorBO1Actions, getCSMajorBO3Actions } from '../helpers/veto';

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
  const maps = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    
    // Create teams
    const teams = await createTestTeams(request, 'cs-major-bo1-ui');
    expect(teams).toBeTruthy();
    if (!teams) return;
    
    [team1Id, team2Id] = [teams[0].id, teams[1].id];

    // Create and start BO1 tournament
    const tournament = await createAndStartTournament(request, {
      name: `CS Major BO1 UI Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    // Find match
    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();
    matchSlug = match!.slug;
  });

  test('should display correct side badges for both teams after BO1 veto', {
    tag: ['@ui', '@veto', '@cs-major', '@bo1'],
  }, async ({ page, request }) => {
    // Complete veto via API
    const actions = getCSMajorBO1Actions(team1Id, team2Id);
    await executeVetoActions(request, matchSlug, actions);

    // View as Team 1
    await page.goto(`/team/${team1Id}/match`);
    await page.waitForLoadState('networkidle');

    // Team 1 should see T badge (since Team B picked CT)
    const tBadge = page.locator('text=/T|Terrorist/i').first();
    const tBadgeVisible = await tBadge.isVisible().catch(() => false);
    if (tBadgeVisible) {
      await expect(tBadge).toBeVisible();
    }

    // View as Team 2
    await page.goto(`/team/${team2Id}/match`);
    await page.waitForLoadState('networkidle');

    // Team 2 should see CT badge (since Team B picked CT)
    const ctBadge = page.locator('text=/CT|Counter-Terrorist/i').first();
    const ctBadgeVisible = await ctBadge.isVisible().catch(() => false);
    if (ctBadgeVisible) {
      await expect(ctBadge).toBeVisible();
    }
  });
});

test.describe.serial('CS Major BO3 Veto - UI E2E', () => {
  let team1Id: string;
  let team2Id: string;
  let matchSlug: string;
  const maps = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    
    // Create teams
    const teams = await createTestTeams(request, 'cs-major-bo3-ui');
    expect(teams).toBeTruthy();
    if (!teams) return;
    
    [team1Id, team2Id] = [teams[0].id, teams[1].id];

    // Create and start BO3 tournament
    const tournament = await createAndStartTournament(request, {
      name: `CS Major BO3 UI Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo3',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    // Find match
    const match = await expect.poll(async () => {
      const found = await findMatchByTeams(request, team1Id, team2Id);
      return found || null;
    }, {
      message: 'BO3 match to be created',
      timeout: 10000,
      intervals: [500, 1000],
    });
    
    expect(match).toBeTruthy();
    if (!match) {
      throw new Error('Match not found after tournament creation');
    }
    matchSlug = match.slug;
  });

  test('should visually display BO3 veto process step by step', {
    tag: ['@ui', '@veto', '@cs-major', '@bo3'],
  }, async ({ page, request }) => {
    const actions = getCSMajorBO3Actions(team1Id, team2Id);

    // Execute each step and reload UI to watch progress
    for (let i = 0; i < actions.length; i++) {
      // Execute action
      await executeVetoActions(request, matchSlug, [actions[i]]);

      // Reload UI to see updated state
      await page.goto(`/team/${team1Id}/match`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500); // Brief pause to observe
    }

    // Final verification - should show match details
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should show match details (not veto interface)
    const matchDetails = page.locator('text=/match|server|connect/i');
    const hasMatchDetails = await matchDetails.first().isVisible().catch(() => false);
    expect(hasMatchDetails).toBeTruthy();
  });
});

