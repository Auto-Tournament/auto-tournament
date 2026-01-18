/**
 * Match Progression Utilities
 * Handles tournament bracket progression logic
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitBracketUpdate } from '../services/socketService';
import { matchAllocationService } from '../services/matchAllocationService';
import { generateMatchConfig } from '../services/matchConfigBuilder';
import type { DbMatchRow, DbTeamRow, DbTournamentRow } from '../types/database.types';
import type { TournamentResponse } from '../types/tournament.types';
import { settingsService } from '../services/settingsService';
import { autoCompleteVetoForMatch } from '../services/vetoSimulationService';

/**
 * Advance winner to next match in bracket
 */
export async function advanceWinnerToNextMatch(
  currentMatch: DbMatchRow,
  winnerId: string
): Promise<void> {
  try {
    // Resolve the next match in the bracket. Prefer the explicit next_match_id
    // when present, but gracefully fall back to inferring the destination from
    // the winners‑bracket slug pattern for legacy brackets that were generated
    // before we started populating next_match_id for double elimination.
    let nextMatch: DbMatchRow | null = null;

    if (currentMatch.next_match_id) {
      nextMatch =
        (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
          currentMatch.next_match_id,
        ])) ?? null;
    } else {
      const tournament = await db.queryOneAsync<DbTournamentRow>(
        'SELECT * FROM tournament WHERE id = 1'
      );

      // Only infer progression for traditional bracket types.
      if (
        tournament &&
        (tournament.type === 'single_elimination' || tournament.type === 'double_elimination')
      ) {
        // Winners bracket matches use slugs like "r1m1", "r2m3", etc. Losers
        // bracket and grand final use "lb-..." / "gf" and are NOT handled here.
        const wbSlugMatch = currentMatch.slug.match(/^r(\d+)m(\d+)$/);

        if (wbSlugMatch) {
          const wbRound = parseInt(wbSlugMatch[1], 10);
          const wbMatchNum = parseInt(wbSlugMatch[2], 10);

          const maxRoundRow = await db.queryOneAsync<{ max_round: number }>(
            `SELECT MAX(round) as max_round 
             FROM matches 
             WHERE tournament_id = 1 
               AND slug NOT LIKE 'lb-%'`,
            []
          );

          if (maxRoundRow && typeof maxRoundRow.max_round === 'number') {
            const maxRound = maxRoundRow.max_round;
            if (wbRound < maxRound) {
              const nextMatchNum = Math.ceil(wbMatchNum / 2);
              const inferredSlug = `r${wbRound + 1}m${nextMatchNum}`;

              const inferred = await db.queryOneAsync<DbMatchRow>(
                'SELECT * FROM matches WHERE slug = ?',
                [inferredSlug]
              );

              if (inferred) {
                nextMatch = inferred;
                // Self-heal the missing link so future calls can use next_match_id directly.
                await db.updateAsync(
                  'matches',
                  { next_match_id: inferred.id },
                  'id = ?',
                  [currentMatch.id]
                );
                currentMatch.next_match_id = inferred.id;
                log.debug('Backfilled next_match_id for winners bracket match', {
                  slug: currentMatch.slug,
                  inferredSlug,
                  nextMatchId: inferred.id,
                });
              } else {
                log.warn('Could not infer next winners-bracket match by slug', {
                  slug: currentMatch.slug,
                  inferredSlug,
                });
              }
            }
          }
        }
      }
    }

    if (!nextMatch) {
      log.warn('Next match not found', { nextMatchId: currentMatch.next_match_id });
      return;
    }

    // Defensive guard: avoid advancing the same winner twice into the same next match.
    // This can happen if we receive both a plugin 'series_end' event and a synthetic
    // series_end generated from map_end for the same match.
    if (nextMatch.team1_id === winnerId || nextMatch.team2_id === winnerId) {
      log.warn('Winner already advanced to next match, skipping duplicate advance', {
        nextMatchSlug: nextMatch.slug,
        winnerId,
      });
      return;
    }

    // Determine which slot to fill (team1 or team2)
    if (!nextMatch.team1_id) {
      await db.updateAsync('matches', { team1_id: winnerId }, 'id = ?', [nextMatch.id]);
      log.debug(`Advanced ${winnerId} to ${nextMatch.slug} as team1`);
    } else if (!nextMatch.team2_id) {
      await db.updateAsync('matches', { team2_id: winnerId }, 'id = ?', [nextMatch.id]);
      log.debug(`Advanced ${winnerId} to ${nextMatch.slug} as team2`);
    } else {
      log.warn('Next match already has both teams assigned', { nextMatchSlug: nextMatch.slug });
      return;
    }

    // Check if both teams are now assigned
    const updatedNextMatch = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      nextMatch.id,
    ]);

    if (updatedNextMatch && updatedNextMatch.team1_id && updatedNextMatch.team2_id) {
      await makeMatchReady(updatedNextMatch);
    }
  } catch (error) {
    log.error('Error advancing winner to next match', error);
  }
}

