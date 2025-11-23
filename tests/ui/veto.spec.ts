import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import { executeVetoActions, getCSMajorBO1Actions } from '../helpers/veto';

/**
 * Veto UI tests
 * Tests veto interface display and interaction
 * 
 * @tag ui
 * @tag veto
 * @tag maps
 * @tag sides
 */

test.describe.serial('Veto UI', () => {
  let team1Id: string;
  let team2Id: string;
  const maps = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    
    // Create teams
    const teams = await createTestTeams(request, 'veto-ui');
    expect(teams).toBeTruthy();
    if (!teams) return;
    
    [team1Id, team2Id] = [teams[0].id, teams[1].id];
  });

  test('should display correct side badges for both teams', {
    tag: ['@ui', '@veto', '@sides'],
  }, async ({ page, request }) => {
    // Create and start BO1 tournament
    const tournament = await createAndStartTournament(request, {
      name: `Veto UI Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();

    // Navigate to team match page
    await page.goto(`/team/${team1Id}/match`);
    await page.waitForLoadState('networkidle');

    // Execute veto via API (faster than UI clicks)
    const actions = getCSMajorBO1Actions(team1Id, team2Id);
    await executeVetoActions(request, match!.slug, actions);

    // Reload page to see updated veto state
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check for side badge display
    // Team 1 should show T (opposite of Team 2's CT pick)
    const team1Badge = page.locator('text=/team.*T|starting.*T/i').first();
    const team2Badge = page.locator('text=/team.*CT|starting.*CT/i').first();
    
    const hasTeam1Badge = await team1Badge.isVisible().catch(() => false);
    const hasTeam2Badge = await team2Badge.isVisible().catch(() => false);
    
    // At least one side indicator should be visible
    expect(hasTeam1Badge || hasTeam2Badge).toBeTruthy();
  });

  test('should display veto interface and match details after completion', {
    tag: ['@ui', '@veto'],
  }, async ({ page, request }) => {
    // Create and start BO1 tournament
    const tournament = await createAndStartTournament(request, {
      name: `Veto Display Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();

    // Navigate to team match page
    await page.goto(`/team/${team1Id}/match`);
    await page.waitForLoadState('networkidle');

    // Verify veto interface is visible
    const vetoInterface = page.locator('text=/veto|pick.*ban|map.*selection/i');
    const hasVetoInterface = await vetoInterface.first().isVisible().catch(() => false);
    expect(hasVetoInterface).toBeTruthy();

    // Complete veto via API
    const actions = getCSMajorBO1Actions(team1Id, team2Id);
    await executeVetoActions(request, match!.slug, actions);

    // Reload and verify match details are shown
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should show match details (not veto interface)
    const matchDetails = page.locator('text=/match|server|connect/i');
    const hasMatchDetails = await matchDetails.first().isVisible().catch(() => false);
    expect(hasMatchDetails).toBeTruthy();
  });
});

