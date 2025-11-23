import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { performVetoActionsUI, getCSMajorBO1UIActions } from '../helpers/vetoUI';

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
    
    // Setup tournament with all prerequisites (webhook, servers, teams)
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamCount: 2,
      serverCount: 1,
      prefix: 'veto-ui',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;
    
    [team1Id, team2Id] = [setup.teams[0].id, setup.teams[1].id];
  });

  test('should display correct side badges for both teams after UI veto', {
    tag: ['@ui', '@veto', '@sides'],
  }, async ({ page, request }) => {
    // Setup tournament
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamCount: 2,
      serverCount: 1,
      prefix: 'veto-ui-sides',
    });
    expect(setup).toBeTruthy();

    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();

    // Perform veto via UI
    const actions = getCSMajorBO1UIActions(team1Id, team2Id);
    await performVetoActionsUI(page, actions);

    // View as Team 1 - should see T badge
    await page.goto(`/team/${team1Id}`);
    await page.waitForLoadState('networkidle');

    const team1Badge = page.locator('text=/T|Terrorist/i').first();
    await expect(team1Badge).toBeVisible({ timeout: 5000 });

    // View as Team 2 - should see CT badge
    await page.goto(`/team/${team2Id}`);
    await page.waitForLoadState('networkidle');

    const team2Badge = page.locator('text=/CT|Counter-Terrorist/i').first();
    await expect(team2Badge).toBeVisible({ timeout: 5000 });
  });

  test('should display veto interface and complete via UI', {
    tag: ['@ui', '@veto'],
  }, async ({ page, request }) => {
    // Setup tournament
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamCount: 2,
      serverCount: 1,
      prefix: 'veto-ui-display',
    });
    expect(setup).toBeTruthy();

    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();

    // Navigate to team match page
    await page.goto(`/team/${team1Id}`);
    await page.waitForLoadState('networkidle');

    // Verify veto interface is visible
    const vetoInterface = page.locator('text=/your turn|pick.*ban|map/i');
    await expect(vetoInterface.first()).toBeVisible({ timeout: 5000 });

    // Complete veto via UI
    const actions = getCSMajorBO1UIActions(team1Id, team2Id);
    await performVetoActionsUI(page, actions);

    // Reload and verify match details or completion message
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should show match details or "Veto Completed" message
    const matchDetails = page.locator('text=/match|server|connect|veto.*completed/i');
    await expect(matchDetails.first()).toBeVisible({ timeout: 5000 });
  });
});