/**
 * Advance loser to losers bracket (for double elimination)
 */
export async function advanceLoserToLosersBracket(
  currentMatch: DbMatchRow,
  _winnerId: string
): Promise<void> {
  try {
    // Only for winners bracket matches
    if (!currentMatch.slug.startsWith('wb-') && !currentMatch.slug.startsWith('r')) {
      return;
    }

    const tournament = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!tournament || tournament.type !== 'double_elimination') {
      return;
    }

    // Always derive winner/loser from the latest persisted match row instead
    // of trusting the winnerId argument directly. This makes losers‑bracket
    // progression robust against any inconsistencies in upstream events or
    // synthetic series_end payloads.
    const freshMatch = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      currentMatch.id,
    ]);

    if (!freshMatch) {
      log.warn('Cannot advance loser: match not found when refreshing from DB', {
        matchId: currentMatch.id,
      });
      return;
    }

    const winnerTeamId = freshMatch.winner_id;
    if (!winnerTeamId) {
      log.warn('Cannot advance loser: winner_id is null on completed match', {
        matchSlug: freshMatch.slug,
      });
      return;
    }

    let loserId: string | null = null;
    if (freshMatch.team1_id === winnerTeamId) {
      loserId = freshMatch.team2_id ?? null;
    } else if (freshMatch.team2_id === winnerTeamId) {
      loserId = freshMatch.team1_id ?? null;
    } else {
      log.warn('Cannot advance loser: winner_id does not match either team', {
        matchSlug: freshMatch.slug,
        winnerTeamId,
        team1_id: freshMatch.team1_id,
        team2_id: freshMatch.team2_id,
      });
      return;
    }

    if (!loserId) {
      log.warn('Could not determine loser', { matchSlug: currentMatch.slug });
      return;
    }

    // Find the losers bracket destination
    const lbMatch = await findLosersBracketMatch(freshMatch);
    if (!lbMatch) {
      return;
    }

  // Defensive guard: avoid advancing the same loser twice into the same losers
  // bracket match. This can happen if we receive both a plugin 'series_end'
  // event and a synthetic series_end generated from map_end for the same
  // winners‑bracket match.
  if (lbMatch.team1_id === loserId || lbMatch.team2_id === loserId) {
    log.warn('Loser already advanced to losers bracket match, skipping duplicate advance', {
      lbSlug: lbMatch.slug,
      winnerSlug: currentMatch.slug,
      loserId,
    });
    return;
  }

    // Assign loser to losers bracket
    if (!lbMatch.team1_id) {
      await db.updateAsync('matches', { team1_id: loserId }, 'id = ?', [lbMatch.id]);
      log.debug(`Advanced loser ${loserId} to ${lbMatch.slug} as team1`);
    } else if (!lbMatch.team2_id) {
      await db.updateAsync('matches', { team2_id: loserId }, 'id = ?', [lbMatch.id]);
      log.debug(`Advanced loser ${loserId} to ${lbMatch.slug} as team2`);
    } else {
      log.warn('Losers bracket match already full', { lbSlug: lbMatch.slug });
      return;
    }

    // Check if losers bracket match is now ready
    const updatedLbMatch = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      lbMatch.id,
    ]);

    if (updatedLbMatch && updatedLbMatch.team1_id && updatedLbMatch.team2_id) {
      await makeMatchReady(updatedLbMatch);
    }
  } catch (error) {
    log.error('Error advancing loser to losers bracket', error);
  }
}

