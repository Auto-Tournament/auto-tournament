import { db } from '../config/database';
import { log } from '../utils/logger';
import { getBracketGenerator } from './bracketGenerators';
import { validateTeamCount, calculateTotalRounds } from '../utils/tournamentHelpers';
import { enrichMatch } from '../utils/matchEnrichment';
import { matchLiveStatsService } from './matchLiveStatsService';
import type { DbMatchRow, DbTeamRow } from '../types/database.types';
import type {
  Tournament,
  TournamentRow,
  TournamentResponse,
  CreateTournamentInput,
  UpdateTournamentInput,
  TournamentSettings,
  BracketMatch,
  BracketResponse,
} from '../types/tournament.types';

export const DEFAULT_SETTINGS: TournamentSettings = {
  matchFormat: 'bo3',
  thirdPlaceMatch: false,
  autoAdvance: true,
  checkInRequired: false,
  seedingMethod: 'random',
  grandFinalMode: 'simple',
};

class TournamentService {
  /**
   * Get the current tournament (only one tournament exists at a time)
   */
  async getTournament(): Promise<TournamentResponse | null> {
    const row = await db.queryOneAsync<TournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!row) return null;

    const tournament = this.rowToTournament(row);
    const teams = await this.getTeamsForTournament(tournament.team_ids);

    log.debug('getTournament normalized tournament', {
      id: tournament.id,
      type: tournament.type,
      format: tournament.format,
      status: tournament.status,
      mapSequence: tournament.mapSequence,
      teamSize: tournament.teamSize,
      maxRounds: tournament.maxRounds,
      overtimeMode: tournament.overtimeMode,
      overtimeSegments: tournament.overtimeSegments,
      eloTemplateId: tournament.eloTemplateId,
    });

