import { db } from '../config/database';
import { Team, CreateTeamInput, UpdateTeamInput, TeamResponse, Player } from '../types/team.types';
import { log } from '../utils/logger';
import { steamService } from './steamService';
import { playerService } from './playerService';
import { normalisePlayerDiscordIds } from '../utils/discordId';

/** A roster player as an admin sees it: enriched from the players table. */
export type AdminTeamPlayer = Player & { discordId: string | null };
export type AdminTeamResponse = Omit<TeamResponse, 'players'> & { players: AdminTeamPlayer[] };

/** A team write plus anything the admin should be told about it. */
export interface TeamWriteResult {
  team: TeamResponse;
  warnings: string[];
}

class TeamService {
  /**
   * Convert database team to response format
   */
  private toResponse(team: Team): TeamResponse {
    return {
      id: team.id,
      name: team.name,
      tag: team.tag,
      discordRoleId: team.discord_role_id,
      players: JSON.parse(team.players) as Player[],
      createdAt: team.created_at,
      updatedAt: team.updated_at,
    };
  }

  /**
   * Get all teams
   */
  async getAllTeams(): Promise<TeamResponse[]> {
    const teams = await db.getAllAsync<Team>('teams');
    return teams.map((team) => this.toResponse(team));
  }

  /**
   * Get team by ID
   */
  async getTeamById(id: string): Promise<TeamResponse | null> {
    const team = await db.getOneAsync<Team>('teams', 'id = ?', [id]);
    return team ? this.toResponse(team) : null;
  }

  /**
   * Add each roster player's Discord ID, from the players table, for admins.
   *
   * The ID lives only in `players.discord_id`, never in `teams.players` JSON:
   * that JSON is read by public pages (team match page, match JSON), and a
   * field stored there would leak the moment any of them spread a player. So
   * `getAllTeams`/`getTeamById` stay free of it, and admin routes opt in here.
   * One query for every player of every team, not one per player.
   */
  async withPlayerDiscordIds(teams: TeamResponse[]): Promise<AdminTeamResponse[]> {
    const steamIds = teams.flatMap((team) => (team.players ?? []).map((p) => p.steamId));
    const discordIds = await playerService.getDiscordIdsBySteamIds(steamIds);
    return teams.map((team) => ({
      ...team,
      players: (team.players ?? []).map((player) => ({
        ...player,
        discordId: discordIds.get(player.steamId) ?? null,
      })),
    }));
  }

  /**
   * Validate that a team doesn't have duplicate Steam IDs
   */
  private validateNoDuplicatePlayers(players: Player[]): void {
    const steamIds = players.map((p) => p.steamId.toLowerCase());
    const uniqueSteamIds = new Set(steamIds);

    if (steamIds.length !== uniqueSteamIds.size) {
      throw new Error('Team cannot have duplicate Steam IDs');
    }
  }