/**
 * Generic slot-based progression.
 *
 * For any completed match, look for downstream matches that declare this match
 * as a source in team1_from_match_id / team2_from_match_id and populate the
 * corresponding team slots based on the expected outcome ('winner' | 'loser').
 *
 * This completely avoids any reliance on slug / round heuristics and works
 * for arbitrary double-elimination sizes as long as the bracket was generated
 * with explicit wiring.
 */
export async function propagateMatchBySlotSources(matchId: number): Promise<void> {
  try {
    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      matchId,
    ]);
    if (!match) {
      log.warn('Cannot propagate by slot sources: match not found', { matchId });
      return;
    }

    const winnerId = match.winner_id ?? null;
    if (!winnerId) {
      // Drawn or manual matches are not expected to participate in wired
      // progression; log and bail out gracefully.
      log.debug('Skipping slot-based propagation for match without winner_id', {
        matchId,
        slug: match.slug,
      });
      return;
    }

    let loserId: string | null = null;
    if (match.team1_id && match.team2_id) {
      if (match.team1_id === winnerId) {
        loserId = match.team2_id ?? null;
      } else if (match.team2_id === winnerId) {
        loserId = match.team1_id ?? null;
      }
    }

    const children = await db.queryAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE tournament_id = ? AND (team1_from_match_id = ? OR team2_from_match_id = ?)',
      [match.tournament_id ?? 1, matchId, matchId]
    );

    if (!children.length) {
      return;
    }

    for (const child of children) {
      const updates: Partial<DbMatchRow> = {};

      if (child.team1_from_match_id === matchId) {
        const outcome = (child.team1_from_outcome ?? null) as 'winner' | 'loser' | null;
        const targetId = outcome === 'winner' ? winnerId : outcome === 'loser' ? loserId : null;

        if (targetId && child.team1_id !== targetId) {
          if (child.team1_id && child.team1_id !== targetId) {
            log.warn('Overwriting existing team1_id during slot propagation', {
              childSlug: child.slug,
              previous: child.team1_id,
              next: targetId,
            });
          }
          updates.team1_id = targetId;
        }
      }

      if (child.team2_from_match_id === matchId) {
        const outcome = (child.team2_from_outcome ?? null) as 'winner' | 'loser' | null;
        const targetId = outcome === 'winner' ? winnerId : outcome === 'loser' ? loserId : null;

        if (targetId && child.team2_id !== targetId) {
          if (child.team2_id && child.team2_id !== targetId) {
            log.warn('Overwriting existing team2_id during slot propagation', {
              childSlug: child.slug,
              previous: child.team2_id,
              next: targetId,
            });
          }
          updates.team2_id = targetId;
        }
      }

      if (Object.keys(updates).length === 0) {
        continue;
      }

      await db.updateAsync('matches', updates as Record<string, unknown>, 'id = ?', [child.id]);

      const refreshed = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
        child.id,
      ]);

      if (refreshed && refreshed.status === 'pending' && refreshed.team1_id && refreshed.team2_id) {
        await makeMatchReady(refreshed);
      }
    }
  } catch (error) {
    log.error('Error propagating match via slot sources', error, { matchId });
  }
}

/**
 * Check if tournament is completed
 * For bracket tournaments (single/double elimination, round robin, swiss), all matches
 * are generated upfront. If all matches are completed, the tournament is complete.
 * For shuffle tournaments, matches are generated dynamically per round, so completion
 * is handled separately in shuffleTournamentService.
 */
