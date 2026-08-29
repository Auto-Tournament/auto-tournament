import { APIRequestContext } from '@playwright/test';
import { impersonatePlayer, stopImpersonating } from './auth';
import type { Team } from './teams';

/**
 * Veto helper functions
 *
 * ## Why these actions carry a Steam ID
 *
 * `POST /api/veto/:slug/action` decides whose turn it is from the *caller's
 * Steam identity*, not from anything in the request body. A `teamSlug` field in
 * the payload is ignored — a player cannot act for the other team by forging it.
 *
 * Tests therefore have to act as a real member of the team whose turn it is.
 * They do that with admin impersonation: `executeVetoActions` switches the
 * request context's effective identity to a player on the acting team before
 * each step, and drops impersonation when the sequence finishes.
 */

export interface VetoAction {
  mapName?: string;
  side?: 'CT' | 'T';
  /** Team whose turn this step is. Kept for readability in test expectations. */
  teamSlug: string;
  /**
   * Steam ID of a player on `teamSlug`. The request is performed as this player
   * (via admin impersonation) so the API's turn/membership checks pass.
   */
  actAsSteamId: string;
}

/**
 * Pick the Steam ID used to act on behalf of a team.
 *
 * Any roster member works — the API only checks membership and turn order — so
 * we consistently use the first player for deterministic, readable failures.
 */
export function actingSteamIdFor(team: Team): string {
  const steamId = team.players?.[0]?.steamId;
  if (!steamId) {
    throw new Error(`Team ${team.id} has no players to act as during veto`);
  }
  return steamId;
}

/**
 * Execute a veto action as the player named in `action.actAsSteamId`.
 *
 * Assumes the caller has already established an admin session on `request`
 * (impersonation is admin-gated).
 *
 * @returns Response data or null
 */
export async function executeVetoAction(
  request: APIRequestContext,
  matchSlug: string,
  action: VetoAction
): Promise<any | null> {
  try {
    const impersonated = await impersonatePlayer(request, action.actAsSteamId);
    if (!impersonated) {
      console.error('Could not impersonate player for veto action:', {
        matchSlug,
        steamId: action.actAsSteamId,
      });
      return null;
    }

    const response = await request.post(`/api/veto/${matchSlug}/action`, {
      data: action,
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Veto action failed:', {
        status: response.status(),
        statusText: response.statusText(),
        error: errorText,
        matchSlug,
        action,
      });

      // If match not found, tournament might not be started
      if (response.status() === 404) {
        console.error('Match not found. Ensure tournament is started and match exists.');
      }

      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Veto action error:', error);
    return null;
  }
}

/**
 * Execute multiple veto actions in sequence.
 *
 * Impersonation is always cleared afterwards — including on failure — so a
 * broken step cannot leak an impersonated identity into later assertions.
 *
 * @returns Last response data or null
 */
export async function executeVetoActions(
  request: APIRequestContext,
  matchSlug: string,
  actions: VetoAction[]
): Promise<any | null> {
  let lastResponse = null;

  try {
    for (const action of actions) {
      lastResponse = await executeVetoAction(request, matchSlug, action);
      if (!lastResponse) {
        return null;
      }
    }
  } finally {
    await stopImpersonating(request);
  }

  return lastResponse;
}

/**
 * Get veto state.
 *
 * `GET /api/veto/:slug` redacts its response for spectators: non-participants
 * only see team names, status and picked map names. Pass `actAsSteamId` to read
 * the full state (steps, turn, banned maps) as a team member.
 */
export async function getVetoState(
  request: APIRequestContext,
  matchSlug: string,
  actAsSteamId?: string
): Promise<any | null> {
  try {
    if (actAsSteamId) {
      const impersonated = await impersonatePlayer(request, actAsSteamId);
      if (!impersonated) {
        console.error('Could not impersonate player to read veto state:', {
          matchSlug,
          steamId: actAsSteamId,
        });
        return null;
      }
    }

    try {
      const response = await request.get(`/api/veto/${matchSlug}`);

      if (!response.ok()) {
        return null;
      }

      const data = await response.json();
      return data.veto || null;
    } finally {
      if (actAsSteamId) {
        await stopImpersonating(request);
      }
    }
  } catch (error) {
    console.error('Veto state fetch error:', error);
    return null;
  }
}

/**
 * CS Major BO1 veto actions (7 steps)
 *
 * Team A removes 2, Team B removes 3, Team A removes 1, Team B picks side.
 */
export function getCSMajorBO1Actions(team1: Team, team2: Team): VetoAction[] {
  const a = { teamSlug: team1.id, actAsSteamId: actingSteamIdFor(team1) };
  const b = { teamSlug: team2.id, actAsSteamId: actingSteamIdFor(team2) };

  return [
    { mapName: 'de_mirage', ...a }, // Team A removes 1
    { mapName: 'de_inferno', ...a }, // Team A removes 2
    { mapName: 'de_ancient', ...b }, // Team B removes 1
    { mapName: 'de_anubis', ...b }, // Team B removes 2
    { mapName: 'de_dust2', ...b }, // Team B removes 3
    { mapName: 'de_vertigo', ...a }, // Team A removes 1
    { side: 'CT', ...b }, // Team B picks side
  ];
}

/**
 * CS Major BO3 veto actions (9 steps)
 */
export function getCSMajorBO3Actions(team1: Team, team2: Team): VetoAction[] {
  const a = { teamSlug: team1.id, actAsSteamId: actingSteamIdFor(team1) };
  const b = { teamSlug: team2.id, actAsSteamId: actingSteamIdFor(team2) };

  return [
    { mapName: 'de_mirage', ...a }, // Team A removes 1
    { mapName: 'de_inferno', ...b }, // Team B removes 1
    { mapName: 'de_ancient', ...a }, // Team A picks Map 1
    { side: 'CT', ...b }, // Team B picks side on Map 1
    { mapName: 'de_anubis', ...b }, // Team B picks Map 2
    { side: 'T', ...a }, // Team A picks side on Map 2
    { mapName: 'de_dust2', ...b }, // Team B removes 1
    { mapName: 'de_vertigo', ...a }, // Team A removes 1
    { side: 'CT', ...b }, // Team B picks side on Map 3
  ];
}
