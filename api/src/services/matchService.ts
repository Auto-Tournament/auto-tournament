import { db } from '../config/database';
import { Match, MatchConfig, CreateMatchInput, MatchResponse } from '../types/match.types';
import { log } from '../utils/logger';
import { emitMatchUpdate } from './socketService';
import { matchAllocationService } from './matchAllocationService';
import { serverAllocationTracker } from './serverAllocationTracker';
import {
  buildMatchConfigFor,
  describeMatch,
  parseStoredMatchConfig,
  serializeMatchConfig,
} from '../utils/matchIntegration';
import { tournamentRowToResponse } from '../utils/tournamentRow';
import type { DbTournamentRow } from '../types/database.types';

class MatchService {
  /**
   * Create a new match configuration
   */
  /**
   * @param defaultsTournamentId tournament whose rules (e.g. the round limit)
   *   fill in what the admin left out of a manual match.
   */
  async createMatch(
    input: CreateMatchInput,
    baseUrl: string,
    defaultsTournamentId: number
  ): Promise<MatchResponse> {
    // Check if slug already exists
    const existing = await db.getOneAsync<Match>('matches', 'slug = ?', [input.slug]);
    if (existing) {
      throw new Error(`Match with slug '${input.slug}' already exists`);
    }

    // Manual matches no longer support explicit server selection – the backend
    // is responsible for auto‑allocating an appropriate server. We intentionally
    // ignore any serverId passed in the payload to avoid double‑booking or
    // pinning matches to a single server.

    // Manual matches borrow the primary tournament's rules (e.g. the round
    // limit) for anything the admin left out.
    const tournament = await db
      .queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
        defaultsTournamentId,
      ])
      .catch((error: unknown) => {
        log.warn('Failed to read round-limit defaults for manual match', error as Error);
        return null;
      });

    // The integration builds the stored config from the admin's settings
    // (for CS2: simulation, round limit, default MatchZy Enhanced cvars and
    // admins, so manual matches behave like tournament-generated matches).
    const config = await buildMatchConfigFor(
      {
        slug: input.slug,
        round: 0,
        team1Id: input.config.team1?.id ?? null,
        team2Id: input.config.team2?.id ?? null,
      },
      null,
      input.config,
      { defaultsFrom: tournament ? tournamentRowToResponse(tournament) : null }
    );
    const description = describeMatch({ config });

    // Insert match
    //
    // NOTE: Manual matches are intentionally **not** part of the tournament
    // bracket flow. We still persist them in the same `matches` table so that
    // existing tooling (match list, server status, etc.) can see them, but we
    // mark them with `round = 0` and `match_number = 0` to distinguish them
    // from bracket matches (which always use round >= 1).
    // Derive team IDs from config so manual matches can participate in veto
    // flow and use the same team lookup logic as bracket matches.
    const team1Id = description.team1.id ?? null;
    const team2Id = description.team2.id ?? null;

    // Determine initial status based on whether veto is enabled
    // If veto is enabled (vetoDisabled === false), start as 'pending' to allow veto flow
    // Otherwise, start as 'ready' for immediate allocation
    const vetoEnabled = description.skipPreMatchPhase === false;
    const initialStatus = vetoEnabled ? 'pending' : 'ready';

    await db.insertAsync('matches', {
      slug: input.slug,
      // Manual matches are **independent** of the primary tournament bracket.
      // We keep them in the same table for shared tooling, but do not associate
      // them with any tournament row.
      tournament_id: null,
      round: 0, // 0 = manual / non-bracket match
      match_number: 0,
      // Always start manual matches without a server; the allocator will attach
      // a concrete server_id once it has picked a free server.
      server_id: null,
      team1_id: team1Id,
      team2_id: team2Id,
      config: serializeMatchConfig(config),
      // If veto is enabled, start as 'pending' to allow teams to complete veto.
      // Otherwise, start as 'ready' for immediate server allocation.
      status: initialStatus,
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

    log.matchCreated(input.slug, input.serverId ?? '<auto>');
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
    if (status === 'completed' && match.status !== 'completed') {
      // An admin completing a match is a deliberate finish. Stamping
      // completed_at is what marks it finalized (isMatchFinalized), so late
      // plugin events don't re-open it.
      updateData.completed_at = Math.floor(Date.now() / 1000);
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

    const serverId = match.server_id;
    await db.deleteAsync('matches', 'slug = ?', [slug]);
    log.success(`Match deleted: ${slug}`);

    // If the deleted match had a server assigned, mark that server as idle
    // and trigger immediate allocation for any waiting matches.
    if (serverId) {
      serverAllocationTracker.markIdle(serverId);
      log.info(`Server ${serverId} freed by match deletion, triggering immediate allocation`);
      setImmediate(() => {
        void matchAllocationService.tryImmediateAllocation();
      });
    }
  }

  /**
   * Get match config (raw JSON for MatchZy)
   */
  async getMatchConfig(slug: string): Promise<MatchConfig | null> {
    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [slug]);
    if (!match) {
      return null;
    }
    // Integration-owned blob, returned as stored.
    return parseStoredMatchConfig(match.config) as unknown as MatchConfig;
  }

  /**
   * Convert database match to response format
   */
  private toResponse(match: Match, baseUrl: string): MatchResponse {
    // Integration-owned blob, forwarded as stored (client slots: PR 12).
    const config = parseStoredMatchConfig(match.config) as unknown as MatchConfig;
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
