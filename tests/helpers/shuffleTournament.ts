import { APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';
import { createTestPlayers, type Player } from './players';
import { createTestServer, type Server } from './servers';

/**
 * Shuffle tournament helper functions
 */

export interface CreateShuffleTournamentInput {
  name?: string;
  mapSequence?: string[];
  roundLimitType?: 'first_to_13' | 'max_rounds';
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
}

export interface ShuffleTournament {
  id: number;
  name: string;
  type: 'shuffle';
  format: 'bo1';
  status: string;
  mapSequence: string[];
  roundLimitType: 'first_to_13' | 'max_rounds';
  maxRounds: number;
  overtimeMode: 'enabled' | 'disabled';
}

const DEFAULT_MAPS = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2'];

/**
 * Create a shuffle tournament
 * @param request Playwright API request context
 * @param input Tournament configuration
 * @returns Created tournament or null
 */
export async function createShuffleTournament(
  request: APIRequestContext,
  input: CreateShuffleTournamentInput = {}
): Promise<ShuffleTournament | null> {
  const {
    name,
    mapSequence = DEFAULT_MAPS,
    roundLimitType = 'max_rounds',
    maxRounds = 24,
    overtimeMode = 'enabled',
  } = input;

  const tournamentName = name || `Shuffle Tournament ${Date.now()}`;

  try {
    const response = await request.post('/api/tournament/shuffle', {
      headers: getAuthHeader(),
      data: {
        name: tournamentName,
        mapSequence,
        roundLimitType,
        maxRounds,
        overtimeMode,
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Shuffle tournament creation failed:', {
        status: response.status(),
        statusText: response.statusText(),
        error: errorText,
      });
      return null;
    }

    const data = await response.json();

    if (!data.success) {
      console.error('Shuffle tournament creation returned success: false', data);
      return null;
    }

    if (!data.tournament) {
      console.error('Shuffle tournament creation response missing tournament object', data);
      return null;
    }

    return data.tournament;
  } catch (error) {
    console.error('Shuffle tournament creation error:', error);
    return null;
  }
}

/**
 * Register players to shuffle tournament
 * @param request Playwright API request context
 * @param playerIds Array of player Steam IDs
 * @returns Registration result
 */
export async function registerPlayers(
  request: APIRequestContext,
  playerIds: string[]
): Promise<{ registered: number; errors: Array<{ playerId: string; error: string }> } | null> {
  try {
    const response = await request.post('/api/tournament/1/register-players', {
      headers: getAuthHeader(),
      data: { playerIds },
    });

    let data: any;
    try {
      data = await response.json();
    } catch {
      // If response is not JSON, still return a structure with error
      console.error('Player registration failed: response is not JSON');
      return {
        registered: 0,
        errors: playerIds.map((id) => ({
          playerId: id,
          error: 'Failed to parse response as JSON',
        })),
      };
    }

    // Handle both success and error responses
    // API returns 400 with { success: false, error: "..." } when tournament is not in setup
    // API returns 207 with { success: false, registered: 0, errors: [...] } when some fail
    // API returns 200 with { success: true, registered: N, errors: [] } when all succeed
    if (!response.ok()) {
      // If it's a 400 error (tournament not in setup), return structure with errors
      if (response.status() === 400 && data.error) {
        return {
          registered: 0,
          errors: playerIds.map((id) => ({ playerId: id, error: data.error })),
        };
      }
      // For other errors, try to parse the response
      if (data.registered !== undefined) {
        return {
          registered: data.registered || 0,
          errors: data.errors || [],
        };
      }
      // If we have an error message but no registered field, create error structure
      if (data.error) {
        return {
          registered: 0,
          errors: playerIds.map((id) => ({ playerId: id, error: data.error })),
        };
      }
      // If we get here, we have an unexpected error structure
      // Still return a structure with registered: 0 and errors
      console.warn('Player registration failed with unexpected structure:', data);
      return {
        registered: 0,
        errors: playerIds.map((id) => ({
          playerId: id,
          error: data.error || `HTTP ${response.status()}: ${JSON.stringify(data)}`,
        })),
      };
    }

    return {
      registered: data.registered || 0,
      errors: data.errors || [],
    };
  } catch (error) {
    console.error('Player registration error:', error);
    // Even on error, return a structure so tests can check the error
    return {
      registered: 0,
      errors: playerIds.map((id) => ({
        playerId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      })),
    };
  }
}

/**
 * Get registered players for tournament
 * @param request Playwright API request context
 * @param tournamentId Tournament ID (default: 1)
 * @returns Array of registered players or null
 */
export async function getRegisteredPlayers(
  request: APIRequestContext,
  tournamentId: number = 1
): Promise<Player[] | null> {
  try {
    const response = await request.get(`/api/tournament/${tournamentId}/players`, {
      headers: getAuthHeader(),
    });

    if (!response.ok()) {
      return null;
    }

    const data = await response.json();
    return data.players || [];
  } catch (error) {
    console.error('Get registered players error:', error);
    return null;
  }
}

/**
 * Get tournament leaderboard
 * @param request Playwright API request context
 * @param tournamentId Tournament ID (default: 1)
 * @returns Leaderboard data or null
 */
export async function getLeaderboard(
  request: APIRequestContext,
  tournamentId: number = 1
): Promise<any | null> {
  try {
    const response = await request.get(`/api/tournament/${tournamentId}/leaderboard`, {
      headers: getAuthHeader(),
    });

    if (!response.ok()) {
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Get leaderboard error:', error);
    return null;
  }
}

/**
 * Get tournament leaderboard (public endpoint)
 * @param request Playwright API request context
 * @param tournamentId Tournament ID (default: 1)
 * @returns Leaderboard data or null
 */
export async function getStandings(
  request: APIRequestContext,
  tournamentId: number = 1
): Promise<any | null> {
  try {
    // Public endpoint - no auth required
    const response = await request.get(`/api/tournament/${tournamentId}/leaderboard`);

    if (!response.ok()) {
      // Log the error for debugging
      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn(`Get leaderboard failed (${response.status()}):`, errorText);
      return null;
    }

    const data = await response.json();

    // Check if response has success: false
    if (data.success === false) {
      console.warn('Get leaderboard returned success: false:', data);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Get leaderboard error:', error);
    return null;
  }
}

/**
 * Get round status
 * @param request Playwright API request context
 * @param tournamentId Tournament ID (default: 1)
 * @returns Round status or null
 */
export async function getRoundStatus(
  request: APIRequestContext,
  tournamentId: number = 1
): Promise<any | null> {
  try {
    const response = await request.get(`/api/tournament/${tournamentId}/round-status`, {
      headers: getAuthHeader(),
    });

    if (!response.ok()) {
      return null;
    }

    const data = await response.json();

    // API returns { success, roundStatus, currentRound, totalRounds }
    // For tests, we primarily care about the RoundStatus object
    if (data.roundStatus) {
      // Preserve round metadata as extra fields in case tests need them
      return {
        ...data.roundStatus,
        currentRound: data.currentRound,
        totalRounds: data.totalRounds,
      };
    }

    return null;
  } catch (error) {
    console.error('Get round status error:', error);
    return null;
  }
}

/**
 * Generate round manually (admin)
 * @param request Playwright API request context
 * @param tournamentId Tournament ID (default: 1)
 * @param roundNumber Round number to generate
 * @returns true if successful
 */
export async function generateRound(
  request: APIRequestContext,
  tournamentId: number = 1,
  roundNumber?: number
): Promise<boolean> {
  try {
    const response = await request.post(`/api/tournament/${tournamentId}/generate-round`, {
      headers: getAuthHeader(),
      data: roundNumber ? { roundNumber } : {},
    });

    return response.ok();
  } catch (error) {
    console.error('Generate round error:', error);
    return false;
  }
}

/**
 * Start shuffle tournament
 * @param request Playwright API request context
 * @returns true if successful
 */
export async function startShuffleTournament(request: APIRequestContext): Promise<boolean> {
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
 * Comprehensive shuffle tournament setup
 * Creates tournament, players, registers players, and optionally starts tournament
 */
export interface ShuffleTournamentSetupOptions {
  name?: string;
  playerCount?: number;
  mapSequence?: string[];
  roundLimitType?: 'first_to_13' | 'max_rounds';
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  serverCount?: number;
  webhookUrl?: string;
  prefix?: string;
  startTournament?: boolean;
}

export interface ShuffleTournamentSetupResult {
  tournament: ShuffleTournament;
  players: Player[];
  servers: Server[];
  webhookUrl: string;
}

/**
 * Set webhook URL in settings
 */
async function setWebhookUrl(request: APIRequestContext, webhookUrl: string): Promise<boolean> {
  try {
    const response = await request.put('/api/settings', {
      headers: getAuthHeader(),
      data: { webhookUrl },
    });
    return response.ok();
  } catch (error) {
    console.error('Failed to set webhook URL:', error);
    return false;
  }
}

/**
 * Comprehensive shuffle tournament setup
 */
export async function setupShuffleTournament(
  request: APIRequestContext,
  options: ShuffleTournamentSetupOptions = {}
): Promise<ShuffleTournamentSetupResult | null> {
  const {
    name,
    playerCount = 20,
    mapSequence = DEFAULT_MAPS,
    roundLimitType = 'max_rounds',
    maxRounds = 24,
    overtimeMode = 'enabled',
    serverCount = 1,
    webhookUrl = 'http://localhost:3069',
    prefix = 'shuffle-test',
    startTournament = false,
  } = options;

  // Step 1: Set webhook URL
  await setWebhookUrl(request, webhookUrl);

  // Step 2: Create servers
  const servers: Server[] = [];
  for (let i = 0; i < serverCount; i++) {
    const server = await createTestServer(request, `${prefix}-server-${i}`);
    if (server) {
      servers.push(server);
    }
  }

  // Step 3: Create players
  const players = await createTestPlayers(request, playerCount, prefix, 3000);
  if (!players) {
    console.error(`Failed to create players (got null)`);
    return null;
  }

  if (players.length < playerCount) {
    console.warn(`Created ${players.length} players (requested ${playerCount}), continuing...`);
    // Don't fail if we got some players, just warn
  }

  // Step 4: Create shuffle tournament
  const tournament = await createShuffleTournament(request, {
    name: name || `${prefix} Tournament ${Date.now()}`,
    mapSequence,
    roundLimitType,
    maxRounds,
    overtimeMode,
  });

  if (!tournament) {
    console.error('Failed to create shuffle tournament');
    return null;
  }

  // Step 5: Register players
  const playerIds = players.map((p) => p.id);
  const registration = await registerPlayers(request, playerIds);
  if (!registration || registration.registered < playerCount) {
    console.error(
      `Failed to register all players (registered ${
        registration?.registered || 0
      } of ${playerCount})`
    );
    return null;
  }

  // Step 6: Start tournament if requested
  if (startTournament) {
    const started = await startShuffleTournament(request);
    if (!started) {
      console.error('Failed to start tournament');
      return null;
    }
  }

  return {
    tournament,
    players,
    servers,
    webhookUrl,
  };
}
