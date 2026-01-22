/**
 * Player Service
 * Handles player CRUD operations and bulk import
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { eloToOpenSkill } from './ratingService';

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
  elo?: number; // Optional - defaults to 1500 Skill Rating (OpenSkill baseline)
  isAdmin?: boolean;
}

export interface UpdatePlayerInput {
  name?: string;
  avatar?: string;
  elo?: number;
  isAdmin?: boolean;
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
  isAdmin?: boolean;
}

class PlayerService {
  /**
   * Convert database row to response format
   */
  private toResponse(player: PlayerRecord): PlayerResponse {
    const customAvatar = player.avatar_url || undefined;
    const dynamicAvatar = `/api/players/${player.id}/avatar.svg`;

    return {
      id: player.id,
      name: player.name,
      // Prefer a stored/custom avatar (e.g. from Steam or admin override),
      // otherwise fall back to a deterministic DiceBear SVG endpoint.
      avatar: customAvatar ?? dynamicAvatar,
      currentElo: player.current_elo,
      startingElo: player.starting_elo,
      matchCount: player.match_count,
      createdAt: player.created_at,
      updatedAt: player.updated_at,
      isAdmin: (player as unknown as { is_admin?: number | boolean }).is_admin === 1,
    };
  }

  /**
   * Get visible match count for a player based on distinct matches in the
   * stats table, so duplicated rating rows or book‑keeping cannot inflate the
   * user-facing "matches played" number.
   */
  private async getVisibleMatchCount(playerId: string): Promise<number> {
    const row = await db.queryOneAsync<{ count: number | string }>(
      'SELECT COUNT(DISTINCT match_slug) as count FROM player_match_stats WHERE player_id = ?',
      [playerId]
    );
    return Number(row?.count ?? 0);
  }

  /**
   * Convert database row to response format
   */
  private async toVisibleResponse(player: PlayerRecord): Promise<PlayerResponse> {
    const base = this.toResponse(player);
    const visibleMatchCount = await this.getVisibleMatchCount(player.id);
    return {
      ...base,
      matchCount: visibleMatchCount,
    };
  }

  /**
   * Get all players
   */
  async getAllPlayers(): Promise<PlayerResponse[]> {
    const players = await db.getAllAsync<PlayerRecord>('players', undefined, undefined);

    // Pre-compute distinct match counts for all players to avoid one query per
    // row when rendering the admin Players table.
    const matchRows = await db.queryAsync<{ player_id: string; count: number | string }>(
      'SELECT player_id, COUNT(DISTINCT match_slug) as count FROM player_match_stats GROUP BY player_id',
      []
    );
    const matchCountMap = new Map<string, number>(
      matchRows.map((row) => [row.player_id, Number(row.count ?? 0)])
    );

    return players.map((p) => {
      const base = this.toResponse(p);
      const visible = matchCountMap.get(p.id);
      return {
        ...base,
        matchCount: visible ?? base.matchCount,
      };
    });
  }

  /**
   * Get player by Steam ID
   */
  async getPlayerById(playerId: string): Promise<PlayerResponse | null> {
    const player = await db.queryOneAsync<PlayerRecord>('SELECT * FROM players WHERE id = ?', [playerId]);
    if (!player) {
      return null;
    }
    return this.toVisibleResponse(player);
  }

  /**
   * Create a new player
   * If no rating is provided, uses the OpenSkill default mapped to our Skill Rating scale.
   */
  async createPlayer(input: CreatePlayerInput): Promise<PlayerResponse> {
    const elo = input.elo !== undefined ? input.elo : 1500;
    const now = Math.floor(Date.now() / 1000);

    // Convert Skill Rating to OpenSkill rating
    const openskillRating = eloToOpenSkill(elo, 0); // New player, 0 matches

    const playerData: Omit<PlayerRecord, 'id'> & { is_admin?: number } = {
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

    if (typeof input.isAdmin === 'boolean') {
      playerData.is_admin = input.isAdmin ? 1 : 0;
    }

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

    const updates: Partial<PlayerRecord> & { is_admin?: number } = {
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

    if (input.isAdmin !== undefined) {
      updates.is_admin = input.isAdmin ? 1 : 0;
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

    // Create with specified Skill Rating or default 1500
    const playerElo = elo !== undefined ? elo : 1500;
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
   * Ensure that there is at least one admin player.
   *
   * Safety rules:
   * - Only the *first ever* player record may be auto‑promoted to admin.
   * - If any admin already exists, this is a no‑op.
   * - If more than one player exists in the table, we will NEVER auto‑promote
   *   anyone, even if no admin is currently set.
   */
  async ensureFirstAdmin(steamId: string): Promise<void> {
    const existingAdmin = await db.queryOneAsync<{ id: string }>(
      'SELECT id FROM players WHERE is_admin = 1 LIMIT 1',
      []
    );

    if (existingAdmin) {
      // An admin already exists – do not change anything automatically.
      return;
    }

    // Count total players to enforce "first ever user only" semantics.
    const countRow = await db.queryOneAsync<{ count: number | string }>(
      'SELECT COUNT(1) as count FROM players',
      []
    );
    const totalPlayers = Number(countRow?.count ?? 0);

    // If there are already multiple players, never auto‑promote anyone.
    if (totalPlayers > 1) {
      log.info(
        `Skipping auto‑admin promotion for ${steamId} because there are already ${totalPlayers} players`
      );
      return;
    }

    // If there is exactly one player, only promote when that record matches
    // the current Steam ID (true "first user" semantics).
    if (totalPlayers === 1) {
      const firstPlayer = await db.queryOneAsync<{ id: string }>(
        'SELECT id FROM players ORDER BY created_at ASC LIMIT 1',
        []
      );

      if (!firstPlayer || firstPlayer.id !== steamId) {
        log.info(
          `Skipping auto‑admin promotion for ${steamId} because first player record is ${firstPlayer?.id}`
        );
        return;
      }
    }

    await this.updatePlayer(steamId, { isAdmin: true });
    log.success(`Promoted first Steam user to admin: ${steamId}`);
  }

  /**
   * Returns true if there is at least one admin player in the system.
   */
  async hasAnyAdmin(): Promise<boolean> {
    const existingAdmin = await db.queryOneAsync<{ id: string }>(
      'SELECT id FROM players WHERE is_admin = 1 LIMIT 1',
      []
    );
    return Boolean(existingAdmin);
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
