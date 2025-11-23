import { APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';

/**
 * Tournament helper functions
 */

export interface CreateTournamentInput {
  name: string;
  type: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';
  format: 'bo1' | 'bo3' | 'bo5';
  maps: string[];
  teamIds: string[];
  settings?: Record<string, any>;
}

export interface Tournament {
  id: number;
  name: string;
  type: string;
  format: string;
  maps: string[];
  teamIds: string[];
}

/**
 * Create a tournament
 * @param request Playwright API request context
 * @param input Tournament data
 * @returns Created tournament or null
 */
export async function createTournament(
  request: APIRequestContext,
  input: CreateTournamentInput
): Promise<Tournament | null> {
  try {
    const response = await request.post('/api/tournament', {
      headers: getAuthHeader(),
      data: input,
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Tournament creation failed:', errorText);
      return null;
    }

    const data = await response.json();
    return data.tournament;
  } catch (error) {
    console.error('Tournament creation error:', error);
    return null;
  }
}

/**
 * Start a tournament
 * @param request Playwright API request context
 * @returns true if successful
 */
export async function startTournament(request: APIRequestContext): Promise<boolean> {
  try {
    const response = await request.post('/api/tournament/start', {
      headers: getAuthHeader(),
    });
    return response.ok();
  } catch (error) {
    console.error('Tournament start error:', error);
    return false;
  }
}

/**
 * Create and start a tournament
 * @param request Playwright API request context
 * @param input Tournament data
 * @returns Created tournament or null
 */
export async function createAndStartTournament(
  request: APIRequestContext,
  input: CreateTournamentInput
): Promise<Tournament | null> {
  const tournament = await createTournament(request, input);
  if (!tournament) {
    return null;
  }

  const started = await startTournament(request);
  if (!started) {
    return null;
  }

  return tournament;
}
