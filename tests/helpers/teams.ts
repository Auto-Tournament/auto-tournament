import { APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';

/**
 * Team helper functions
 */

export interface CreateTeamInput {
  id: string;
  name: string;
  players: Array<{ steamId: string; name: string }>;
}

export interface Team {
  id: string;
  name: string;
  players: Array<{ steamId: string; name: string }>;
}

/**
 * Create a team
 * @param request Playwright API request context
 * @param input Team data
 * @returns Created team or null
 */
export async function createTeam(
  request: APIRequestContext,
  input: CreateTeamInput
): Promise<Team | null> {
  try {
    const response = await request.post('/api/teams', {
      headers: getAuthHeader(),
      data: input,
    });
    
    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Team creation failed:', errorText);
      return null;
    }
    
    const data = await response.json();
    return data.team;
  } catch (error) {
    console.error('Team creation error:', error);
    return null;
  }
}

/**
 * Create two teams for testing
 * @param request Playwright API request context
 * @param prefix Prefix for team names/IDs
 * @returns Array with [team1, team2] or null if failed
 */
export async function createTestTeams(
  request: APIRequestContext,
  prefix: string = 'test'
): Promise<[Team, Team] | null> {
  // Real Steam IDs for testing avatars - public profiles that should exist
  const realSteamIds = [
    '76561197960287930', // Gabe Newell (public profile)
    '76561198013825972', // Popular public profile
    '76561198067146383', // Popular public profile
    '76561198021466528', // Popular public profile
    '76561198059949467', // Popular public profile
    '76561198077860982', // Popular public profile
    '76561198041282941', // Popular public profile
    '76561198012563928', // Popular public profile
    '76561198063472351', // Popular public profile
    '76561198084126937', // Popular public profile
  ];

  const timestamp = Date.now();
  const players = [
    { steamId: realSteamIds[0], name: 'Player 1' },
    { steamId: realSteamIds[1], name: 'Player 2' },
    { steamId: realSteamIds[2], name: 'Player 3' },
    { steamId: realSteamIds[3], name: 'Player 4' },
    { steamId: realSteamIds[4], name: 'Player 5' },
  ];
  
  const team1 = await createTeam(request, {
    id: `${prefix}-team-a-${timestamp}`,
    name: `${prefix} Team A ${timestamp}`,
    players,
  });
  
  if (!team1) {
    return null;
  }
  
  const team2Players = [
    { steamId: realSteamIds[5], name: 'Player 1' },
    { steamId: realSteamIds[6], name: 'Player 2' },
    { steamId: realSteamIds[7], name: 'Player 3' },
    { steamId: realSteamIds[8], name: 'Player 4' },
    { steamId: realSteamIds[9], name: 'Player 5' },
  ];
  
  const team2 = await createTeam(request, {
    id: `${prefix}-team-b-${timestamp}`,
    name: `${prefix} Team B ${timestamp}`,
    players: team2Players,
  });
  
  if (!team2) {
    return null;
  }
  
  return [team1, team2];
}

/**
 * Update a team
 * @param request Playwright API request context
 * @param teamId Team ID to update
 * @param updates Partial team data to update
 * @returns Updated team or null
 */
export async function updateTeam(
  request: APIRequestContext,
  teamId: string,
  updates: Partial<CreateTeamInput>
): Promise<Team | null> {
  try {
    const response = await request.put(`/api/teams/${teamId}`, {
      headers: getAuthHeader(),
      data: updates,
    });
    
    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Team update failed:', errorText);
      return null;
    }
    
    const data = await response.json();
    return data.team;
  } catch (error) {
    console.error('Team update error:', error);
    return null;
  }
}

/**
 * Delete a team
 * @param request Playwright API request context
 * @param teamId Team ID to delete
 * @returns true if successful
 */
export async function deleteTeam(
  request: APIRequestContext,
  teamId: string
): Promise<boolean> {
  try {
    const response = await request.delete(`/api/teams/${teamId}`, {
      headers: getAuthHeader(),
    });
    return response.ok();
  } catch (error) {
    console.error('Team deletion error:', error);
    return false;
  }
}

