/**
 * Player Service
 * Handles player CRUD operations and bulk import
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { eloToOpenSkill } from './ratingService';
import {
  abbreviateId,
  describePlayer,
  normalisePlayerDiscordIds,
  parseDiscordIdEdit,
  type ImportedDiscordId,
} from '../utils/discordId';

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
  /**
   * Discord user ID, admin-only contact data. Optional in the type because most
   * reads never select it; see `PlayerAdminResponse`.
   */
  discord_id?: string | null;
}

export interface CreatePlayerInput {
  id: string; // Steam ID
  name: string;
  avatar?: string;
  elo?: number; // Optional - defaults to 1500 Skill Rating (OpenSkill baseline)
  isAdmin?: boolean;
  /**
   * Raw, unvalidated: it comes straight from a request body. `createPlayer`
   * validates it (and throws `InvalidDiscordIdError`); `bulkImportPlayers`
   * applies the import rule instead.
   */
  discordId?: unknown;
}

export interface UpdatePlayerInput {
  name?: string;
  avatar?: string;
  elo?: number;
  isAdmin?: boolean;
  /** Raw, unvalidated. A string sets it, `null`/`""` clears it, absent leaves it. */
  discordId?: unknown;
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

/**
 * A player as an admin sees them: everything public plus the Discord ID.
 *
 * This is a separate type and a separate mapping on purpose. `toResponse` feeds
 * public endpoints (`/find`, `/:playerId/summary`, public `GET /:playerId`) by
 * spreading, so a field added there leaks everywhere at once. Some players are
 * children; their Discord ID must only come out of admin-guarded routes, and it
 * should take a deliberate call to `toAdminResponse` to put it anywhere.
 */
export interface PlayerAdminResponse extends PlayerResponse {
  discordId: string | null;
}

/** Thrown by explicit edits when `discordId` fails validation; routes map it to 400. */
export class InvalidDiscordIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDiscordIdError';
  }
}

/**
 * Remove `discord_id` from a raw row before it leaves the service.
 *
 * `SELECT *` rows are handed to callers that return them unmapped (admin
 * `GET /api/tournament/:id/players` via `getRegisteredPlayers`), and to code
 * that may be public tomorrow. Stripping here keeps the column opt-in.
 */
