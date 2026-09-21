/**
 * Round robin standings from the database (see utils/roundRobinStandings for
 * the order: wins, head-to-head, round difference, rounds won, seed).
 */

import { db } from '../config/database';
import { computeRoundRobinStandings, type RoundRobinStanding } from '../utils/roundRobinStandings';
import { loadSwissMatches, parseTeamIds, toSwissMatch } from './swissProgressionService';
import type { DbTournamentRow } from '../types/database.types';
import type { RoundRobinStandingEntry } from '../types/tournament.types';

/** Current (or final) round robin standings, best first. */
export async function getRoundRobinStandings(
  tournamentId: number = 1
): Promise<RoundRobinStanding[]> {
  const tournament = await db.queryOneAsync<DbTournamentRow>(
    'SELECT * FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (!tournament) return [];
  const rows = await loadSwissMatches(tournamentId);
  return computeRoundRobinStandings(parseTeamIds(tournament.team_ids), rows.map(toSwissMatch));
}

/** Standings as exposed by the API (bracket and leaderboard), best first. */
export async function getRoundRobinStandingEntries(
  tournamentId: number = 1
): Promise<RoundRobinStandingEntry[]> {
  const standings = await getRoundRobinStandings(tournamentId);
  return standings.map((s, index) => ({
    rank: index + 1,
    teamId: s.teamId,
    wins: s.wins,
    losses: s.losses,
    roundDiff: s.roundDiff,
    roundsWon: s.roundsWon,
  }));
}
