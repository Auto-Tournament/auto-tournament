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

/**
 * Advance winner to next match in bracket
 */
export async function advanceWinnerToNextMatch(
  currentMatch: DbMatchRow,
  winnerId: string
): Promise<void> {
  try {
    const nextMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      currentMatch.next_match_id,
    ]);

    if (!nextMatch) {
      log.warn('Next match not found', { nextMatchId: currentMatch.next_match_id });
      return;
    }

    // Determine which slot to fill (team1 or team2)
    if (!nextMatch.team1_id) {
      db.update('matches', { team1_id: winnerId }, 'id = ?', [nextMatch.id]);
      log.debug(`Advanced ${winnerId} to ${nextMatch.slug} as team1`);
    } else if (!nextMatch.team2_id) {
      db.update('matches', { team2_id: winnerId }, 'id = ?', [nextMatch.id]);
      log.debug(`Advanced ${winnerId} to ${nextMatch.slug} as team2`);
    } else {
      log.warn('Next match already has both teams assigned', { nextMatchSlug: nextMatch.slug });
      return;
    }

    // Check if both teams are now assigned
    const updatedNextMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
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

    const tournament = db.queryOne<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!tournament || tournament.type !== 'double_elimination') {
      return;
    }

    const loserId =
      currentMatch.team1_id === winnerId ? currentMatch.team2_id : currentMatch.team1_id;

    if (!loserId) {
      log.warn('Could not determine loser', { matchSlug: currentMatch.slug });
      return;
    }

    // Find the losers bracket destination
    const lbMatch = findLosersBracketMatch(currentMatch);
    if (!lbMatch) {
      return;
    }

    // Assign loser to losers bracket
    if (!lbMatch.team1_id) {
      db.update('matches', { team1_id: loserId }, 'id = ?', [lbMatch.id]);
      log.debug(`Advanced loser ${loserId} to ${lbMatch.slug} as team1`);
    } else if (!lbMatch.team2_id) {
      db.update('matches', { team2_id: loserId }, 'id = ?', [lbMatch.id]);
      log.debug(`Advanced loser ${loserId} to ${lbMatch.slug} as team2`);
    } else {
      log.warn('Losers bracket match already full', { lbSlug: lbMatch.slug });
      return;
    }

    // Check if losers bracket match is now ready
    const updatedLbMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
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
export function checkTournamentCompletion(): void {
  try {
    const tournament = db.queryOne<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!tournament || tournament.status === 'completed') return;

    const pendingMatches = db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = 1 AND status != ?',
      ['completed']
    );

    if (pendingMatches && pendingMatches.count === 0) {
      db.update(
        'tournament',
        {
          status: 'completed',
          completed_at: Math.floor(Date.now() / 1000),
        },
        'id = ?',
        [1]
      );

      log.success('🏆 Tournament completed! 🏆');
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
    const tournament = db.queryOne<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!tournament) {
      log.error('Tournament not found');
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
    };

    // Generate match config using the service
    const config = await generateMatchConfig(
      tournamentData,
      match.team1_id ?? undefined,
      match.team2_id ?? undefined,
      match.slug
    );

    // Update match with config and ready status
    db.update('matches', { config: JSON.stringify(config), status: 'ready' }, 'id = ?', [match.id]);

    // Get team names for logging
    const team1 = db.queryOne<DbTeamRow>('SELECT name FROM teams WHERE id = ?', [match.team1_id]);
    const team2 = db.queryOne<DbTeamRow>('SELECT name FROM teams WHERE id = ?', [match.team2_id]);

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
function findLosersBracketMatch(wbMatch: DbMatchRow): DbMatchRow | undefined {
  // Parse winners bracket match slug
  const wbSlugMatch = wbMatch.slug.match(/^(?:wb-)?r(\d+)m(\d+)$/);
  if (!wbSlugMatch) {
    log.warn('Invalid winners bracket slug format', { slug: wbMatch.slug });
    return undefined;
  }

  const wbRound = parseInt(wbSlugMatch[1], 10);
  const wbMatchNum = parseInt(wbSlugMatch[2], 10);

  // Calculate losers bracket destination: Winners Round R → Losers Round (2R-1)
  const lbRound = 2 * wbRound - 1;
  const lbMatchNum = wbMatchNum;
  const lbSlug = `lb-r${lbRound}m${lbMatchNum}`;

  const lbMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [lbSlug]);

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
    const baseUrl = process.env.WEBHOOK_URL || 'http://localhost:3000';
    const result = await matchAllocationService.allocateSingleMatch(matchSlug, baseUrl);

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
