import { APIRequestContext } from '@playwright/test';

/**
 * Veto helper functions
 */

export interface VetoAction {
  mapName?: string;
  side?: 'CT' | 'T';
  teamSlug: string;
}

/**
 * Execute a veto action
 * @param request Playwright API request context
 * @param matchSlug Match slug
 * @param action Veto action
 * @returns Response data or null
 */
export async function executeVetoAction(
  request: APIRequestContext,
  matchSlug: string,
  action: VetoAction
): Promise<any | null> {
  try {
    const response = await request.post(`/api/veto/${matchSlug}/action`, {
      data: action,
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Veto action failed:', errorText);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Veto action error:', error);
    return null;
  }
}

/**
 * Execute multiple veto actions in sequence
 * @param request Playwright API request context
 * @param matchSlug Match slug
 * @param actions Array of veto actions
 * @returns Last response data or null
 */
export async function executeVetoActions(
  request: APIRequestContext,
  matchSlug: string,
  actions: VetoAction[]
): Promise<any | null> {
  let lastResponse = null;

  for (const action of actions) {
    lastResponse = await executeVetoAction(request, matchSlug, action);
    if (!lastResponse) {
      return null;
    }
  }

  return lastResponse;
}

/**
 * Get veto state
 * @param request Playwright API request context
 * @param matchSlug Match slug
 * @returns Veto state or null
 */
export async function getVetoState(
  request: APIRequestContext,
  matchSlug: string
): Promise<any | null> {
  try {
    const response = await request.get(`/api/veto/${matchSlug}`);

    if (!response.ok()) {
      return null;
    }

    const data = await response.json();
    return data.veto || null;
  } catch (error) {
    console.error('Veto state fetch error:', error);
    return null;
  }
}

/**
 * CS Major BO1 veto actions (7 steps)
 */
export function getCSMajorBO1Actions(team1Id: string, team2Id: string): VetoAction[] {
  return [
    { mapName: 'de_mirage', teamSlug: team1Id }, // Team A removes 1
    { mapName: 'de_inferno', teamSlug: team1Id }, // Team A removes 2
    { mapName: 'de_ancient', teamSlug: team2Id }, // Team B removes 1
    { mapName: 'de_anubis', teamSlug: team2Id }, // Team B removes 2
    { mapName: 'de_dust2', teamSlug: team2Id }, // Team B removes 3
    { mapName: 'de_vertigo', teamSlug: team1Id }, // Team A removes 1
    { side: 'CT', teamSlug: team2Id }, // Team B picks side
  ];
}

/**
 * CS Major BO3 veto actions (9 steps)
 */
export function getCSMajorBO3Actions(team1Id: string, team2Id: string): VetoAction[] {
  return [
    { mapName: 'de_mirage', teamSlug: team1Id }, // Team A removes 1
    { mapName: 'de_inferno', teamSlug: team2Id }, // Team B removes 1
    { mapName: 'de_ancient', teamSlug: team1Id }, // Team A picks Map 1
    { side: 'CT', teamSlug: team2Id }, // Team B picks side on Map 1
    { mapName: 'de_anubis', teamSlug: team2Id }, // Team B picks Map 2
    { side: 'T', teamSlug: team1Id }, // Team A picks side on Map 2
    { mapName: 'de_dust2', teamSlug: team2Id }, // Team B removes 1
    { mapName: 'de_vertigo', teamSlug: team1Id }, // Team A removes 1
    { side: 'CT', teamSlug: team2Id }, // Team B picks side on Map 3
  ];
}
