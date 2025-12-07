import { APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';

/**
 * Player helper functions for shuffle tournament tests
 */

export interface CreatePlayerInput {
  id: string; // Steam ID
  name: string;
  initialELO?: number; // Optional, defaults to 3000
  avatar?: string;
}

export interface Player {
  id: string;
  name: string;
  avatar?: string;
  currentElo: number;
  startingElo: number;
}

/**
 * Create a player
 * @param request Playwright API request context
 * @param input Player data
 * @returns Created player or null
 */
export async function createPlayer(
  request: APIRequestContext,
  input: CreatePlayerInput
): Promise<Player | null> {
  try {
    const response = await request.post('/api/players', {
      headers: getAuthHeader(),
      data: {
        id: input.id,
        name: input.name,
        elo: input.initialELO,
        avatar: input.avatar,
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      const status = response.status();
      
      // If player already exists (409 or 400 with duplicate key), try to fetch it instead
      const isDuplicateError = status === 409 || 
        (status === 400 && errorText.includes('duplicate key'));
      
      if (isDuplicateError) {
        console.warn(`Player ${input.id} already exists, fetching existing player`);
        return await getPlayer(request, input.id);
      }
      
      console.error('Player creation failed:', {
        status,
        statusText: response.statusText(),
        error: errorText,
        playerId: input.id,
      });
      return null;
    }

    const data = await response.json();
    
    // Handle response structure - should have player object
    if (!data.success) {
      console.error('Player creation returned success: false', data);
      return null;
    }
    
    if (!data.player) {
      console.error('Player creation response missing player object', data);
      return null;
    }
    
    return data.player;
  } catch (error) {
    console.error('Player creation error:', error);
    return null;
  }
}

/**
 * Bulk import players
 * @param request Playwright API request context
 * @param players Array of player data
 * @returns Array of created players or null
 */
export async function bulkImportPlayers(
  request: APIRequestContext,
  players: CreatePlayerInput[]
): Promise<Player[] | null> {
  try {
    const response = await request.post('/api/players/bulk-import', {
      headers: getAuthHeader(),
      data: players.map((p) => ({
        id: p.id,
        name: p.name,
        elo: p.initialELO,
        avatar: p.avatar,
      })),
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Bulk player import failed:', errorText);
      return null;
    }

    // Bulk import doesn't return players array, fetch them instead
    const data = await response.json();
    
    // Check for errors but continue if some succeeded
    if (!data.success || (data.errors && data.errors.length > 0)) {
      console.warn('Bulk import had errors:', data.errors || []);
      // If all failed, return null
      if (data.created === 0 && data.updated === 0) {
        return null;
      }
    }

    // Wait a bit for database to update
    await new Promise(resolve => setTimeout(resolve, 500));

    // Fetch the imported players by their IDs
    const allPlayers = await getAllPlayers(request);
    if (!allPlayers) {
      console.error('Failed to fetch players after bulk import');
      return null;
    }

    // Filter to only the players we just imported
    const playerIds = players.map((p) => p.id);
    const imported = allPlayers.filter((p) => playerIds.includes(p.id));
    
    // If we couldn't find all players, that's okay - return what we found
    if (imported.length === 0) {
      console.warn('No players found after bulk import, but import may have succeeded');
      return null;
    }
    
    return imported;
  } catch (error) {
    console.error('Bulk player import error:', error);
    return null;
  }
}

/**
 * Create test players for shuffle tournament
 * @param request Playwright API request context
 * @param count Number of players to create
 * @param prefix Prefix for player names/IDs
 * @param baseElo Base ELO value (default: 3000)
 * @returns Array of created players or null
 */
export async function createTestPlayers(
  request: APIRequestContext,
  count: number,
  prefix: string = 'test',
  baseElo: number = 3000
): Promise<Player[] | null> {
  // Real Steam IDs for testing - public profiles that should exist
  const realSteamIds = [
    '76561197960287930', // Gabe Newell (public profile)
    '76561198013825972',
    '76561198067146383',
    '76561198021466528',
    '76561198059949467',
    '76561198077860982',
    '76561198041282941',
    '76561198012563928',
    '76561198063472351',
    '76561198084126937',
    '76561198012345678',
    '76561198023456789',
    '76561198034567890',
    '76561198045678901',
    '76561198056789012',
    '76561198067890123',
    '76561198078901234',
    '76561198089012345',
    '76561198090123456',
    '76561198101234567',
  ];

  const timestamp = Date.now();

  // Use bulk import for efficiency
  const playerInputs: CreatePlayerInput[] = [];
  for (let i = 0; i < count; i++) {
    const steamId = realSteamIds[i % realSteamIds.length];
    // Add variation to ELO for testing team balancing
    const eloVariation = Math.floor((i % 10) * 50); // 0-450 ELO variation
    playerInputs.push({
      id: `${prefix}-player-${i}-${timestamp}`,
      name: `${prefix} Player ${i + 1} ${timestamp}`,
      initialELO: baseElo + eloVariation,
    });
  }

  const created = await bulkImportPlayers(request, playerInputs);
  if (!created || created.length < count) {
    console.error(`Failed to create all players: expected ${count}, got ${created?.length || 0}`);
    return null;
  }

  return created;
}

/**
 * Get player by ID
 * @param request Playwright API request context
 * @param playerId Player Steam ID
 * @returns Player or null
 */
export async function getPlayer(
  request: APIRequestContext,
  playerId: string
): Promise<Player | null> {
  try {
    const response = await request.get(`/api/players/${playerId}`, {
      headers: getAuthHeader(),
    });

    if (!response.ok()) {
      return null;
    }

    const data = await response.json();
    return data.player || null;
  } catch (error) {
    console.error('Player fetch error:', error);
    return null;
  }
}

/**
 * Update player ELO
 * @param request Playwright API request context
 * @param playerId Player Steam ID
 * @param newElo New ELO value
 * @returns Updated player or null
 */
export async function updatePlayerElo(
  request: APIRequestContext,
  playerId: string,
  newElo: number
): Promise<Player | null> {
  try {
    const response = await request.put(`/api/players/${playerId}`, {
      headers: getAuthHeader(),
      data: { elo: newElo },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Player ELO update failed:', errorText);
      return null;
    }

    const data = await response.json();
    return data.player || null;
  } catch (error) {
    console.error('Player ELO update error:', error);
    return null;
  }
}

/**
 * Get all players
 * @param request Playwright API request context
 * @returns Array of players or null
 */
export async function getAllPlayers(request: APIRequestContext): Promise<Player[] | null> {
  try {
    const response = await request.get('/api/players', {
      headers: getAuthHeader(),
    });

    if (!response.ok()) {
      return null;
    }

    const data = await response.json();
    return data.players || [];
  } catch (error) {
    console.error('Get players error:', error);
    return null;
  }
}

