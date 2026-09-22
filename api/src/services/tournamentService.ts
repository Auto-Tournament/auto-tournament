import { discardTournamentRatings } from './ratingService';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { getBracketGenerator } from './bracketGenerators';
import { validateTeamCount, calculateTotalRounds } from '../utils/tournamentHelpers';
import { normalizeTournamentSettings } from '../utils/tournamentRow';
import {
  buildMatchConfigFor,
  describeMatch,
  parseStoredMatchConfig,
  serializeMatchConfig,
} from '../utils/matchIntegration';
import { applyScoreFields, enrichMatch } from '../utils/matchEnrichment';
import { getMapResults } from './matchMapResultService';
import { matchLiveStatsService } from './matchLiveStatsService';
import { getSwissStandings, getSwissStandingEntries } from './swissProgressionService';
import { getRoundRobinStandings, getRoundRobinStandingEntries } from './roundRobinStandingsService';
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
   * Get a tournament by id. Callers resolve the id through utils/tournamentRow
   * (3.0 has a single row; 3.1 resolves it per request).
   */
  async getTournament(tournamentId: number): Promise<TournamentResponse | null> {
    const row = await db.queryOneAsync<TournamentRow>('SELECT * FROM tournament WHERE id = ?', [
      tournamentId,
    ]);
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
      winner:
        tournament.status === 'completed'
          ? await this.getTournamentWinner(tournament.id, tournament.type, teams)
          : null,
    };
  }

  /**
   * Champion of a completed tournament.
   *
   * - Single/double elimination: winner of the final (the grand final `gf`
   *   when present, otherwise the last winners-bracket round, skipping a
   *   third-place match fed by losers).
   * - Swiss: top of the Swiss standings (see utils/swissPairing).
   * - Round robin: top of the round robin standings (wins, head-to-head,
   *   round difference, rounds won, seed; see utils/roundRobinStandings).
   * - Shuffle: null (players, not teams, are ranked on the leaderboard).
   */
  async getTournamentWinner(
    tournamentId: number,
    type: string,
    teams: Array<{ id: string; name: string; tag?: string }>
  ): Promise<{ id: string; name: string; tag?: string } | null> {
    if (type === 'shuffle') return null;

    const rows = await db.queryAsync<DbMatchRow>(
      'SELECT id, slug, round, match_number, status, team1_id, team2_id, winner_id, team1_from_outcome, team2_from_outcome FROM matches WHERE tournament_id = ? AND round >= 1',
      [tournamentId]
    );
    if (rows.length === 0) return null;

    const teamById = new Map(teams.map((t) => [t.id, t]));
    const resolveTeam = async (teamId: string | null | undefined) => {
      if (!teamId) return null;
      const known = teamById.get(teamId);
      if (known) return known;
      const row = await db.queryOneAsync<DbTeamRow>('SELECT id, name, tag FROM teams WHERE id = ?', [
        teamId,
      ]);
      return row ? { id: row.id, name: row.name, tag: row.tag || undefined } : null;
    };

    if (type === 'single_elimination' || type === 'double_elimination') {
      const grandFinal = rows.find((r) => r.slug === 'gf');
      let final: DbMatchRow | undefined = grandFinal;
      if (!final) {
        const winnersBracket = rows.filter((r) => !r.slug.startsWith('lb-'));
        const maxRound = Math.max(...winnersBracket.map((r) => r.round));
        const candidates = winnersBracket
          .filter((r) => r.round === maxRound)
          .filter((r) => r.team1_from_outcome !== 'loser' && r.team2_from_outcome !== 'loser')
          .sort((a, b) => a.match_number - b.match_number);
        final = candidates[0];
      }
      if (!final || final.status !== 'completed') return null;
      return resolveTeam(final.winner_id);
    }

    // Swiss: top of the standings (wins, losses, Buchholz, round differential,
    // then seed), so there is always a champion once every round is played.
    if (type === 'swiss') {
      const [top] = await getSwissStandings(tournamentId);
      return top ? resolveTeam(top.teamId) : null;
    }

    // Round robin: top of the standings. The tiebreaks make the order strict,
    // so a finished round robin always has a champion (#225).
    if (type === 'round_robin') {
      if (!rows.some((r) => r.status === 'completed' && r.winner_id)) return null;
      const [top] = await getRoundRobinStandings(tournamentId);
      return top ? resolveTeam(top.teamId) : null;
    }

    return null;
  }

  /**
   * Create or replace the tournament
   */
  async createTournament(
    tournamentId: number,
    input: CreateTournamentInput
  ): Promise<TournamentResponse> {
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

    // `format` wins over any matchFormat inside settings: the two must agree.
    const tournamentSettings: TournamentSettings = normalizeTournamentSettings(
      { ...DEFAULT_SETTINGS, ...settings },
      format
    );

    const now = Math.floor(Date.now() / 1000);

    // Delete existing tournament (if any) - we only support one tournament at a time
    await db.runAsync('DELETE FROM tournament WHERE id = ?', [tournamentId]);

    // Insert new tournament
    await db.insertAsync('tournament', {
      id: tournamentId,
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
        await this.generateBracket(tournamentId);
        log.success('Bracket automatically generated');
      } catch (err) {
        log.error('Failed to auto-generate bracket', err);

        // Clean up: Delete the tournament since bracket generation failed
        await db.runAsync('DELETE FROM tournament WHERE id = ?', [tournamentId]);
        log.warn('Tournament deleted due to bracket generation failure');

        // Re-throw to prevent returning tournament in broken state
        throw new Error(
          `Bracket generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    } else {
      log.info('Shuffle tournament created - bracket generation skipped (not applicable)');
    }

    const created = await this.getTournament(tournamentId);
    if (!created) {
      throw new Error('Failed to create tournament');
    }

    return created;
  }

  /**
   * Update existing tournament
   */
  async updateTournament(
    tournamentId: number,
    input: UpdateTournamentInput
  ): Promise<TournamentResponse> {
    const existing = await this.getTournament(tournamentId);
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
    // settings.matchFormat mirrors `format`. Rewrite settings whenever either
    // changes, or an edited format leaves the old value behind in settings.
    if (settings || format) {
      const merged = normalizeTournamentSettings(
        { ...existing.settings, ...(settings ?? {}) },
        format || existing.format
      );
      updates.settings = JSON.stringify(merged);
    }
    if (typeof maxRounds === 'number') {
      updates.max_rounds = maxRounds;
    }
    if (overtimeMode) {
      updates.overtime_mode = overtimeMode;
    }
    // `null` is meaningful here (back to the MatchZy default), so only an
    // absent field leaves the stored value alone. Without this an existing
    // tournament could never be switched off "no draws (0)" again.
    if (overtimeSegments !== undefined) {
      updates.overtime_segments =
        typeof overtimeSegments === 'number' && Number.isFinite(overtimeSegments)
          ? overtimeSegments
          : null;
    }

    await db.updateAsync('tournament', updates, 'id = ?', [tournamentId]);

    log.debug('Tournament updated');

    // Auto-regenerate bracket if structural changes were made
    const needsRegeneration = type || teamIds || (maps && maps.length !== existing.maps.length);
    if (needsRegeneration) {
      try {
        await this.regenerateBracket(tournamentId, true);
        log.debug('Bracket regenerated after update');
      } catch (err) {
        log.error('Failed to regenerate bracket after update', err);
        // Revert changes to teams if bracket generation fails
        if (teamIds) {
          const oldTeamId = existing.teamIds;
          await db.updateAsync('tournament', { team_ids: JSON.stringify(oldTeamId) }, 'id = ?', [
            tournamentId,
          ]);
        }
      }
    }

    const updated = await this.getTournament(tournamentId);
    if (!updated) {
      throw new Error('Failed to retrieve updated tournament');
    }

    return updated;
  }

  /**
   * Delete tournament and all associated matches
   * Note: Server cleanup (ending matches) should be done by the caller before this
   */
  async deleteTournament(tournamentId: number): Promise<void> {
    // First, clear server_id from all matches to clean up references
    await db.runAsync('UPDATE matches SET server_id = NULL WHERE tournament_id = ?', [tournamentId]);
    log.debug('Cleared server references from matches');

    // Delete tournament (CASCADE will also delete matches and events)
    await db.runAsync('DELETE FROM tournament WHERE id = ?', [tournamentId]);
    log.debug('Tournament deleted from database');

    // Live stats are keyed by slug, and the next bracket reuses slugs (r1m1...):
    // without this a new r1m1 started with the old one's series score.
    matchLiveStatsService.clearAll();
  }

  /**
   * Generate bracket for the tournament
   */
  async generateBracket(tournamentId: number): Promise<BracketResponse> {
    const tournament = await this.getTournament(tournamentId);
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    if (tournament.status !== 'setup') {
      throw new Error('Cannot regenerate bracket after tournament has started');
    }

    // Delete existing matches
    await db.runAsync('DELETE FROM matches WHERE tournament_id = ?', [tournamentId]);

    let matches: BracketMatch[] = [];

    try {
      // Get the appropriate generator for this tournament type
      const generator = getBracketGenerator(tournament.type);

      // Reset state if available
      if (generator.reset) {
        generator.reset();
      }

      const result = await generator.generate(tournament);

      // The generator returns neutral slots. Each slot's game config comes
      // from the match's integration, built before the rows are inserted (the
      // slugs have no row yet, exactly as when the generators built them).
      const configs = await Promise.all(
        result.matches.map((slot) =>
          buildMatchConfigFor(
            {
              slug: slot.slug,
              round: slot.round,
              bracket: slot.bracket ?? null,
              team1Id: slot.team1Id,
              team2Id: slot.team2Id,
            },
            tournament
          )
        )
      );

      // Insert matches into database and track IDs for linking
      const slugToDbId: Map<string, number> = new Map();

      for (const [index, matchData] of result.matches.entries()) {
        const config = configs[index];
        const description = describeMatch({ config });
        const createdAt = Math.floor(Date.now() / 1000);
        const insertResult = await db.insertAsync('matches', {
          slug: matchData.slug,
          tournament_id: tournamentId,
          round: matchData.round,
          match_number: matchData.matchNum,
          bracket: matchData.bracket ?? null,
          team1_id: matchData.team1Id,
          team2_id: matchData.team2Id,
          winner_id: matchData.winnerId,
          server_id: null,
          config: serializeMatchConfig(config),
          status: matchData.status,
          next_match_id: null, // Will be set in a second pass
          created_at: createdAt,
          ...(matchData.completedAt ? { completed_at: matchData.completedAt } : {}),
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
                name: description.team1.name || 'TBD',
                tag: description.team1.tag || 'TBD',
              }
            : null,
          team2: matchData.team2Id
            ? {
                id: matchData.team2Id,
                name: description.team2.name || 'TBD',
                tag: description.team2.tag || 'TBD',
              }
            : null,
          winner: null,
          status: matchData.status,
          serverId: null,
          // Integration-owned config, forwarded as-is (client slots: PR 12).
          config: config as BracketMatch['config'],
          nextMatchId: null,
          createdAt,
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

      // Swiss always answered with the stored rows (scores and standings
      // enrichment included); keep that response.
      if (tournament.type === 'swiss') {
        matches = await this.getMatches(tournamentId);
      }

      // Keep tournament in 'setup' status - it will change to 'ready' when user starts it
      await db.updateAsync('tournament', { updated_at: Math.floor(Date.now() / 1000) }, 'id = ?', [
        tournamentId,
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
  async regenerateBracket(tournamentId: number, force: boolean = false): Promise<BracketResponse> {
    const tournament = await this.getTournament(tournamentId);
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
    const result = await this.generateBracket(tournamentId);

    log.success('Bracket regenerated successfully');
    return result;
  }

  /**
   * Reset tournament back to setup mode
   * Clears all matches and resets status
   */
  async resetTournament(tournamentId: number): Promise<TournamentResponse> {
    const tournament = await this.getTournament(tournamentId);
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    // Count matches before deletion for logging
    const matchCount = await db.queryOneAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?',
      [tournamentId]
    );

    // Reset means "play it again": roll ratings back and drop this run's
    // history before the matches go. (deleteTournament keeps both.)
    await discardTournamentRatings(tournamentId);

    // Delete all matches (this also clears all veto states stored in matches)
    await db.runAsync('DELETE FROM matches WHERE tournament_id = ?', [tournamentId]);

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
        [tournamentId]
      );

      log.success(
        `Shuffle tournament reset to setup mode. Deleted ${
          matchCount?.count || 0
        } match(es) and cleared shuffle teams (registrations preserved).`
      );

      const result = await this.getTournament(tournamentId);
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
      [tournamentId]
    );

    log.success(
      `Tournament reset to setup mode. Deleted ${
        matchCount?.count || 0
      } match(es) and cleared all veto states.`
    );

    // Regenerate bracket after reset
    try {
      await this.generateBracket(tournamentId);
      log.success('Bracket regenerated after tournament reset');
    } catch (err) {
      log.error('Failed to regenerate bracket after reset', err);
      throw new Error(
        `Tournament reset completed but bracket regeneration failed: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
    }

    const result = await this.getTournament(tournamentId);
    if (!result) throw new Error('Failed to retrieve tournament after reset');
    return result;
  }

  /**
   * Get bracket with all matches
   */
  async getBracket(tournamentId: number): Promise<BracketResponse | null> {
    const tournament = await this.getTournament(tournamentId);
    if (!tournament) return null;

    const matches = await this.getMatches(tournamentId);
    const totalRounds = calculateTotalRounds(tournament.teamIds.length, tournament.type);

    if (tournament.type === 'swiss') {
      const swissStandings = await getSwissStandingEntries(tournament.id);
      return { tournament, matches, totalRounds, swissStandings };
    }
    if (tournament.type === 'round_robin') {
      const roundRobinStandings = await getRoundRobinStandingEntries(tournament.id);
      return { tournament, matches, totalRounds, roundRobinStandings };
    }
    return { tournament, matches, totalRounds };
  }

  /**
   * Get all matches for the tournament
   */
  private async getMatches(tournamentId: number): Promise<BracketMatch[]> {
    const rows = await db.queryAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, match_number',
      [tournamentId]
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

      // Integration-owned config, forwarded as-is (client slots: PR 12).
      if (row.config) {
        match.config = parseStoredMatchConfig(row.config) as BracketMatch['config'];
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

      // Normalise score fields (series = maps won, map score = current map
      // rounds, headline team1Score/team2Score). Completed matches keep their
      // persisted series result; live stats are only consulted in progress.
      const mapResults = await getMapResults(row.slug);
      if (mapResults.length > 0) {
        match.mapResults = mapResults;
      }
      applyScoreFields(match, {
        status: row.status,
        mapResults,
        liveStats: row.status !== 'completed' ? matchLiveStatsService.getStats(row.slug) : null,
      });

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
      settings: normalizeTournamentSettings(JSON.parse(row.settings), row.format),
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