export async function checkTournamentCompletion(tournamentId: number = 1): Promise<void> {
  try {
    log.info(`[TOURNAMENT] Starting completion check for tournament ${tournamentId}`);
    
    const tournament = await db.queryOneAsync<DbTournamentRow>(
      'SELECT * FROM tournament WHERE id = ?',
      [tournamentId]
    );
    
    if (!tournament) {
      log.info(`[TOURNAMENT] Tournament ${tournamentId} not found`);
      return;
    }
    
    if (tournament.status === 'completed') {
      log.info(`[TOURNAMENT] Tournament ${tournamentId} already completed, skipping check`);
      return;
    }

    log.info(`[TOURNAMENT] Tournament ${tournamentId} status: ${tournament.status}, type: ${tournament.type}`);

    // Skip shuffle tournaments - they handle completion in shuffleTournamentService
    if (tournament.type === 'shuffle') {
      log.info(`[TOURNAMENT] Skipping shuffle tournament ${tournamentId} (handled separately)`);
      return;
    }

    // Count all matches for this tournament (bracket matches have round >= 1)
    const totalMatches = await db.queryOneAsync<{ count: number | string }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = ? AND round >= 1',
      [tournamentId]
    );

    // Count non-completed matches
    const pendingMatches = await db.queryOneAsync<{ count: number | string }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = ? AND round >= 1 AND status != ?',
      [tournamentId, 'completed']
    );

    // Get detailed match status breakdown for debugging
    const matchStatusBreakdown = await db.queryAsync<{ status: string; count: number | string }>(
      `SELECT status, COUNT(*) as count 
       FROM matches 
       WHERE tournament_id = ? AND round >= 1 
       GROUP BY status`,
      [tournamentId]
    );

    // Convert counts to numbers (PostgreSQL may return strings)
    const totalMatchesCount = Number(totalMatches?.count ?? 0);
    const pendingMatchesCount = Number(pendingMatches?.count ?? 0);

    const statusBreakdown = matchStatusBreakdown.reduce((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {} as Record<string, number>);

    log.info(`[TOURNAMENT] Completion check for tournament ${tournamentId}:`, {
      totalBracketMatches: totalMatchesCount,
      pendingMatches: pendingMatchesCount,
      statusBreakdown,
    });

    // Tournament is complete if:
    // 1. There is at least one bracket match (tournament bracket was generated)
    // 2. All bracket matches are completed
    if (totalMatchesCount > 0 && pendingMatchesCount === 0) {
      log.info(`[TOURNAMENT] All ${totalMatchesCount} bracket match(es) completed. Marking tournament ${tournamentId} as completed.`);
      
      await db.updateAsync(
        'tournament',
        {
          status: 'completed',
          completed_at: Math.floor(Date.now() / 1000),
        },
        'id = ?',
        [tournamentId]
      );

      // Verify the update
      const updated = await db.queryOneAsync<{ status: string; completed_at: number | null }>(
        'SELECT status, completed_at FROM tournament WHERE id = ?',
        [tournamentId]
      );
      
      log.success(`[TOURNAMENT] Tournament ${tournamentId} marked as completed! Status: ${updated?.status}, completed_at: ${updated?.completed_at}`);
      emitBracketUpdate({ action: 'tournament_completed' });
    } else {
      log.info(`[TOURNAMENT] Tournament ${tournamentId} not complete yet:`, {
        hasMatches: totalMatchesCount > 0,
        allCompleted: pendingMatchesCount === 0,
        reason: totalMatchesCount === 0 
          ? 'No bracket matches found' 
          : `Still ${pendingMatchesCount} pending match(es)`,
      });
    }
  } catch (error) {
    log.error('Error checking tournament completion', error, { tournamentId });
  }
}

/**
 * Make a match ready by generating config and auto-allocating server
 */
