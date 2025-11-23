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
      console.error('Tournament creation failed:', {
        status: response.status(),
        statusText: response.statusText(),
        error: errorText,
        input: { name: input.name, type: input.type, format: input.format, teamCount: input.teamIds.length },
      });
      return null;
    }

    const data = await response.json();
    // API returns { success: true, tournament, message }
    if (!data.tournament) {
      console.error('Tournament creation response missing tournament:', data);
      return null;
    }
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
  // Delete any existing tournament first to avoid conflicts
  try {
    await request.delete('/api/tournament', {
      headers: getAuthHeader(),
    });
    // Wait a bit for deletion to complete
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    // Ignore errors if no tournament exists
  }

  const tournament = await createTournament(request, input);
  if (!tournament) {
    console.error('Failed to create tournament:', input.name);
    return null;
  }

  // Wait a bit for bracket generation
  await new Promise(resolve => setTimeout(resolve, 1000));

  const started = await startTournament(request);
  if (!started) {
    console.error('Failed to start tournament:', input.name);
    return null;
  }

  return tournament;
}
