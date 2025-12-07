/**
 * Player Service
 * Handles player CRUD operations and bulk import
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { eloToOpenSkill } from './ratingService';
import { settingsService } from './settingsService';

export interface PlayerRecord {
  id: string; // Steam ID
  name: string;
  avatar_url?: string;
  current_elo: number;
  starting_elo: number;
  openskill_mu: number;
  openskill_sigma: number;
  match_count: number;
  created_at: number;
  updated_at: number;
}

export interface CreatePlayerInput {
  id: string; // Steam ID
  name: string;
  avatar?: string;
  elo?: number; // Optional - defaults to 3000
}

export interface UpdatePlayerInput {
  name?: string;
  avatar?: string;
  elo?: number;
}

export interface PlayerResponse {
  id: string;
  name: string;
  avatar?: string;
  currentElo: number;
  startingElo: number;
  matchCount: number;
  createdAt: number;
  updatedAt: number;
}

class PlayerService {
  /**
   * Convert database row to response format
   */
  private toResponse(player: PlayerRecord): PlayerResponse {
    return {
      id: player.id,
      name: player.name,
      avatar: player.avatar_url || undefined,
      currentElo: player.current_elo,
      startingElo: player.starting_elo,
      matchCount: player.match_count,
      createdAt: player.created_at,
      updatedAt: player.updated_at,
    };
  }

  /**
   * Get all players
   */
  async getAllPlayers(): Promise<PlayerResponse[]> {
    const players = await db.getAllAsync<PlayerRecord>('players', undefined, undefined);
    return players.map((p) => this.toResponse(p));
  }

  /**
   * Get player by Steam ID
   */
  async getPlayerById(playerId: string): Promise<PlayerResponse | null> {
    const player = await db.queryOneAsync<PlayerRecord>('SELECT * FROM players WHERE id = ?', [playerId]);
    if (!player) {
      return null;
    }
    return this.toResponse(player);
  }

  /**
   * Create a new player
   * If no ELO is provided, uses configured default (fallback 3000, FaceIT-style)
   */
  async createPlayer(input: CreatePlayerInput): Promise<PlayerResponse> {
    const elo =
      input.elo !== undefined ? input.elo : await settingsService.getDefaultPlayerElo();
    const now = Math.floor(Date.now() / 1000);

    // Convert ELO to OpenSkill rating
    const openskillRating = eloToOpenSkill(elo, 0); // New player, 0 matches

    const playerData: Omit<PlayerRecord, 'id'> = {
      name: input.name,
      avatar_url: input.avatar || undefined,
      current_elo: elo,
      starting_elo: elo,
      openskill_mu: openskillRating.mu,
      openskill_sigma: openskillRating.sigma,
      match_count: 0,
      created_at: now,
      updated_at: now,
    };

    await db.insertAsync('players', {
      id: input.id,
      ...playerData,
    });

    const player = await this.getPlayerById(input.id);
    if (!player) {
      throw new Error('Failed to create player');
    }

    log.success(`Created player: ${input.name} (${input.id}) with ELO ${elo}`);
    return player;
  }

  /**
   * Update a player
   */
  async updatePlayer(playerId: string, input: UpdatePlayerInput): Promise<PlayerResponse | null> {
    const existing = await db.getOneAsync<PlayerRecord>('players', 'id = ?', [playerId]);
    if (!existing) {
      return null;
    }

    const updates: Partial<PlayerRecord> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (input.name !== undefined) {
      updates.name = input.name;
    }

    if (input.avatar !== undefined) {
      updates.avatar_url = input.avatar || undefined;
    }

    if (input.elo !== undefined) {
      // Update ELO and OpenSkill rating
      const openskillRating = eloToOpenSkill(input.elo, existing.match_count);
      updates.current_elo = input.elo;
      updates.openskill_mu = openskillRating.mu;
      updates.openskill_sigma = openskillRating.sigma;
    }

    await db.updateAsync('players', updates, 'id = ?', [playerId]);

    return await this.getPlayerById(playerId);
  }

  /**
   * Delete a player
   */
  async deletePlayer(playerId: string): Promise<boolean> {
    const result = await db.deleteAsync('players', 'id = ?', [playerId]);
    return result.changes > 0;
  }

  /**
   * Bulk import players from array
   * Creates players if they don't exist, updates if they do
   */
  async bulkImportPlayers(players: CreatePlayerInput[]): Promise<{
    created: number;
    updated: number;
    errors: Array<{ player: CreatePlayerInput; error: string }>;
  }> {
    let created = 0;
    let updated = 0;
    const errors: Array<{ player: CreatePlayerInput; error: string }> = [];

    for (const playerInput of players) {
      try {
        const existing = await this.getPlayerById(playerInput.id);
        if (existing) {
          // Update existing player
          await this.updatePlayer(playerInput.id, {
            name: playerInput.name,
            avatar: playerInput.avatar,
            elo: playerInput.elo,
          });
          updated++;
        } else {
          // Create new player
          await this.createPlayer(playerInput);
          created++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ player: playerInput, error: errorMessage });
        log.error(`Error importing player ${playerInput.id}`, { error: errorMessage });
      }
    }

    log.success(
      `Bulk import complete: ${created} created, ${updated} updated, ${errors.length} errors`
    );
    return { created, updated, errors };
  }

  /**
   * Get or create player (useful for team import)
   * Returns existing player or creates new one with specified or default ELO
   */
  async getOrCreatePlayer(
    steamId: string,
    name: string,
    avatar?: string,
    elo?: number
  ): Promise<PlayerRecord> {
    const existing = await db.getOneAsync<PlayerRecord>('players', 'id = ?', [steamId]);
    if (existing) {
      return existing;
    }

    // Create with specified ELO or configured default (fallback 3000)
    const playerElo =
      elo !== undefined ? elo : await settingsService.getDefaultPlayerElo();
    const now = Math.floor(Date.now() / 1000);
    const openskillRating = eloToOpenSkill(playerElo, 0);

    await db.insertAsync('players', {
      id: steamId,
      name,
      avatar_url: avatar || null,
      current_elo: playerElo,
      starting_elo: playerElo,
      openskill_mu: openskillRating.mu,
      openskill_sigma: openskillRating.sigma,
      match_count: 0,
      created_at: now,
      updated_at: now,
    });

    const player = await db.getOneAsync<PlayerRecord>('players', 'id = ?', [steamId]);
    if (!player) {
      throw new Error(`Failed to create player ${steamId}`);
    }

    return player;
  }

  /**
   * Get players by Steam IDs
   */
  async getPlayersByIds(steamIds: string[]): Promise<PlayerRecord[]> {
    if (steamIds.length === 0) {
      return [];
    }

    const placeholders = steamIds.map(() => '?').join(',');
    const players = await db.queryAsync<PlayerRecord>(
      `SELECT * FROM players WHERE id IN (${placeholders})`,
      steamIds
    );

    return players;
  }

  /**
   * Search players by name
   */
  async searchPlayers(query: string, limit: number = 50): Promise<PlayerResponse[]> {
    const players = await db.queryAsync<PlayerRecord>(
      `SELECT * FROM players WHERE name ILIKE ? ORDER BY name LIMIT ?`,
      [`%${query}%`, limit]
    );

    return players.map((p) => this.toResponse(p));
  }
}

export const playerService = new PlayerService();