async function makeMatchReady(match: DbMatchRow): Promise<void> {
  try {
    // Get tournament data
    const tournament = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!tournament) {
      log.error('Tournament not found');
      return;
    }

    // In simulation mode, for BO formats that use veto, delegate to the
    // automated veto simulator instead of directly marking the match as ready.
    // This ensures that *all* rounds (r1, r2, etc.) go through the same
    // auto-veto + auto-load flow once both teams are known.
    const simulationEnabled = await settingsService.isSimulationModeEnabled();
    const usesVeto =
      tournament.format === 'bo1' || tournament.format === 'bo3' || tournament.format === 'bo5';
    if (simulationEnabled && usesVeto) {
      log.info(
        `[VETO-SIM] Simulation mode active – auto-completing veto for newly ready match ${match.slug}`
      );
      await autoCompleteVetoForMatch(match.slug);
      return;
    }

    // Build tournament response object for config generation
    const tournamentData: TournamentResponse = {
      id: tournament.id,
      name: tournament.name,
      type: tournament.type as TournamentResponse['type'],
      format: tournament.format as TournamentResponse['format'],
      status: tournament.status as TournamentResponse['status'],
      maps: JSON.parse(tournament.maps),
      teamIds: JSON.parse(tournament.team_ids),
      settings: tournament.settings ? JSON.parse(tournament.settings) : {},
      created_at: tournament.created_at,
      updated_at: tournament.updated_at ?? tournament.created_at,
      started_at: tournament.started_at,
      completed_at: tournament.completed_at,
      teams: [],
      mapSequence: tournament.map_sequence ? JSON.parse(tournament.map_sequence) : undefined,
      teamSize:
        tournament.team_size === null || typeof tournament.team_size === 'undefined'
          ? undefined
          : tournament.team_size,
      maxRounds:
        tournament.max_rounds === null || typeof tournament.max_rounds === 'undefined'
          ? undefined
          : tournament.max_rounds,
      overtimeMode: (tournament.overtime_mode as 'enabled' | 'disabled' | null) || undefined,
      overtimeSegments:
        tournament.overtime_segments === null ||
        typeof tournament.overtime_segments === 'undefined'
          ? undefined
          : tournament.overtime_segments,
      eloTemplateId: tournament.elo_template_id ?? undefined,
    };

    // Generate match config using the service
    const config = await generateMatchConfig(
      tournamentData,
      match.team1_id ?? undefined,
      match.team2_id ?? undefined,
      match.slug
    );

    // Update match with config and ready status
    await db.updateAsync('matches', { config: JSON.stringify(config), status: 'ready' }, 'id = ?', [match.id]);

    // Get team names for logging
    const team1 = await db.queryOneAsync<DbTeamRow>('SELECT name FROM teams WHERE id = ?', [match.team1_id]);
    const team2 = await db.queryOneAsync<DbTeamRow>('SELECT name FROM teams WHERE id = ?', [match.team2_id]);

    log.success(
      `Match ${match.slug} is now ready: ${team1?.name || 'TBD'} vs ${team2?.name || 'TBD'}`
    );

    emitBracketUpdate({ action: 'match_ready', matchSlug: match.slug });

    // Auto-allocate server to this ready match
    await autoAllocateServerToMatch(match.slug);
  } catch (error) {
    log.error('Error making match ready', error, { matchSlug: match.slug });
  }
}

/**
 * Reconcile progression for a standard 8‑team double‑elimination bracket.
 *
 * This function inspects the current state of all matches and ensures that
 * winners and losers are wired into the correct downstream matches based on
 * fixed slug conventions:
 *
 * Winners bracket:
 *   r1m1 → r2m1 (team1)
 *   r1m2 → r2m1 (team2)
 *   r1m3 → r2m2 (team1)
 *   r1m4 → r2m2 (team2)
 *   r2m1 → r3m1 (team1)
 *   r2m2 → r3m1 (team2)
 *
 * Losers bracket:
 *   L(r1m1) → lb-r4m1 (team1)
 *   L(r1m2) → lb-r4m1 (team2)
 *   L(r1m3) → lb-r4m2 (team1)
   *   L(r1m4) → lb-r4m2 (team2)
 *   lb-r4m1 winner vs L(r2m1) → lb-r5m1
 *   lb-r4m2 winner vs L(r2m2) → lb-r5m2
 *   lb-r5m1 winner vs lb-r5m2 winner → lb-r6m1
 *   lb-r6m1 winner vs L(r3m1) → lb-r7m1
 *   r3m1 winner vs lb-r7m1 winner → gf
 *
 * Whenever both inputs for a downstream match are known, this helper also
 * marks that match as ready (generating its config and triggering allocation)
 * via `makeMatchReady`, mirroring what `advanceWinnerToNextMatch` would do.
 */
