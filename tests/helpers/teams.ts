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
  const timestamp = Date.now();
  const players = [
    { steamId: '76561198000000001', name: 'Player 1' },
    { steamId: '76561198000000002', name: 'Player 2' },
    { steamId: '76561198000000003', name: 'Player 3' },
    { steamId: '76561198000000004', name: 'Player 4' },
    { steamId: '76561198000000005', name: 'Player 5' },
  ];
  
  const team1 = await createTeam(request, {
    id: `${prefix}-team-a-${timestamp}`,
    name: `${prefix} Team A ${timestamp}`,
    players,
  });
  
  if (!team1) {
    return null;
  }
  
  const team2 = await createTeam(request, {
    id: `${prefix}-team-b-${timestamp}`,
    name: `${prefix} Team B ${timestamp}`,
    players,
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