    return {
      id: tournament.id,
      name: tournament.name,
      type: tournament.type,
      format: tournament.format,
      status: tournament.status,
      maps: tournament.maps,
      teamIds: tournament.team_ids,
      settings: tournament.settings,
      // Shuffle tournament specific fields (only populated for type === 'shuffle')
      mapSequence: tournament.mapSequence,
      teamSize: tournament.teamSize,
      maxRounds: tournament.maxRounds,
      overtimeMode: tournament.overtimeMode,
      overtimeSegments: tournament.overtimeSegments,
      eloTemplateId: tournament.eloTemplateId || undefined,
      created_at: tournament.created_at,
      updated_at: tournament.updated_at,
      started_at: tournament.started_at,
      completed_at: tournament.completed_at,
      teams,
    };
  }

  /**
   * Create or replace the tournament
   */
  async createTournament(input: CreateTournamentInput): Promise<TournamentResponse> {
    const {
      name,
      type,
      format,
      maps,
      teamIds,
      settings,
      maxRounds,
      overtimeMode,
      overtimeSegments,
    } = input;

    // Shuffle tournaments don't use teams, skip validation
    if (type !== 'shuffle') {
      // Validate team count based on tournament type
      validateTeamCount(type, teamIds.length);
    }

    const tournamentSettings: TournamentSettings = {
      ...DEFAULT_SETTINGS,
      matchFormat: format,
      ...settings,
    };

    const now = Math.floor(Date.now() / 1000);

    // Delete existing tournament (if any) - we only support one tournament at a time
    await db.execAsync('DELETE FROM tournament WHERE id = 1');

    // Insert new tournament
    await db.insertAsync('tournament', {
      id: 1,
      name,
      type,
      format,
      status: 'setup',
      maps: JSON.stringify(maps),
      team_ids: JSON.stringify(teamIds || []), // Shuffle tournaments have no fixed teams
      settings: JSON.stringify(tournamentSettings),
      max_rounds: maxRounds ?? 24,
      overtime_mode: overtimeMode ?? 'enabled',
      // Keep semantics aligned with shuffle and manual matches:
      // - NULL → MatchZy default (unlimited OT / draws)
      // - 0 with overtimeMode === 'disabled' → "no OT, no draws" (damage tiebreak)
      // - >0 with overtimeMode === 'enabled' → OT with damage tiebreak after N segments
      overtime_segments:
        typeof overtimeSegments === 'number' && Number.isFinite(overtimeSegments)
          ? overtimeSegments
          : null,
      created_at: now,
      updated_at: now,
    });

    log.success(`Tournament created: ${name} (${type})`);

    // Shuffle tournaments don't use bracket generation
    if (type !== 'shuffle') {
      // Auto-generate bracket
      try {
        await this.generateBracket();
        log.success('Bracket automatically generated');
      } catch (err) {
        log.error('Failed to auto-generate bracket', err);

        // Clean up: Delete the tournament since bracket generation failed
        await db.execAsync('DELETE FROM tournament WHERE id = 1');
        log.warn('Tournament deleted due to bracket generation failure');

        // Re-throw to prevent returning tournament in broken state
        throw new Error(
          `Bracket generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    } else {
      log.info('Shuffle tournament created - bracket generation skipped (not applicable)');
    }

    const created = await this.getTournament();
    if (!created) {
      throw new Error('Failed to create tournament');
    }

    return created;
  }

  /**
   * Update existing tournament
   */
  async updateTournament(input: UpdateTournamentInput): Promise<TournamentResponse> {
    const existing = await this.getTournament();
    if (!existing) {
      throw new Error('No tournament exists to update');
    }

    const { name, type, format, maps, teamIds, settings, maxRounds, overtimeMode, overtimeSegments } =
      input;

    // Validate team count if changing teams or type
    if (type || teamIds) {
      validateTeamCount(type || existing.type, (teamIds || existing.teamIds).length);
    }

    const updates: Partial<TournamentRow> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (name) updates.name = name;
    if (type) updates.type = type;
    if (format) updates.format = format;
    if (maps) updates.maps = JSON.stringify(maps);
    if (teamIds) updates.team_ids = JSON.stringify(teamIds);
    if (settings) {
      const merged = { ...existing.settings, ...settings };
      updates.settings = JSON.stringify(merged);
    }
    if (typeof maxRounds === 'number') {
      updates.max_rounds = maxRounds;
    }
    if (overtimeMode) {
      updates.overtime_mode = overtimeMode;
    }
    if (typeof overtimeSegments === 'number') {
      updates.overtime_segments = overtimeSegments;
    }

    await db.updateAsync('tournament', updates, 'id = ?', [1]);

    log.debug('Tournament updated');

    // Auto-regenerate bracket if structural changes were made
    const needsRegeneration = type || teamIds || (maps && maps.length !== existing.maps.length);
    if (needsRegeneration) {
      try {
        await this.regenerateBracket(true);
        log.debug('Bracket regenerated after update');
      } catch (err) {
        log.error('Failed to regenerate bracket after update', err);
        // Revert changes to teams if bracket generation fails
        if (teamIds) {
          const oldTeamId = existing.teamIds;
          await db.updateAsync('tournament', { team_ids: JSON.stringify(oldTeamId) }, 'id = ?', [
            1,
          ]);
        }
      }
    }

    const updated = await this.getTournament();
    if (!updated) {
      throw new Error('Failed to retrieve updated tournament');
    }

    return updated;
  }

  /**
   * Delete tournament and all associated matches
   * Note: Server cleanup (ending matches) should be done by the caller before this
   */
  async deleteTournament(): Promise<void> {
    // First, clear server_id from all matches to clean up references
    await db.execAsync('UPDATE matches SET server_id = NULL WHERE tournament_id = 1');
    log.debug('Cleared server references from matches');

    // Delete tournament (CASCADE will also delete matches and events)
    await db.execAsync('DELETE FROM tournament WHERE id = 1');
    log.debug('Tournament deleted from database');
  }

  /**
   * Generate bracket for the tournament
   */
  async generateBracket(): Promise<BracketResponse> {
    const tournament = await this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    if (tournament.status !== 'setup') {
      throw new Error('Cannot regenerate bracket after tournament has started');
    }

    // Delete existing matches
    await db.execAsync('DELETE FROM matches WHERE tournament_id = 1');

    let matches: BracketMatch[] = [];

    try {
      // Get the appropriate generator for this tournament type
      const generator = getBracketGenerator(tournament.type);

      // Reset state if available
      if (generator.reset) {
        generator.reset();
      }

      const result = await generator.generate(tournament, () => this.getMatches());

      // Handle different result types (Swiss returns BracketMatch[], others return BracketGeneratorResult)
      if (Array.isArray(result)) {
        // Swiss generator returns BracketMatch[] directly (already in DB)
        matches = result;
      } else {
        // Standard generators return BracketGeneratorResult (needs DB insertion)

        // Insert matches into database and track IDs for linking
        const slugToDbId: Map<string, number> = new Map();

        for (const matchData of result.matches) {
          const config = JSON.parse(matchData.config);
          const insertResult = await db.insertAsync('matches', {
            slug: matchData.slug,
            tournament_id: 1,
            round: matchData.round,
            match_number: matchData.matchNum,
            bracket: matchData.bracket ?? null,
            team1_id: matchData.team1Id,
            team2_id: matchData.team2Id,
            winner_id: matchData.winnerId,
            server_id: null,
            config: matchData.config,
            status: matchData.status,
            next_match_id: null, // Will be set in a second pass
            created_at: Math.floor(Date.now() / 1000),
          });

          slugToDbId.set(matchData.slug, insertResult.lastInsertRowid as number);

          matches.push({
            id: insertResult.lastInsertRowid as number,
            slug: matchData.slug,
            round: matchData.round,
            matchNumber: matchData.matchNum,
            // Bracket grouping is currently inferred from slug in the client,
            // so we don't need to expose it explicitly here yet.
            team1: matchData.team1Id
              ? {
                  id: matchData.team1Id,
                  name: config.team1?.name || 'TBD',
                  tag: config.team1?.tag || 'TBD',
                }
              : null,
            team2: matchData.team2Id
              ? {
                  id: matchData.team2Id,
                  name: config.team2?.name || 'TBD',
                  tag: config.team2?.tag || 'TBD',
                }
              : null,
            winner: null,
            status: matchData.status,
            serverId: null,
            config,
            nextMatchId: null,
            createdAt: Math.floor(Date.now() / 1000),
          });
        }

        // Link matches (set next_match_id based on bracket structure)
        await this.linkMatches(matches, slugToDbId, tournament.type);

        // Apply declarative slot wiring (team*_from_match_id / outcome)
        // using the slugs produced by the generator. This makes runtime
        // progression size-agnostic and independent of any slug heuristics.
        for (const matchData of result.matches) {
          const dbId = slugToDbId.get(matchData.slug);
          if (!dbId) continue;

          const updates: Partial<DbMatchRow> = {};

          if (matchData.team1FromMatchSlug) {
            const fromId = slugToDbId.get(matchData.team1FromMatchSlug) ?? null;
            updates.team1_from_match_id = fromId;
            updates.team1_from_outcome = matchData.team1FromOutcome ?? null;
          }

          if (matchData.team2FromMatchSlug) {
            const fromId = slugToDbId.get(matchData.team2FromMatchSlug) ?? null;
            updates.team2_from_match_id = fromId;
            updates.team2_from_outcome = matchData.team2FromOutcome ?? null;
          }

          if (Object.keys(updates).length > 0) {
            await db.updateAsync('matches', updates as Record<string, unknown>, 'id = ?', [
              dbId,
            ]);
          }
        }
      }

      // Keep tournament in 'setup' status - it will change to 'ready' when user starts it
      await db.updateAsync('tournament', { updated_at: Math.floor(Date.now() / 1000) }, 'id = ?', [
        1,
      ]);

      log.debug(`Bracket generated: ${matches.length} matches created`);

      const totalRounds = calculateTotalRounds(tournament.teamIds.length, tournament.type);
      return { tournament, matches, totalRounds };
    } catch (err) {
      log.error('Failed to generate bracket', err);
      throw err;
    }
  }

  /**
   * Explicitly regenerate brackets (DESTRUCTIVE - wipes all match data)
   * Should only be called with user confirmation
   */
  async regenerateBracket(force: boolean = false): Promise<BracketResponse> {
    const tournament = await this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    // Safety check: prevent regeneration of live/completed tournaments unless forced
    if (!force && tournament.status !== 'setup') {
      throw new Error(
        'Cannot regenerate bracket for a live or completed tournament. ' +
          'Use force=true to override (this will delete all match data).'
      );
    }

    log.warn('Regenerating bracket - all existing match data will be deleted');

    // Generate new bracket (this also sets status to 'ready')
    const result = await this.generateBracket();

    log.success('Bracket regenerated successfully');
    return result;
  }

  /**
   * Reset tournament back to setup mode
   * Clears all matches and resets status
   */
  async resetTournament(): Promise<TournamentResponse> {
    const tournament = await this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    // Count matches before deletion for logging
    const matchCount = await db.queryOneAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = 1'
    );

    // Delete all matches (this also clears all veto states stored in matches)
    await db.execAsync('DELETE FROM matches WHERE tournament_id = 1');

    // Also clear any in-memory live stats so new brackets don't inherit stale scores
    matchLiveStatsService.clearAll();

    // Shuffle tournaments have their own dynamic match/round generation and
    // temporary teams. Resetting should NOT attempt to regenerate a static bracket.
    if (tournament.type === 'shuffle') {
      // Clean up shuffle-specific state. We intentionally KEEP registrations in
      // shuffle_tournament_players so admins don't lose their selected player
      // pool when resetting back to setup.
      await db.execAsync("DELETE FROM teams WHERE id LIKE 'shuffle-r%'");

      await db.updateAsync(
        'tournament',
        {
          status: 'setup',
          updated_at: Math.floor(Date.now() / 1000),
          started_at: null,
          completed_at: null,
        },
        'id = ?',
        [1]
      );

      log.success(
        `Shuffle tournament reset to setup mode. Deleted ${
          matchCount?.count || 0
        } match(es) and cleared shuffle teams (registrations preserved).`
      );

      const result = await this.getTournament();
      if (!result) throw new Error('Failed to retrieve tournament after reset');
      return result;
    }

    // Non-shuffle tournaments: reset and regenerate bracket as before
    await db.updateAsync(
      'tournament',
      {
        status: 'setup',
        updated_at: Math.floor(Date.now() / 1000),
        started_at: null,
        completed_at: null,
      },
      'id = ?',
      [1]
    );

    log.success(
      `Tournament reset to setup mode. Deleted ${
        matchCount?.count || 0
      } match(es) and cleared all veto states.`
    );

    // Regenerate bracket after reset
    try {
      await this.generateBracket();
      log.success('Bracket regenerated after tournament reset');
    } catch (err) {
      log.error('Failed to regenerate bracket after reset', err);
      throw new Error(
        `Tournament reset completed but bracket regeneration failed: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
    }

    const result = await this.getTournament();
    if (!result) throw new Error('Failed to retrieve tournament after reset');
    return result;
  }

  /**
   * Get bracket with all matches
   */
  async getBracket(): Promise<BracketResponse | null> {
    const tournament = await this.getTournament();
    if (!tournament) return null;

    const matches = await this.getMatches();
    const totalRounds = calculateTotalRounds(tournament.teamIds.length, tournament.type);

    return { tournament, matches, totalRounds };
  }

  /**
   * Get all matches for the tournament
   */
  private async getMatches(): Promise<BracketMatch[]> {
    const rows = await db.queryAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE tournament_id = 1 ORDER BY round, match_number'
    );

    const matches: BracketMatch[] = [];

    for (const row of rows) {
      const match: BracketMatch = {
        id: row.id,
        slug: row.slug,
        round: row.round,
        matchNumber: row.match_number,
        serverId: row.server_id,
        status: row.status,
        nextMatchId: row.next_match_id,
        createdAt: row.created_at,
        loadedAt: row.loaded_at,
        completedAt: row.completed_at,
      };

      // Parse config for additional details
      if (row.config) {
        try {
          match.config = JSON.parse(row.config);
        } catch {
          // Ignore parse errors
        }
      }

      // Attach team info if available
      if (row.team1_id) {
        const team1 = await db.queryOneAsync<DbTeamRow>(
          'SELECT id, name, tag FROM teams WHERE id = ?',
          [row.team1_id]
        );
        if (team1) match.team1 = { id: team1.id, name: team1.name, tag: team1.tag || undefined };
      }
      if (row.team2_id) {
        const team2 = await db.queryOneAsync<DbTeamRow>(
          'SELECT id, name, tag FROM teams WHERE id = ?',
          [row.team2_id]
        );
        if (team2) match.team2 = { id: team2.id, name: team2.name, tag: team2.tag || undefined };
      }
      if (row.winner_id) {
        const winner = await db.queryOneAsync<DbTeamRow>(
          'SELECT id, name, tag FROM teams WHERE id = ?',
          [row.winner_id]
        );
        if (winner)
          match.winner = { id: winner.id, name: winner.name, tag: winner.tag || undefined };
      }

      // Enrich match with player stats and scores from persisted events
      await enrichMatch(match, row.slug);

      // For matches that are still in progress, optionally overlay in‑memory live
      // stats so the bracket reflects the most recent score. For multi‑map
      // series we prefer the live **series** score when it is positive
      // (e.g. 1–0 in a BO3). For BO1 / early maps where seriesScore is still 0,
      // we instead surface the current **map rounds** (e.g. 8–5) so the UI
      // doesn't get stuck showing 0–0 until the final result is known.
      //
      // For completed matches we ALWAYS trust persisted results and DO NOT let
      // transient live stats overwrite the final series score (e.g. 2–1).
      if (row.status !== 'completed') {
        const liveStats = matchLiveStatsService.getStats(row.slug);
        if (liveStats) {
          // Prefer positive series scores; otherwise fall back to current map rounds.
          const liveTeam1 =
            typeof liveStats.team1SeriesScore === 'number' && liveStats.team1SeriesScore > 0
              ? liveStats.team1SeriesScore
              : liveStats.team1Score;
          const liveTeam2 =
            typeof liveStats.team2SeriesScore === 'number' && liveStats.team2SeriesScore > 0
              ? liveStats.team2SeriesScore
              : liveStats.team2Score;

          if (typeof liveTeam1 === 'number' && Number.isFinite(liveTeam1)) {
            match.team1Score = liveTeam1;
          }
          if (typeof liveTeam2 === 'number' && Number.isFinite(liveTeam2)) {
            match.team2Score = liveTeam2;
          }
        }
      }

      matches.push(match);
    }
    return matches;
  }

  /**
   * Link matches by setting next_match_id for progression
   */
  private async linkMatches(
    matches: BracketMatch[],
    slugToDbId: Map<string, number>,
    tournamentType: string
  ): Promise<void> {
    // Link winners‑bracket matches (both single and double elimination)
    if (tournamentType === 'single_elimination' || tournamentType === 'double_elimination') {
      const winnersMatches = matches.filter((m) => !m.slug.startsWith('lb-') && m.slug !== 'gf');
      if (winnersMatches.length > 0) {
        const maxRound = Math.max(...winnersMatches.map((m) => m.round));

        for (const match of winnersMatches) {
          let nextMatchSlug: string | null = null;

          // Winners‑bracket progression:
          //
          //   Match N in round R → match ceil(N/2) in round R+1
          //
          // For double elimination we stop at the winners‑bracket final; linking
          // that (and the losers‑bracket final) into the grand final is handled
          // in a separate pass below.
          if (match.round < maxRound) {
            const nextMatchNum = Math.ceil(match.matchNumber / 2);
            nextMatchSlug = `r${match.round + 1}m${nextMatchNum}`;
          }

          if (nextMatchSlug) {
            const nextMatchId = slugToDbId.get(nextMatchSlug);
            if (nextMatchId) {
              await db.updateAsync('matches', { next_match_id: nextMatchId }, 'id = ?', [match.id]);
              match.nextMatchId = nextMatchId;
            }
          }
        }
      }

      if (tournamentType === 'double_elimination') {
        // Link losers‑bracket *winners* within the losers bracket itself based
        // purely on the generated bracket shape. We do *not* hard‑code team
        // counts; instead we look at how many lb‑rounds and matches per round
        // brackets‑manager produced:
        //
        //   - When successive losers rounds have the same match count
        //       (e.g. 2 → 2), winners map 1:1 by matchNumber.
        //   - When the next round has fewer matches
        //       (e.g. 2 → 1, 4 → 2), we compress by grouping:
        //         factor = currentCount / nextCount
        //         nextMatchNumber = ceil(currentMatchNumber / factor)
        //
        // This matches the standard double‑elimination structure where some
        // losers rounds "fan in" multiple prior matches.
        const lbMatches = matches.filter((m) => m.slug.startsWith('lb-'));
        if (lbMatches.length > 0) {
          const lbRounds = Array.from(new Set(lbMatches.map((m) => m.round))).sort((a, b) => a - b);

          for (let i = 0; i < lbRounds.length - 1; i++) {
            const currentRound = lbRounds[i];
            const nextRound = lbRounds[i + 1];

            const currentRoundMatches = lbMatches
              .filter((m) => m.round === currentRound)
              .sort((a, b) => a.matchNumber - b.matchNumber);
            const nextRoundMatches = lbMatches
              .filter((m) => m.round === nextRound)
              .sort((a, b) => a.matchNumber - b.matchNumber);

            const currentCount = currentRoundMatches.length;
            const nextCount = nextRoundMatches.length;

            if (nextCount === 0 || currentCount === 0) {
              continue;
            }

            for (const m of currentRoundMatches) {
              let targetMatchNumber: number | null = null;

              if (currentCount === nextCount) {
                // 1:1 mapping by match number
                targetMatchNumber = m.matchNumber;
              } else if (currentCount > nextCount && currentCount % nextCount === 0) {
                const factor = currentCount / nextCount;
                targetMatchNumber = Math.ceil(m.matchNumber / factor);
              } else {
                // Unexpected shape – skip linking for this transition but keep others.
                log.warn('Skipping losers bracket linking due to unexpected round sizes', {
                  currentRound,
                  nextRound,
                  currentCount,
                  nextCount,
                });
                continue;
              }

              const target = nextRoundMatches.find((nm) => nm.matchNumber === targetMatchNumber);
              if (!target) continue;

              const nextMatchId = slugToDbId.get(target.slug);
              if (!nextMatchId) continue;

              await db.updateAsync('matches', { next_match_id: nextMatchId }, 'id = ?', [m.id]);
              m.nextMatchId = nextMatchId;
            }
          }

          // Finally, wire the winners‑bracket final and losers‑bracket final into
          // the grand final (slug `gf`) when present. We treat both as parents
          // of the same terminal match.
          const grandFinalId = slugToDbId.get('gf');
          if (grandFinalId) {
            const lastWinnersRound = Math.max(...winnersMatches.map((m) => m.round));
            const winnersFinal = winnersMatches.find(
              (m) => m.round === lastWinnersRound && !m.slug.startsWith('lb-')
            );

            const lastLosersRound = Math.max(...lbMatches.map((m) => m.round));
            const losersFinal = lbMatches.find((m) => m.round === lastLosersRound);

            const finals = [winnersFinal, losersFinal].filter(
              (m): m is BracketMatch => Boolean(m)
            );

            for (const parent of finals) {
              await db.updateAsync(
                'matches',
                { next_match_id: grandFinalId },
                'id = ?',
                [parent.id]
              );
              parent.nextMatchId = grandFinalId;
            }
          }
        }
      }
    } else if (tournamentType === 'round_robin') {
      // Round robin doesn't have progression (all matches are independent)
      return;
    }
  }

  /**
   * Get teams for tournament
   */
  private async getTeamsForTournament(
    teamIds: string[]
  ): Promise<Array<{ id: string; name: string; tag?: string }>> {
    if (teamIds.length === 0) return [];

    const placeholders = teamIds.map(() => '?').join(',');
    const teams = await db.queryAsync<DbTeamRow>(
      `SELECT id, name, tag FROM teams WHERE id IN (${placeholders})`,
      teamIds
    );

    return teams as Array<{ id: string; name: string; tag?: string }>;
  }

  /**
   * Convert database row to Tournament object
   */
  private rowToTournament(row: TournamentRow): Tournament {
    log.debug('rowToTournament raw row', {
      id: row.id,
      type: row.type,
      format: row.format,
      status: row.status,
      map_sequence: row.map_sequence,
      team_size: row.team_size,
      max_rounds: row.max_rounds,
      overtime_mode: row.overtime_mode,
      overtime_segments: row.overtime_segments,
      elo_template_id: row.elo_template_id,
    });

    return {
      ...row,
      maps: JSON.parse(row.maps),
      team_ids: JSON.parse(row.team_ids),
      settings: JSON.parse(row.settings),
      // Normalize shuffle-specific fields
      mapSequence: row.map_sequence ? JSON.parse(row.map_sequence) : undefined,
      teamSize: row.team_size === null || row.team_size === undefined ? undefined : row.team_size,
      maxRounds:
        row.max_rounds === null || row.max_rounds === undefined ? undefined : row.max_rounds,
      overtimeMode: (row.overtime_mode as 'enabled' | 'disabled' | null) || undefined,
      overtimeSegments:
        row.overtime_segments === null || row.overtime_segments === undefined
          ? undefined
          : row.overtime_segments,
      eloTemplateId: row.elo_template_id ?? null,
    };
  }
}

export const tournamentService = new TournamentService();