export async function reconcileDoubleElimination8Bracket(): Promise<void> {
  try {
    const tournament = await db.queryOneAsync<DbTournamentRow>(
      'SELECT * FROM tournament WHERE id = 1'
    );
    if (!tournament || tournament.type !== 'double_elimination') {
      return;
    }

    let teamIds: unknown;
    try {
      teamIds = JSON.parse(tournament.team_ids);
    } catch {
      return;
    }

    if (!Array.isArray(teamIds) || teamIds.length !== 8) {
      // Only handle the canonical 8‑team case here; fall back to generic logic
      // for other team counts.
      return;
    }

    const rows = await db.queryAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE tournament_id = 1'
    );

    const bySlug = new Map<string, DbMatchRow>();
    for (const row of rows) {
      if (row.slug) {
        bySlug.set(row.slug, row);
      }
    }

    const get = (slug: string): DbMatchRow | undefined => bySlug.get(slug);

    const r1m1 = get('r1m1');
    const r1m2 = get('r1m2');
    const r1m3 = get('r1m3');
    const r1m4 = get('r1m4');
    const r2m1 = get('r2m1');
    const r2m2 = get('r2m2');
    const r3m1 = get('r3m1');

    const lb_r4m1 = get('lb-r4m1');
    const lb_r4m2 = get('lb-r4m2');
    const lb_r5m1 = get('lb-r5m1');
    const lb_r5m2 = get('lb-r5m2');
    const lb_r6m1 = get('lb-r6m1');
    const lb_r7m1 = get('lb-r7m1');
    const gf = get('gf');

    const loserOf = (m?: DbMatchRow | null): string | null => {
      if (!m || !m.winner_id || !m.team1_id || !m.team2_id) return null;
      return m.team1_id === m.winner_id ? m.team2_id ?? null : m.team1_id ?? null;
    };

    const updateTeamsIfChanged = async (
      m: DbMatchRow | undefined,
      team1Id?: string | null,
      team2Id?: string | null
    ): Promise<DbMatchRow | undefined> => {
      if (!m) return undefined;
      const updates: Partial<DbMatchRow> = {};

      if (team1Id && m.team1_id !== team1Id) {
        updates.team1_id = team1Id;
      }
      if (team2Id && m.team2_id !== team2Id) {
        updates.team2_id = team2Id;
      }

      if (Object.keys(updates).length > 0) {
        await db.updateAsync('matches', updates as Record<string, unknown>, 'id = ?', [m.id]);
        const refreshed = await db.queryOneAsync<DbMatchRow>(
          'SELECT * FROM matches WHERE id = ?',
          [m.id]
        );
        if (refreshed) {
          bySlug.set(refreshed.slug, refreshed);
          return refreshed;
        }
      }
      return m;
    };

    const maybeMakeReady = async (m?: DbMatchRow | null): Promise<void> => {
      if (!m) return;
      if (m.status === 'pending' && m.team1_id && m.team2_id) {
        await makeMatchReady(m);
        // Refresh local cache after status/config updates
        const refreshed = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
          m.id,
        ]);
        if (refreshed) {
          bySlug.set(refreshed.slug, refreshed);
        }
      }
    };

    // --- Winners bracket: R1 -> R2 ---
    const w_r1m1 = r1m1?.winner_id ?? null;
    const w_r1m2 = r1m2?.winner_id ?? null;
    const w_r1m3 = r1m3?.winner_id ?? null;
    const w_r1m4 = r1m4?.winner_id ?? null;

    if (w_r1m1 && w_r1m2 && r2m1) {
      const updated = await updateTeamsIfChanged(r2m1, w_r1m1, w_r1m2);
      await maybeMakeReady(updated);
    }
    if (w_r1m3 && w_r1m4 && r2m2) {
      const updated = await updateTeamsIfChanged(r2m2, w_r1m3, w_r1m4);
      await maybeMakeReady(updated);
    }

    // --- Winners bracket: R2 -> R3 (winners final) ---
    const w_r2m1 = r2m1?.winner_id ?? null;
    const w_r2m2 = r2m2?.winner_id ?? null;
    if (w_r2m1 && w_r2m2 && r3m1) {
      const updated = await updateTeamsIfChanged(r3m1, w_r2m1, w_r2m2);
      await maybeMakeReady(updated);
    }

    // --- Losers bracket: seed R4 from R1 losers ---
    const l_r1m1 = loserOf(r1m1);
    const l_r1m2 = loserOf(r1m2);
    const l_r1m3 = loserOf(r1m3);
    const l_r1m4 = loserOf(r1m4);

    if (l_r1m1 && l_r1m2 && lb_r4m1) {
      const updated = await updateTeamsIfChanged(lb_r4m1, l_r1m1, l_r1m2);
      await maybeMakeReady(updated);
    }
    if (l_r1m3 && l_r1m4 && lb_r4m2) {
      const updated = await updateTeamsIfChanged(lb_r4m2, l_r1m3, l_r1m4);
      await maybeMakeReady(updated);
    }

    // --- Losers bracket: seed R5 from R2 losers + LB R4 winners ---
    const l_r2m1 = loserOf(r2m1);
    const l_r2m2 = loserOf(r2m2);
    const w_lb_r4m1 = lb_r4m1?.winner_id ?? null;
    const w_lb_r4m2 = lb_r4m2?.winner_id ?? null;

    if (w_lb_r4m1 && l_r2m1 && lb_r5m1) {
      const updated = await updateTeamsIfChanged(lb_r5m1, w_lb_r4m1, l_r2m1);
      await maybeMakeReady(updated);
    }
    if (w_lb_r4m2 && l_r2m2 && lb_r5m2) {
      const updated = await updateTeamsIfChanged(lb_r5m2, w_lb_r4m2, l_r2m2);
      await maybeMakeReady(updated);
    }

    // --- Losers bracket: R6 from R5 winners ---
    const w_lb_r5m1 = lb_r5m1?.winner_id ?? null;
    const w_lb_r5m2 = lb_r5m2?.winner_id ?? null;
    if (w_lb_r5m1 && w_lb_r5m2 && lb_r6m1) {
      const updated = await updateTeamsIfChanged(lb_r6m1, w_lb_r5m1, w_lb_r5m2);
      await maybeMakeReady(updated);
    }

    // --- Losers bracket: R7 from R6 winner + R3 loser ---
    const w_lb_r6m1 = lb_r6m1?.winner_id ?? null;
    const l_r3m1 = loserOf(r3m1);
    if (w_lb_r6m1 && l_r3m1 && lb_r7m1) {
      const updated = await updateTeamsIfChanged(lb_r7m1, w_lb_r6m1, l_r3m1);
      await maybeMakeReady(updated);
    }

    // --- Grand final from winners final + losers final winners ---
    const w_r3m1 = r3m1?.winner_id ?? null;
    const w_lb_r7m1 = lb_r7m1?.winner_id ?? null;
    if (w_r3m1 && w_lb_r7m1 && gf) {
      const updated = await updateTeamsIfChanged(gf, w_r3m1, w_lb_r7m1);
      await maybeMakeReady(updated);
    }
  } catch (error) {
    log.error('Error reconciling 8-team double elimination bracket', error);
  }
}