  /**
   * Enrich players with Steam avatars
   * Fetches avatars for players that don't have one yet.
   *
   * When creating purely local/dev data (like the test teams created from the
   * Dev Tools page, which use IDs prefixed with "test-team-"), we explicitly
   * skip any Steam Web API calls and rely on the UI's generated avatars /
   * deterministic SVGs instead. This avoids network noise and failures when
   * running without a Steam API key.
   */
  private async enrichPlayersWithAvatars(
    players: Player[],
    options?: { skipSteamAvatar?: boolean }
  ): Promise<Player[]> {
    if (options?.skipSteamAvatar) {
      return players;
    }
    // Check if Steam API is available
    const isSteamAvailable = await steamService.isAvailable();
    if (!isSteamAvailable) {
      log.debug('Steam API not available, skipping avatar fetch');
      return players;
    }

    const AVATAR_FETCH_TIMEOUT = 5000; // 5 seconds

    // Enrich players with avatars in parallel
    const enrichedPlayers = await Promise.all(
      players.map(async (player) => {
        // If player already has an avatar, keep it
        if (player.avatar) {
          return player;
        }

        try {
          // Fetch player info from Steam API with timeout
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), AVATAR_FETCH_TIMEOUT)
          );
          const steamPlayer = await Promise.race([
            steamService.getPlayerInfo(player.steamId),
            timeoutPromise,
          ]);

          if (steamPlayer?.avatarUrl) {
            return {
              ...player,
              avatar: steamPlayer.avatarUrl,
            };
          }
        } catch (error) {
          log.warn(`Failed to fetch avatar for player ${player.steamId}`, { error });
        }

        // Return player as-is if avatar fetch failed
        return player;
      })
    );

    return enrichedPlayers;
  }

  /**
   * Create a new team
   */
  async createTeam(input: CreateTeamInput, upsert = false): Promise<TeamResponse> {
    return (await this.createTeamWithWarnings(input, upsert)).team;
  }

  /**
   * Create a team, returning warnings about the roster's Discord IDs.
   *
   * A team write is an IMPORT for Discord IDs: `players[].discordId` is split
   * off the roster (it is never stored in the team JSON) and applied to the
   * players table with the import rule — fill a blank, never overwrite, never
   * clear — only once the team write itself has succeeded, so a refused create
   * leaves no Discord IDs behind.
   */
  async createTeamWithWarnings(input: CreateTeamInput, upsert = false): Promise<TeamWriteResult> {
    // Validate team ID
    if (!input.id || input.id.trim() === '') {
      throw new Error('Team ID is required');
    }

    // Validate team name
    if (!input.name || input.name.trim() === '') {
      throw new Error('Team name is required');
    }

    // Validate players
    if (!input.players || input.players.length === 0) {
      throw new Error('At least one player is required');
    }

    // Validate no duplicate Steam IDs
    this.validateNoDuplicatePlayers(input.players);

    const { players: rosterPlayers, discordIds, warnings } = normalisePlayerDiscordIds(input.players);

    // Enrich players with avatars from Steam API.
    // For dev/test teams created via the Development tools (IDs prefixed with
    // "test-team-"), we skip Steam avatar lookups entirely and rely on the
    // frontend's generated avatars / SVG fallback instead.
    const enrichedPlayers = await this.enrichPlayersWithAvatars(rosterPlayers, {
      skipSteamAvatar: input.id.startsWith('test-team-'),
    });

    // Auto-create players in players table (for shuffle tournaments)
    for (const player of enrichedPlayers) {
      try {
        await playerService.getOrCreatePlayer(player.steamId, player.name, player.avatar, player.elo);
      } catch (error) {
        // Log but don't fail team creation if player creation fails
        log.warn(`Failed to create player ${player.steamId} in players table`, { error });
      }
    }

    // Check if team exists
    const existing = await this.getTeamById(input.id);
    if (existing) {
      if (upsert) {
        // enrichedPlayers carries no discordId any more, so the update applies
        // none; they are applied once, below, from this create's roster.
        const team = await this.updateTeam(input.id, {
          name: input.name,
          tag: input.tag,
          discordRoleId: input.discordRoleId,
          players: enrichedPlayers,
        });
        warnings.push(...(await playerService.applyImportedDiscordIds(discordIds)));
        return { team, warnings };
      }
      throw new Error(`Team with ID '${input.id}' already exists`);
    }

    // Create team
    await db.insertAsync('teams', {
      id: input.id,
      name: input.name,
      tag: input.tag || null,
      discord_role_id: input.discordRoleId || null,
      players: JSON.stringify(enrichedPlayers),
    });

    log.success(`Team created: ${input.name} (${input.id})`, {
      id: input.id,
      playerCount: input.players.length,
    });
    const result = await this.getTeamById(input.id);
    if (!result) throw new Error('Failed to retrieve created team');
    warnings.push(...(await playerService.applyImportedDiscordIds(discordIds)));
    return { team: result, warnings };
  }

  /**
   * Update a team
   */
  async updateTeam(id: string, input: UpdateTeamInput): Promise<TeamResponse> {
    return (await this.updateTeamWithWarnings(id, input)).team;
  }

  /**
   * Update a team, returning warnings about the roster's Discord IDs. Same
   * import rule as `createTeamWithWarnings`.
   */
  async updateTeamWithWarnings(id: string, input: UpdateTeamInput): Promise<TeamWriteResult> {
    const existing = await this.getTeamById(id);
    if (!existing) {
      throw new Error(`Team with ID '${id}' not found`);
    }

    // Validate players if provided
    if (input.players && input.players.length > 0) {
      this.validateNoDuplicatePlayers(input.players);
    }

    const updateData: Record<string, unknown> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.tag !== undefined) updateData.tag = input.tag || null;
    if (input.discordRoleId !== undefined) updateData.discord_role_id = input.discordRoleId || null;
    const normalised = normalisePlayerDiscordIds(input.players ?? []);
    const warnings = [...normalised.warnings];

    if (input.players !== undefined) {
      // Enrich players with avatars from Steam API. For test/dev teams created
      // from the Dev Tools page (IDs starting with "test-team-"), skip Steam
      // lookups so local development and CI don't depend on the Steam Web API.
      const enrichedPlayers = await this.enrichPlayersWithAvatars(normalised.players, {
        skipSteamAvatar: id.startsWith('test-team-'),
      });
      
      // Auto-create players in players table (for shuffle tournaments)
      for (const player of enrichedPlayers) {
        try {
          await playerService.getOrCreatePlayer(player.steamId, player.name, player.avatar);
        } catch (error) {
          // Log but don't fail team update if player creation fails
          log.warn(`Failed to create player ${player.steamId} in players table`, { error });
        }
      }
      
      updateData.players = JSON.stringify(enrichedPlayers);
    }

    await db.updateAsync('teams', updateData, 'id = ?', [id]);

    log.success(`Team updated: ${input.name || existing.name} (${id})`, { id });
    const result = await this.getTeamById(id);
    if (!result) throw new Error('Failed to retrieve updated team');
    warnings.push(...(await playerService.applyImportedDiscordIds(normalised.discordIds)));
    return { team: result, warnings };
  }

  /**
   * Delete a team
   */
  async deleteTeam(id: string): Promise<void> {
    const existing = await this.getTeamById(id);
    if (!existing) {
      throw new Error(`Team with ID '${id}' not found`);
    }

    await db.deleteAsync('teams', 'id = ?', [id]);
    log.success(`Team deleted: ${existing.name} (${id})`, { id });
  }

  /**
   * Create multiple teams at once
   */
  async createTeams(
    inputs: CreateTeamInput[],
    upsert = false
  ): Promise<{
    successful: TeamResponse[];
    failed: { id: string; error: string }[];
    warnings: string[];
  }> {
    const successful: TeamResponse[] = [];
    const failed: { id: string; error: string }[] = [];
    const warnings: string[] = [];

    for (const input of inputs) {
      try {
        const { team, warnings: teamWarnings } = await this.createTeamWithWarnings(input, upsert);
        successful.push(team);
        // Prefixed: in a batch, a player's name alone does not say which team.
        warnings.push(...teamWarnings.map((w) => `Team '${input.id}': ${w}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ id: input.id, error: message });
        log.error(`Failed to create team ${input.id}`, error);
      }
    }

    return { successful, failed, warnings };
  }

  /**
   * Batch update teams
   */
  async updateTeams(updates: { id: string; updates: UpdateTeamInput }[]): Promise<{
    successful: TeamResponse[];
    failed: { id: string; error: string }[];
    warnings: string[];
  }> {
    const successful: TeamResponse[] = [];
    const failed: { id: string; error: string }[] = [];
    const warnings: string[] = [];

    for (const item of updates) {
      try {
        const { team, warnings: teamWarnings } = await this.updateTeamWithWarnings(
          item.id,
          item.updates
        );
        successful.push(team);
        warnings.push(...teamWarnings.map((w) => `Team '${item.id}': ${w}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ id: item.id, error: message });
        log.error(`Failed to update team ${item.id}`, error);
      }
    }

    return { successful, failed, warnings };
  }
}

export const teamService = new TeamService();
