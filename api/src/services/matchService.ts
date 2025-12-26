import { db } from '../config/database';
import { Match, MatchConfig, CreateMatchInput, MatchResponse } from '../types/match.types';
import { log } from '../utils/logger';
import { settingsService } from './settingsService';
import { emitMatchUpdate } from './socketService';
import type { DbTournamentRow } from '../types/database.types';

class MatchService {
  /**
   * Create a new match configuration
   */
  async createMatch(input: CreateMatchInput, baseUrl: string): Promise<MatchResponse> {
    // Check if slug already exists
    const existing = await db.getOneAsync<Match>('matches', 'slug = ?', [input.slug]);
    if (existing) {
      throw new Error(`Match with slug '${input.slug}' already exists`);
    }

    // Validate server exists
    const server = await db.getOneAsync('servers', 'id = ?', [input.serverId]);
    if (!server) {
      throw new Error(`Server '${input.serverId}' not found`);
    }

    // Normalize config and apply global simulation + round-limit settings so
    // manual matches behave like tournament-generated matches.
    const config: MatchConfig = {
      ...input.config,
    };

    try {
      // Apply global simulation mode (development only, mirrors matchConfigBuilder behavior)
      const simulationEnabled = await settingsService.isSimulationModeEnabled();
      if (simulationEnabled) {
        const timescale = await settingsService.getSimulationTimescale();
        config.simulation = true;
        config.simulation_timescale = timescale;
      } else {
        // Explicitly clear simulation flags for manual matches when simulation mode is off.
        config.simulation = false;
        config.simulation_timescale = undefined;
      }

      // Respect a manually provided mp_maxrounds from the match config when present.
      const hasManualMaxRounds =
        typeof config.cvars?.mp_maxrounds === 'number' &&
        Number.isFinite(config.cvars.mp_maxrounds) &&
        config.cvars.mp_maxrounds > 0;

      // Apply mp_maxrounds based on the primary tournament's maxRounds only when
      // the manual match config did not already specify a value. This keeps the
      // manual match modal's "Max rounds" field authoritative while still
      // providing a sensible default that mirrors tournament-generated matches.
      if (!hasManualMaxRounds) {
        const tournament = await db.queryOneAsync<DbTournamentRow>(
          'SELECT * FROM tournament WHERE id = ?',
          [1]
        );
        if (tournament) {
          const raw = tournament.max_rounds;
          const parsed =
            typeof raw === 'number'
              ? raw
              : typeof raw === 'string' && raw.trim() !== ''
              ? Number(raw)
              : undefined;

          const maxRounds =
            typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : 24;

          config.cvars = {
            ...(config.cvars || {}),
            mp_maxrounds: maxRounds,
          };
        }
      }
    } catch (simError) {
      log.warn(
        'Failed to apply simulation / round-limit settings to manual match config',
        simError as Error
      );
    }

    // Insert match
    //
    // NOTE: Manual matches are intentionally **not** part of the tournament
    // bracket flow. We still persist them in the same `matches` table so that
    // existing tooling (match list, server status, etc.) can see them, but we
    // mark them with `round = 0` and `match_number = 0` to distinguish them
    // from bracket matches (which always use round >= 1).
    // Derive team IDs from config so manual matches can participate in veto
    // flow and use the same team lookup logic as bracket matches.
    const team1Id = config.team1?.id ?? null;
    const team2Id = config.team2?.id ?? null;

    await db.insertAsync('matches', {
      slug: input.slug,
      // Manual matches are **independent** of the primary tournament bracket.
      // We keep them in the same table for shared tooling, but do not associate
      // them with any tournament row.
      tournament_id: null,
      round: 0, // 0 = manual / non-bracket match
      match_number: 0,
      server_id: input.serverId,
      team1_id: team1Id,
      team2_id: team2Id,
      config: JSON.stringify(config),
      status: 'pending',
    });

    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [input.slug]);
    if (!match) {
      throw new Error('Failed to create match');
    }

    const response = this.toResponse(match, baseUrl);

    // Emit a websocket update so UIs (Matches page, player views, etc.) can
    // immediately reflect newly created manual matches without requiring a
    // full page refresh.
    try {
      emitMatchUpdate({
        id: response.id,
        slug: response.slug,
        status: response.status,
        serverId: response.serverId,
        config: response.config,
      });
    } catch (socketError) {
      log.warn('Failed to emit match update after manual match creation', socketError as Error);
    }

    log.matchCreated(input.slug, input.serverId);
    return response;
  }

  /**
   * Get match by slug
   */
  async getMatchBySlug(slug: string, baseUrl: string): Promise<MatchResponse | null> {
    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [slug]);
    return match ? this.toResponse(match, baseUrl) : null;
  }

  /**
   * Get match by ID
   */
  async getMatchById(id: number, baseUrl: string): Promise<MatchResponse | null> {
    const match = await db.getOneAsync<Match>('matches', 'id = ?', [id]);
    return match ? this.toResponse(match, baseUrl) : null;
  }

  /**
   * Get all matches
   */
  async getAllMatches(baseUrl: string, serverId?: string): Promise<MatchResponse[]> {
    let matches: Match[];
    if (serverId) {
      matches = await db.getAllAsync<Match>('matches', 'server_id = ?', [serverId]);
    } else {
      matches = await db.getAllAsync<Match>('matches');
    }
    return matches.map((m) => this.toResponse(m, baseUrl));
  }

  /**
   * Update match status
   */
  async updateMatchStatus(slug: string, status: 'pending' | 'loaded' | 'live' | 'completed'): Promise<void> {
    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [slug]);
    if (!match) {
      throw new Error(`Match '${slug}' not found`);
    }

    const updateData: Record<string, unknown> = { status };
    if (status === 'loaded') {
      updateData.loaded_at = Math.floor(Date.now() / 1000);
    }

    await db.updateAsync('matches', updateData, 'slug = ?', [slug]);
    log.matchStatusUpdate(slug, status);
  }

  /**
   * Delete match
   */
  async deleteMatch(slug: string): Promise<void> {
    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [slug]);
    if (!match) {
      throw new Error(`Match '${slug}' not found`);
    }
    await db.deleteAsync('matches', 'slug = ?', [slug]);
    log.success(`Match deleted: ${slug}`);
  }

  /**
   * Get match config (raw JSON for MatchZy)
   */
  async getMatchConfig(slug: string): Promise<MatchConfig | null> {
    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [slug]);
    if (!match) {
      return null;
    }
    return JSON.parse(match.config) as MatchConfig;
  }

  /**
   * Convert database match to response format
   */
  private toResponse(match: Match, baseUrl: string): MatchResponse {
    const config = JSON.parse(match.config) as MatchConfig;
    return {
      id: match.id,
      slug: match.slug,
      serverId: match.server_id,
      config,
      createdAt: match.created_at,
      loadedAt: match.loaded_at,
      status: match.status,
      configUrl: `${baseUrl}/api/matches/${match.slug}.json`,
    };
  }
}

export const matchService = new MatchService();