/**
 * Find the losers bracket match for a winners bracket loser
 */
async function findLosersBracketMatch(wbMatch: DbMatchRow): Promise<DbMatchRow | undefined> {
  // Parse winners bracket match slug
  const wbSlugMatch = wbMatch.slug.match(/^(?:wb-)?r(\d+)m(\d+)$/);
  if (!wbSlugMatch) {
    log.warn('Invalid winners bracket slug format', { slug: wbMatch.slug });
    return undefined;
  }

  const wbRound = parseInt(wbSlugMatch[1], 10);
  const wbMatchNum = parseInt(wbSlugMatch[2], 10);

  // Derive how brackets-manager has laid out rounds across winners and losers
  // groups. In our schema, "round" is a single counter shared by both groups,
  // so losers bracket rounds often start at a higher numeric value (e.g. 4)
  // even though conceptually it's "Losers Round 1".
  const winnersRoundRow = await db.queryOneAsync<{ min_round: number }>(
    "SELECT MIN(round) as min_round FROM matches WHERE tournament_id = 1 AND slug NOT LIKE 'lb-%'",
    []
  );
  const losersRoundRow = await db.queryOneAsync<{ min_round: number }>(
    "SELECT MIN(round) as min_round FROM matches WHERE tournament_id = 1 AND slug LIKE 'lb-%'",
    []
  );

  if (!winnersRoundRow?.min_round || !losersRoundRow?.min_round) {
    log.warn('Cannot derive losers bracket round mapping (missing winners/losers rounds)', {
      wbSlug: wbMatch.slug,
      winnersMinRound: winnersRoundRow?.min_round,
      losersMinRound: losersRoundRow?.min_round,
    });
    return undefined;
  }

  const winnersBase = winnersRoundRow.min_round;
  const losersBase = losersRoundRow.min_round;
  const roundOffset = losersBase - winnersBase;
  const winnersMaxRoundRow = await db.queryOneAsync<{ max_round: number }>(
    "SELECT MAX(round) as max_round FROM matches WHERE tournament_id = 1 AND slug NOT LIKE 'lb-%'",
    []
  );
  const lbRounds = await db.queryAsync<{ round: number }>(
    "SELECT DISTINCT round FROM matches WHERE tournament_id = 1 AND slug LIKE 'lb-%'",
    []
  );

  const winnersMaxRound =
    winnersMaxRoundRow && typeof winnersMaxRoundRow.max_round === 'number'
      ? winnersMaxRoundRow.max_round
      : null;
  const lbRoundNumbers = lbRounds.map((r) => r.round);
  const lastLbRound = lbRoundNumbers.length > 0 ? Math.max(...lbRoundNumbers) : null;

  // Map Winners Round R to the appropriate losers-bracket round:
  //
  // - For all winners rounds *before* the final, we offset relative to the
  //   first losers round so that:
  //     R1 → lb-r4*, R2 → lb-r5*, ...
  //
  // - For the winners‑bracket final itself, we send the loser to the *last*
  //   losers round. This matches the standard double‑elimination flow where
  //   the winners‑final loser faces the losers‑bracket champion in the LB
  //   final (just before grand finals). For an 8‑team bracket this yields:
  //     R1 → lb-r4*, R2 → lb-r5*, R3 (final) → lb-r7*.
  let lbRound: number;
  if (winnersMaxRound !== null && lastLbRound !== null && wbRound === winnersMaxRound) {
    lbRound = lastLbRound;
  } else {
    lbRound = wbRound + roundOffset;
  }

  // Within that losers round we need slightly different pairing rules:
  //
  // - For the *first* winners round, losers are paired in twos:
  //     r1m1 + r1m2 → lb‑r4m1
  //     r1m3 + r1m4 → lb‑r4m2
  //
  // - For all *later* winners rounds, each losers‑bracket match receives
  //   exactly one winners‑bracket loser (the other slot is filled by a
  //   prior losers‑bracket winner), so we map 1:1 by match number:
  //     r2m1 → lb‑r5m1
  //     r2m2 → lb‑r5m2
  //
  // This generalises cleanly for larger brackets (16, 32 teams).
  const lbMatchNum =
    wbRound === winnersBase
      ? Math.ceil(wbMatchNum / 2)
      : wbMatchNum;
  const lbSlug = `lb-r${lbRound}m${lbMatchNum}`;

  const lbMatch = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
    lbSlug,
  ]);

  if (!lbMatch) {
    log.warn('Losers bracket match not found', { lbSlug, wbSlug: wbMatch.slug });
    return undefined;
  }

  return lbMatch;
}

/**
 * Automatically allocate an available server to a newly ready match
 */
async function autoAllocateServerToMatch(matchSlug: string): Promise<void> {
  try {
    const webhookUrl = await settingsService.getWebhookUrl();

    if (!webhookUrl) {
      log.warn(
        'Webhook URL is not configured. Skipping auto-allocation for match. Configure the webhook URL in Settings.'
      );
      return;
    }

    const result = await matchAllocationService.allocateSingleMatch(matchSlug, webhookUrl);

    if (result.success) {
      log.success(`Auto-allocated match ${matchSlug} to server ${result.serverId}`);
      emitBracketUpdate({
        action: 'match_allocated',
        matchSlug,
        serverId: result.serverId,
      });
    } else {
      log.warn(`Could not auto-allocate match ${matchSlug}: ${result.error}`);
    }
  } catch (error) {
    log.error('Error in auto-allocate server', error, { matchSlug });
  }
}
