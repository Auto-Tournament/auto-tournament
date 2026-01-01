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
  winnerId: string
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
 * Check if tournament is completed
 */
export async function checkTournamentCompletion(): Promise<void> {
  try {
    const tournament = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!tournament || tournament.status === 'completed') return;

    const pendingMatches = await db.queryOneAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = 1 AND status != ?',
      ['completed']
    );

    if (pendingMatches && pendingMatches.count === 0) {
      await db.updateAsync(
        'tournament',
        {
          status: 'completed',
          completed_at: Math.floor(Date.now() / 1000),
        },
        'id = ?',
        [1]
      );

      log.success('[TOURNAMENT] Tournament completed!');
      emitBracketUpdate({ action: 'tournament_completed' });
    }
  } catch (error) {
    log.error('Error checking tournament completion', error);
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

  // Map Winners Round R → first Losers Round (losersBase) + (R - winnersBase).
  // For an 8-team DE this yields:
  //   R1 → lb-r4*, R2 → lb-r5*, R3 → lb-r6*, etc.
  const lbRound = wbRound + roundOffset;

  // Within that losers round, pair losers using the same ceil(N/2) pattern we
  // use for winners progression: losers of r1m1/r1m2 → lb-r4m1,
  // losers of r1m3/r1m4 → lb-r4m2, etc.
  const lbMatchNum = Math.ceil(wbMatchNum / 2);
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
