import { db } from '../config/database';
import { Team, CreateTeamInput, UpdateTeamInput, TeamResponse, Player } from '../types/team.types';
import { log } from '../utils/logger';

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
   * Validate that a team doesn't have duplicate Steam IDs
   */
  private validateNoDuplicatePlayers(players: Player[]): void {
    const steamIds = players.map(p => p.steamId.toLowerCase());
    const uniqueSteamIds = new Set(steamIds);
    
    if (steamIds.length !== uniqueSteamIds.size) {
      throw new Error('Team cannot have duplicate Steam IDs');
    }
  }

  /**
   * Create a new team
   */
  async createTeam(input: CreateTeamInput, upsert = false): Promise<TeamResponse> {
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

    // Check if team exists
    const existing = await this.getTeamById(input.id);
    if (existing) {
      if (upsert) {
        return await this.updateTeam(input.id, {
          name: input.name,
          tag: input.tag,
          discordRoleId: input.discordRoleId,
          players: input.players,
        });
      }
      throw new Error(`Team with ID '${input.id}' already exists`);
    }

    // Create team
    await db.insertAsync('teams', {
      id: input.id,
      name: input.name,
      tag: input.tag || null,
      discord_role_id: input.discordRoleId || null,
      players: JSON.stringify(input.players),
    });

    log.success(`Team created: ${input.name} (${input.id})`, {
      id: input.id,
      playerCount: input.players.length,
    });
    const result = await this.getTeamById(input.id);
    if (!result) throw new Error('Failed to retrieve created team');
    return result;
  }

  /**
   * Update a team
   */
  async updateTeam(id: string, input: UpdateTeamInput): Promise<TeamResponse> {
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
    if (input.players !== undefined) updateData.players = JSON.stringify(input.players);

    await db.updateAsync('teams', updateData, 'id = ?', [id]);

    log.success(`Team updated: ${input.name || existing.name} (${id})`, { id });
    const result = await this.getTeamById(id);
    if (!result) throw new Error('Failed to retrieve updated team');
    return result;
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
  ): Promise<{ successful: TeamResponse[]; failed: { id: string; error: string }[] }> {
    const successful: TeamResponse[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const input of inputs) {
      try {
        const team = await this.createTeam(input, upsert);
        successful.push(team);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ id: input.id, error: message });
        log.error(`Failed to create team ${input.id}`, error);
      }
    }

    return { successful, failed };
  }

  /**
   * Batch update teams
   */
  async updateTeams(updates: { id: string; updates: UpdateTeamInput }[]): Promise<{
    successful: TeamResponse[];
    failed: { id: string; error: string }[];
  }> {
    const successful: TeamResponse[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const item of updates) {
      try {
        const team = await this.updateTeam(item.id, item.updates);
        successful.push(team);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ id: item.id, error: message });
        log.error(`Failed to update team ${item.id}`, error);
      }
    }

    return { successful, failed };
  }
}

export const teamService = new TeamService();