function withoutDiscordId<T extends { discord_id?: unknown }>(row: T): Omit<T, 'discord_id'> {
  const { discord_id: _discordId, ...rest } = row;
  return rest;
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

  private toAdminResponse(player: PlayerRecord): PlayerAdminResponse {
    return {
      ...this.toResponse(player),
      discordId: player.discord_id ? player.discord_id : null,
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
    return this.getAllPlayersMapped((p) => this.toResponse(p));
  }

  /**
   * Get all players with admin-only fields (Discord ID). Admin routes only.
   */
  async getAllPlayersForAdmin(): Promise<PlayerAdminResponse[]> {
    return this.getAllPlayersMapped((p) => this.toAdminResponse(p));
  }

  private async getAllPlayersMapped<R extends PlayerResponse>(
    map: (player: PlayerRecord) => R
  ): Promise<R[]> {
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
      const base = map(p);
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
   * Get player by Steam ID with admin-only fields (Discord ID). Admin routes only.
   */
  async getPlayerByIdForAdmin(playerId: string): Promise<PlayerAdminResponse | null> {
    const player = await db.queryOneAsync<PlayerRecord>('SELECT * FROM players WHERE id = ?', [playerId]);
    if (!player) {
      return null;
    }
    const visible = await this.toVisibleResponse(player);
    return { ...visible, discordId: player.discord_id ? player.discord_id : null };
  }

  /**
   * Every player whose Discord ID is exactly `discordId`, for the Discord bot.
   *
   * An array, never a single player: the column is deliberately not unique,
   * because a parent may put their own Discord ID on several children. An
   * equality lookup so `idx_players_discord_id` serves it. The caller validates
   * the ID first; an invalid one would simply match nothing.
   */
  async getPlayersByDiscordId(discordId: string): Promise<PlayerAdminResponse[]> {
    const players = await db.queryAsync<PlayerRecord>(
      'SELECT * FROM players WHERE discord_id = ? ORDER BY name',
      [discordId]
    );
    return Promise.all(
      players.map(async (p) => ({
        ...(await this.toVisibleResponse(p)),
        discordId: p.discord_id ? p.discord_id : null,
      }))
    );
  }

  /**
   * The stored Discord ID of one player: `undefined` when there is no such
   * player, `null` when they have none. Used by player self-service.
   */
  async getDiscordId(playerId: string): Promise<string | null | undefined> {
    const row = await db.queryOneAsync<{ discord_id: string | null }>(
      'SELECT discord_id FROM players WHERE id = ?',
      [playerId]
    );
    if (!row) return undefined;
    return row.discord_id ? row.discord_id : null;
  }

  /**
   * Discord IDs for a set of Steam IDs, in one query — used to enrich team
   * rosters for admins without a lookup per player.
   */
  async getDiscordIdsBySteamIds(steamIds: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(steamIds.filter((id) => typeof id === 'string' && id.length > 0))];
    const result = new Map<string, string | null>();
    if (unique.length === 0) return result;

    const placeholders = unique.map(() => '?').join(',');
    const rows = await db.queryAsync<{ id: string; discord_id: string | null }>(
      `SELECT id, discord_id FROM players WHERE id IN (${placeholders})`,
      unique
    );
    for (const row of rows) {
      result.set(row.id, row.discord_id ? row.discord_id : null);
    }
    return result;
  }

  /**
   * Apply Discord IDs that arrived with an IMPORT (team roster, bulk import).
   *
   * The import rule: an import only ever fills a blank. It never overwrites a
   * stored value and never clears one. Explicit edits — the admin form, and the
   * player's own self-service page — are the only way to change an ID once it is
   * set. Rosters are re-imported over and over from signup sheets that the
   * player (or a parent) may have filled in months ago; if the import won, the
   * correction a player made themselves would be quietly undone by the next
   * upload.
   *
   * - stored value empty → fill it;
   * - stored value equal → nothing to say;
   * - stored value different → keep it, and warn so the admin can check;
   * - no players row (its creation failed earlier) → skip; that failure was
   *   already logged by the caller.
   *
   * The fill is a conditional UPDATE, so a self-service edit racing the import
   * still wins. Never throws for a single player: a Discord ID must not fail an
   * import. Returns warnings for the caller to merge into its response.
   */
  async applyImportedDiscordIds(entries: ImportedDiscordId[]): Promise<string[]> {
    const warnings: string[] = [];
    if (entries.length === 0) return warnings;

    let stored: Map<string, string | null>;
    try {
      stored = await this.getDiscordIdsBySteamIds(entries.map((e) => e.steamId));
    } catch (error) {
      log.warn('Could not read stored Discord IDs; imported Discord IDs were not applied', { error });
      return [`Discord IDs from this import were not saved: ${(error as Error).message}`];
    }

    for (const entry of entries) {
      if (!stored.has(entry.steamId)) continue;
      const current = stored.get(entry.steamId) ?? null;

      if (current === entry.discordId) continue;

      if (current) {
        warnings.push(
          `${describePlayer(entry)}: has Discord ID ${abbreviateId(current)} on file; ` +
            `import had ${abbreviateId(entry.discordId)}, kept the existing one.`
        );
        continue;
      }

      try {
        const result = await db.runAsync(
          "UPDATE players SET discord_id = ?, updated_at = ? WHERE id = ? AND (discord_id IS NULL OR discord_id = '')",
          [entry.discordId, Math.floor(Date.now() / 1000), entry.steamId]
        );
        if (result.changes > 0) {
          // Fill so a later entry for the same player in this import (a player
          // on two teams of one upload) is compared against what we just wrote.
          stored.set(entry.steamId, entry.discordId);
          log.info(`Imported Discord ID ${abbreviateId(entry.discordId)} for player ${entry.steamId}`);
        } else {
          // Someone set it between our read and this write; theirs stands.
          const now = await this.getDiscordId(entry.steamId);
          if (now && now !== entry.discordId) {
            warnings.push(
              `${describePlayer(entry)}: has Discord ID ${abbreviateId(now)} on file; ` +
                `import had ${abbreviateId(entry.discordId)}, kept the existing one.`
            );
          }
          if (now !== undefined) stored.set(entry.steamId, now);
        }
      } catch (error) {
        log.warn(`Failed to save imported Discord ID for player ${entry.steamId}`, { error });
        warnings.push(`${describePlayer(entry)}: Discord ID could not be saved.`);
      }
    }

    return warnings;
  }

  /**
   * Create a new player
   * If no rating is provided, uses the OpenSkill default mapped to our Skill Rating scale.
   */
  async createPlayer(input: CreatePlayerInput): Promise<PlayerResponse> {
    // Validate before writing anything: an explicit edit with a bad Discord ID
    // is refused whole, not half-applied.
    const discordIdEdit = parseDiscordIdEdit(input.discordId);
    if (discordIdEdit.kind === 'invalid') {
      throw new InvalidDiscordIdError(discordIdEdit.error);
    }

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

    if (discordIdEdit.kind === 'set') {
      playerData.discord_id = discordIdEdit.value;
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
    const discordIdEdit = parseDiscordIdEdit(input.discordId);
    if (discordIdEdit.kind === 'invalid') {
      throw new InvalidDiscordIdError(discordIdEdit.error);
    }

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

    // An explicit edit overwrites, unlike an import (see applyImportedDiscordIds).
    if (discordIdEdit.kind === 'set') {
      updates.discord_id = discordIdEdit.value;
    } else if (discordIdEdit.kind === 'clear') {
      updates.discord_id = null;
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
    warnings: string[];
  }> {
    let created = 0;
    let updated = 0;
    const errors: Array<{ player: CreatePlayerInput; error: string }> = [];

    // An import, so Discord IDs follow the import rule rather than the edit
    // rule: pull them out here (bad ones become warnings, not errors) and apply
    // them once the rows exist. The inputs passed on carry no discordId, so
    // createPlayer's strict validation never fails a row over one.
    const normalised = normalisePlayerDiscordIds(
      players.map((p) => ({ ...p, steamId: p.id }))
    );
    const warnings = [...normalised.warnings];
    const succeeded = new Set<string>();

    for (const { steamId: _steamId, ...playerInput } of normalised.players) {
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
        succeeded.add(playerInput.id);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ player: playerInput, error: errorMessage });
        log.error(`Error importing player ${playerInput.id}`, { error: errorMessage });
      }
    }

    warnings.push(
      ...(await this.applyImportedDiscordIds(
        normalised.discordIds.filter((entry) => succeeded.has(entry.steamId))
      ))
    );

    log.success(
      `Bulk import complete: ${created} created, ${updated} updated, ${errors.length} errors`
    );
    return { created, updated, errors, warnings };
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
      return withoutDiscordId(existing);
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

    return withoutDiscordId(player);
  }

  /**
   * Get players by Steam IDs
   */
  async getPlayersByIds(steamIds: string[]): Promise<PlayerRecord[]> {
    // Returned unmapped by some callers, so the admin-only Discord ID is
    // stripped here rather than trusted to every caller (see withoutDiscordId).
    if (steamIds.length === 0) {
      return [];
    }

    const placeholders = steamIds.map(() => '?').join(',');
    const players = await db.queryAsync<PlayerRecord>(
      `SELECT * FROM players WHERE id IN (${placeholders})`,
      steamIds
    );

    return players.map(withoutDiscordId);
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
      log.debug('[ensureFirstAdmin] An admin already exists, skipping', {
        steamId,
        existingAdminId: existingAdmin.id,
      });
      return;
    }

    const countRow = await db.queryOneAsync<{ count: number | string }>(
      'SELECT COUNT(1) as count FROM players',
      []
    );
    const totalPlayers = Number(countRow?.count ?? 0);

    if (totalPlayers === 0) {
      log.info('[ensureFirstAdmin] No players in DB yet; cannot promote. Create player first.', {
        steamId,
      });
      return;
    }

    if (totalPlayers > 1) {
      log.info(
        '[ensureFirstAdmin] Skipping auto‑admin promotion: multiple players exist',
        { steamId, totalPlayers }
      );
      return;
    }

    const firstPlayer = await db.queryOneAsync<{ id: string }>(
      'SELECT id FROM players ORDER BY created_at ASC LIMIT 1',
      []
    );

    if (!firstPlayer || firstPlayer.id !== steamId) {
      log.info('[ensureFirstAdmin] Skipping: first player does not match current Steam ID', {
        steamId,
        firstPlayerId: firstPlayer?.id ?? null,
      });
      return;
    }

    await this.updatePlayer(steamId, { isAdmin: true });
    log.info('[ensureFirstAdmin] Promoted first Steam user to admin', { steamId });
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
