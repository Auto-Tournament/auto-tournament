import { Page, expect } from '@playwright/test';

/**
 * UI helper functions for veto interactions
 * Performs veto actions by clicking on UI elements instead of API calls
 */

export interface VetoUIAction {
  action: 'ban' | 'pick' | 'side_pick';
  mapName?: string;
  side?: 'CT' | 'T';
  teamSlug: string;
}

/**
 * Get map display name from map ID
 */
function getMapDisplayName(mapName: string): string {
  const mapNames: Record<string, string> = {
    'de_mirage': 'Mirage',
    'de_inferno': 'Inferno',
    'de_ancient': 'Ancient',
    'de_anubis': 'Anubis',
    'de_dust2': 'Dust II',
    'de_vertigo': 'Vertigo',
    'de_nuke': 'Nuke',
  };
  return mapNames[mapName] || mapName;
}

/**
 * Perform a single veto action via UI
 * @param page Playwright page
 * @param teamSlug Team slug to navigate to their match page
 * @param action Veto action to perform
 */
export async function performVetoActionUI(
  page: Page,
  teamSlug: string,
  action: VetoUIAction
): Promise<boolean> {
  // Navigate to team's match page
  await page.goto(`/team/${teamSlug}`, { waitUntil: 'domcontentloaded' });
  // Use a timeout for networkidle to prevent hanging
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch (error) {
    // If networkidle times out, just wait a bit and continue
    console.warn('Network idle timeout, continuing anyway...');
    // Check if page is still valid before waiting
    if (!page.isClosed()) {
      await page.waitForTimeout(1000);
    }
  }

  // Wait for veto interface to be visible using getByTestId (Playwright standard)
  try {
    const vetoInterface = page.getByTestId('veto-interface');
    await expect(vetoInterface).toBeVisible({ timeout: 10000 });
    
    // Wait a bit more for the interface to fully render (maps, buttons, etc.)
    if (!page.isClosed()) {
      await page.waitForTimeout(500);
    }
  } catch (error) {
    // If veto interface not found, might already be completed
    console.warn('Veto interface not found, might be completed');
    return false;
  }

  if (action.action === 'side_pick') {
    // For side pick, find and click the CT or T button
    const sideTestId = action.side === 'CT' ? 'veto-side-ct-button' : 'veto-side-t-button';
    const sideButton = page.getByTestId(sideTestId);
    
    await expect(sideButton).toBeVisible({ timeout: 10000 });
    await expect(sideButton).toBeEnabled({ timeout: 5000 });
    await sideButton.click();
    
    // Wait for action to complete (veto state should update)
    // Use a shorter, more reliable wait approach
    try {
      // Wait for network request to complete (side pick API call)
      await page.waitForResponse(
        (response) => response.url().includes('/api/veto/') && response.url().includes('/action'),
        { timeout: 5000 }
      ).catch(() => {
        // If no response, just continue after short delay
      });
      // Small delay for state propagation
      if (!page.isClosed()) {
        await page.waitForTimeout(500);
      }
    } catch (error) {
      // If waiting fails, use minimal timeout
      if (!page.isClosed()) {
        await page.waitForTimeout(500);
      }
    }
    return true;
  } else {
    // For ban/pick, find the map card and click it using data-test-id
    if (!action.mapName) {
      console.error('Map name is required for ban/pick action');
      return false;
    }
    
    // Find the map card by data-test-id
    // First wait a bit for maps to render in the veto interface
    if (!page.isClosed()) {
      await page.waitForTimeout(1000);
    }
    
    const mapCard = page.getByTestId(`veto-map-card-${action.mapName}`);
    
    // Wait for map card to be visible with longer timeout
    // Maps might take time to load and render
    await expect(mapCard).toBeVisible({ timeout: 15000 });
    
    // Click the map card
    await mapCard.click();
    
    // Wait for action to complete
    if (!page.isClosed()) {
      await page.waitForTimeout(1500);
    }
    try {
      if (!page.isClosed()) {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      }
    } catch (error) {
      // If networkidle times out, just wait a bit and continue
      if (!page.isClosed()) {
        await page.waitForTimeout(1000);
      }
    }
    return true;
  }
}

/**
 * Perform multiple veto actions via UI
 * @param page Playwright page
 * @param actions Array of veto actions to perform
 */
export async function performVetoActionsUI(
  page: Page,
  actions: VetoUIAction[]
): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    console.log(`[Veto UI] Action ${i + 1}/${actions.length}: ${action.action} ${action.mapName || action.side} for team ${action.teamSlug}`);
    
    try {
      const success = await performVetoActionUI(page, action.teamSlug, action);
      if (!success) {
        console.warn(`[Veto UI] Action ${i + 1} returned false, but continuing...`);
      }
    } catch (error) {
      console.error(`[Veto UI] Error on action ${i + 1}:`, error);
      // Check if page was closed (common when navigation happens)
      if (page.isClosed()) {
        console.warn(`[Veto UI] Page was closed during action ${i + 1}, stopping veto actions`);
        return;
      }
      throw error;
    }
    
    // Small delay between actions
    if (!page.isClosed()) {
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Convert CS Major BO1 actions to UI actions
 */
export function getCSMajorBO1UIActions(team1Id: string, team2Id: string): VetoUIAction[] {
  return [
    { action: 'ban', mapName: 'de_inferno', teamSlug: team1Id },
    { action: 'ban', mapName: 'de_ancient', teamSlug: team1Id },
    { action: 'ban', mapName: 'de_dust2', teamSlug: team2Id },
    { action: 'ban', mapName: 'de_nuke', teamSlug: team2Id },
    { action: 'ban', mapName: 'de_anubis', teamSlug: team2Id },
    { action: 'ban', mapName: 'de_vertigo', teamSlug: team1Id },
    { action: 'side_pick', side: 'CT', teamSlug: team2Id }, // Team B picks CT on remaining map (Mirage)
  ];
}

/**
 * Convert CS Major BO3 actions to UI actions
 */
export function getCSMajorBO3UIActions(team1Id: string, team2Id: string): VetoUIAction[] {
  return [
    { action: 'ban', mapName: 'de_inferno', teamSlug: team1Id },
    { action: 'ban', mapName: 'de_mirage', teamSlug: team2Id },
    { action: 'pick', mapName: 'de_anubis', teamSlug: team1Id },
    { action: 'side_pick', side: 'CT', teamSlug: team2Id },
    { action: 'pick', mapName: 'de_dust2', teamSlug: team2Id },
    { action: 'side_pick', side: 'T', teamSlug: team1Id },
    { action: 'ban', mapName: 'de_vertigo', teamSlug: team2Id },
    { action: 'ban', mapName: 'de_nuke', teamSlug: team1Id },
    { action: 'side_pick', side: 'CT', teamSlug: team2Id }, // Team B picks CT on decider (Ancient)
  ];
}

