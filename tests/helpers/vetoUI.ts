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
  await page.goto(`/team/${teamSlug}`);
  await page.waitForLoadState('networkidle');

  // Wait for veto interface to be visible (check for "Your turn" or map cards)
  try {
    await page.waitForSelector('text=/your turn|pick.*ban|map/i', { timeout: 10000 });
  } catch (error) {
    // If veto interface not found, might already be completed
    console.warn('Veto interface not found, might be completed');
    return false;
  }

  if (action.action === 'side_pick') {
    // For side pick, find and click the CT or T button
    // The buttons have text "Counter-Terrorist" or "Terrorist"
    const buttonText = action.side === 'CT' ? 'Counter-Terrorist' : 'Terrorist';
    const sideButton = page.getByRole('button', { name: new RegExp(buttonText, 'i') }).first();
    
    await expect(sideButton).toBeVisible({ timeout: 10000 });
    await expect(sideButton).toBeEnabled({ timeout: 5000 });
    await sideButton.click();
    
    // Wait for action to complete (veto state should update)
    await page.waitForTimeout(1500);
    await page.waitForLoadState('networkidle');
    return true;
  } else {
    // For ban/pick, find the map card and click it
    const mapDisplayName = action.mapName ? getMapDisplayName(action.mapName) : '';
    
    // Find the map card by its display name text
    // The map name appears in a Typography component inside a Card
    // We'll find the text and then get the closest clickable card element
    const mapNameText = page.getByText(new RegExp(`^${mapDisplayName}$`, 'i'));
    
    // Get the parent card element (the clickable card)
    const mapCard = mapNameText.locator('..').locator('..').first(); // Go up to Card level
    
    // Alternative: find by role or by clicking directly on the text's parent
    // If the above doesn't work, try finding all cards and filtering
    const allCards = page.locator('[class*="MuiCard-root"]');
    const cardCount = await allCards.count();
    
    let finalMapCard = mapCard;
    
    // If we can't find by text hierarchy, try finding by content
    if ((await mapCard.count()) === 0 && cardCount > 0) {
      // Find the card that contains the map name
      for (let i = 0; i < cardCount; i++) {
        const card = allCards.nth(i);
        const cardText = await card.textContent();
        if (cardText && cardText.includes(mapDisplayName)) {
          finalMapCard = card;
          break;
        }
      }
    }
    
    // Wait for map card to be visible
    await expect(finalMapCard).toBeVisible({ timeout: 10000 });
    
    // Click the map card
    await finalMapCard.click();
    
    // Wait for action to complete
    await page.waitForTimeout(1500);
    await page.waitForLoadState('networkidle');
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
  for (const action of actions) {
    await performVetoActionUI(page, action.teamSlug, action);
    // Small delay between actions
    await page.waitForTimeout(500);
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

