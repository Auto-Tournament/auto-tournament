/**
 * Shuffle Tournament Service
 * Handles shuffle tournament creation, round generation, and automatic progression
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { balanceTeams, type BalancedTeam } from './teamBalancingService';
import { playerService, type PlayerRecord } from './playerService';
import { teamService } from './teamService';
import { teamMembers } from './teamMembers';
import { buildMatchConfigFor, serializeMatchConfig } from '../utils/matchIntegration';
import { generateUniqueTeamName } from '../generation/teamName';
import type { TournamentResponse } from '../types/tournament.types';
import type { DbMatchRow, DbTeamRow, DbTournamentRow } from '../types/database.types';
import { tournamentRowToResponse } from '../utils/tournamentRow';
import { getSwissStandingEntries } from './swissProgressionService';
import { getRoundRobinStandingEntries } from './roundRobinStandingsService';
import type { Player } from '../types/team.types';

export interface ShuffleTournamentConfig {
  name: string;
  mapSequence: string[]; // Maps in order (number of maps = number of rounds)
  teamSize: number; // Number of players per team, default: 5
  /**
   * Shuffle tournaments always use an explicit max-rounds limit.
   * This directly maps to MatchZy's mp_maxrounds.
   */
  maxRounds: number; // Required, default: 24 (validated below)
  overtimeMode: 'enabled' | 'disabled';
  /**
   * Optional: max number of overtime segments (maps) allowed before match ends in a draw.
   * Mapped to MatchZy's overtime limit cvar. If undefined or 0, MatchZy default (unlimited)
   * behavior is used.
   */
  overtimeSegments?: number;
  eloTemplateId?: string; // ELO calculation template ID (optional, defaults to "Pure Win/Loss")
}

export interface PlayerLeaderboardEntry {
  playerId: string;
  name: string;
  avatar?: string;
  currentElo: number;
  startingElo: number;
  matchWins: number;
  matchLosses: number;
  winRate: number;
  eloChange: number; // Change since tournament start
  averageAdr?: number; // Future: average ADR across matches
}

export interface TeamLeaderboardEntry {
  teamId: string;
  name: string;
  tag?: string | null;
  matchWins: number;
  matchLosses: number;
  matchCount: number;
  winRate: number;
  /** Swiss and round robin: rank and round differential from the server standings (Buchholz: Swiss only). */
  rank?: number;
  buchholz?: number;
  roundDiff?: number;
}

export interface RoundStatus {
  roundNumber: number;
  totalMatches: number;
  completedMatches: number;
  pendingMatches: number;
  isComplete: boolean;
  map: string;
}

/**
 * Create a shuffle tournament
 */
export async function createShuffleTournament(
  tournamentId: number,
  config: ShuffleTournamentConfig
): Promise<TournamentResponse> {
  const now = Math.floor(Date.now() / 1000);

  // The config is validated by the route (POST /api/tournament/shuffle): the
  // name there, the map sequence and max rounds through the integration's
  // `validateTournamentSettings`.

  // Clean up any existing data for this tournament row, so it can be
  // recreated multiple times (tests do) without PK conflicts.
  await db.runAsync('DELETE FROM matches WHERE tournament_id = ?', [tournamentId]);
  await db.runAsync('DELETE FROM shuffle_tournament_players WHERE tournament_id = ?', [tournamentId]);
  await db.execAsync("DELETE FROM teams WHERE id LIKE 'shuffle-r%'");
  await db.runAsync('DELETE FROM tournament WHERE id = ?', [tournamentId]);

  // Create tournament
  await db.insertAsync('tournament', {
    id: tournamentId,
    name: config.name,
    type: 'shuffle',
    format: 'bo1', // Shuffle tournaments are always BO1
    status: 'setup',
    maps: JSON.stringify(config.mapSequence),
    team_ids: JSON.stringify([]), // No fixed teams for shuffle tournaments
    settings: JSON.stringify({
      matchFormat: 'bo1',
      thirdPlaceMatch: false,
      autoAdvance: true,
      checkInRequired: false,
      seedingMethod: 'random',
    }),
    map_sequence: JSON.stringify(config.mapSequence),
    team_size: config.teamSize || 5,
    max_rounds: config.maxRounds || 24,
    overtime_mode: config.overtimeMode || 'enabled',
    overtime_segments:
      typeof config.overtimeSegments === 'number' && config.overtimeSegments > 0
        ? config.overtimeSegments
        : null,
    elo_template_id: config.eloTemplateId || null,
    created_at: now,
    updated_at: now,
  });

  log.success(`Shuffle tournament created: ${config.name}`, {
    rounds: config.mapSequence.length,
    overtimeMode: config.overtimeMode,
    overtimeSegments: config.overtimeSegments,
  });

  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('Failed to create tournament');
  }

  return tournament;
}

/**
 * Register players to shuffle tournament
 * Players are automatically whitelisted for matches
 */
export async function registerPlayers(
  tournamentId: number,
  playerIds: string[]
): Promise<{
  registered: number;
  errors: Array<{ playerId: string; error: string }>;
}> {
  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('No shuffle tournament found. Please create a shuffle tournament first.');
  }

  if (tournament.status !== 'setup') {
    throw new Error(
      `Cannot register players. Tournament is in "${tournament.status}" status. ` +
      'Players can only be registered when tournament is in "setup" status.'
    );
  }

  if (!playerIds || playerIds.length === 0) {
    throw new Error('No players provided. Please select at least one player to register.');
  }

  const errors: Array<{ playerId: string; error: string }> = [];
  let registered = 0;

  // Table should already exist from schema, but handle gracefully if not

  for (const playerId of playerIds) {
    try {
      // Check if player exists
      const player = await playerService.getPlayerById(playerId);
      if (!player) {
        errors.push({ playerId, error: 'Player not found' });
        continue;
      }

      // Register player (upsert - ignore if already registered)
      try {
        await db.insertAsync('shuffle_tournament_players', {
          tournament_id: tournamentId,
          player_id: playerId,
          registered_at: Math.floor(Date.now() / 1000),
        });
        registered++;
      } catch (err) {
        // Player already registered, skip
        const error = err as Error & { code?: string };
        if (error.code !== '23505') {
          // Not a duplicate key error, rethrow
          throw err;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ playerId, error: errorMessage });
    }
  }

  log.success(`Registered ${registered} players to shuffle tournament`, {
    errors: errors.length,
  });

  return { registered, errors };
}

/**
 * Get registered players for shuffle tournament
 */
export async function getRegisteredPlayers(tournamentId: number): Promise<PlayerRecord[]> {
  const playerIds = await db.queryAsync<{ player_id: string }>(
    'SELECT player_id FROM shuffle_tournament_players WHERE tournament_id = ? ORDER BY registered_at',
    [tournamentId]
  );

  if (playerIds.length === 0) {
    return [];
  }

  return await playerService.getPlayersByIds(playerIds.map((p) => p.player_id));
}

/**
 * Set registered players for shuffle tournament (replaces all existing registrations)
 * This allows selecting/deselecting players by providing the full list
 */
export async function setRegisteredPlayers(
  tournamentId: number,
  playerIds: string[]
): Promise<{
  registered: number;
  unregistered: number;
  errors: Array<{ playerId: string; error: string }>;
}> {
  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('No shuffle tournament found. Please create a shuffle tournament first.');
  }

  if (tournament.status !== 'setup') {
    throw new Error(
      `Cannot modify player registrations. Tournament is in "${tournament.status}" status. ` +
      'Players can only be modified when tournament is in "setup" status.'
    );
  }

  // Get currently registered players
  const currentPlayerIds = await db.queryAsync<{ player_id: string }>(
    'SELECT player_id FROM shuffle_tournament_players WHERE tournament_id = ?',
    [tournamentId]
  );
  const currentIds = new Set(currentPlayerIds.map((p) => p.player_id));

  // Determine which players to add and which to remove
  const newIds = new Set(playerIds || []);
  const toAdd = playerIds.filter((id) => !currentIds.has(id));
  const toRemove = Array.from(currentIds).filter((id) => !newIds.has(id));

  const errors: Array<{ playerId: string; error: string }> = [];
  let registered = 0;
  let unregistered = 0;

  // Remove players that are no longer in the list
  for (const playerId of toRemove) {
    try {
      await db.deleteAsync('shuffle_tournament_players', 'tournament_id = ? AND player_id = ?', [
        tournamentId,
        playerId,
      ]);
      unregistered++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ playerId, error: `Failed to unregister: ${errorMessage}` });
    }
  }

  // Add new players
  const now = Math.floor(Date.now() / 1000);
  for (const playerId of toAdd) {
    try {
      // Check if player exists
      const player = await playerService.getPlayerById(playerId);
      if (!player) {
        errors.push({ playerId, error: 'Player not found' });
        continue;
      }

      // Register player
      await db.insertAsync('shuffle_tournament_players', {
        tournament_id: tournamentId,
        player_id: playerId,
        registered_at: now,
      });
      registered++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ playerId, error: errorMessage });
    }
  }

  log.success(`Updated player registrations: ${registered} added, ${unregistered} removed`, {
    errors: errors.length,
  });

  return { registered, unregistered, errors };
}

/**
 * Generate matches for a round
 * Automatically balances teams and creates matches
 */
export async function generateRoundMatches(
  tournamentId: number,
  roundNumber: number
): Promise<{
  matches: DbMatchRow[];
  teams: BalancedTeam[];
}> {
  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('No shuffle tournament found');
  }

  // Get map sequence
  const mapSequence = tournament.mapSequence || tournament.maps;
  if (roundNumber < 1 || roundNumber > mapSequence.length) {
    throw new Error(
      `Invalid round number: ${roundNumber}. ` +
      `Tournament has ${mapSequence.length} round(s) (based on ${mapSequence.length} map(s) selected). ` +
      `Valid round numbers: 1-${mapSequence.length}.`
    );
  }

  const map = mapSequence[roundNumber - 1];
  const teamSize = tournament.teamSize || 5;

  // Get registered players
  const players = await getRegisteredPlayers(tournamentId);
  const minPlayers = teamSize * 2; // Need at least 2 teams
  if (players.length < minPlayers) {
    throw new Error(
      `Not enough players registered: ${players.length}. ` +
      `Shuffle tournaments require at least ${minPlayers} players for ${teamSize}v${teamSize} matches. ` +
      `Please register ${minPlayers - players.length} more player(s) before generating matches.`
    );
  }

  // Handle odd number of players with rotation
  // Track players who played in the previous round so we can rotate in players who sat out
  let playersWhoPlayedLastRound: string[] = [];
  if (roundNumber > 1) {
    // Get players who played in the previous round
    const previousRoundMatches = await db.queryAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE tournament_id = ? AND round = ?',
      [tournamentId, roundNumber - 1]
    );

    const playersWhoPlayed = new Set<string>();
    for (const match of previousRoundMatches) {
      const team1 = await teamService.getTeamById(match.team1_id || '');
      const team2 = await teamService.getTeamById(match.team2_id || '');
      if (team1) {
        team1.players.forEach((p) => playersWhoPlayed.add(p.steamId));
      }
      if (team2) {
        team2.players.forEach((p) => playersWhoPlayed.add(p.steamId));
      }
    }

    // Players who played last round are candidates to sit this round if needed
    const allPlayerIds = players.map((p) => p.id);
    playersWhoPlayedLastRound = allPlayerIds.filter((id) => playersWhoPlayed.has(id));
  }

  // Balance teams
  const playerIds = players.map((p) => p.id);
  const balanceResult = await balanceTeams(playerIds, teamSize, true); // Use tournament team size, use optimization

  // Create temporary teams for this round
  const teams: BalancedTeam[] = balanceResult.teams;
  const createdTeams: Array<{ team1Id: string; team2Id: string }> = [];

  const now = Math.floor(Date.now() / 1000);
  const matches: DbMatchRow[] = [];

  // Track which players are assigned to matches (for future use if needed)
  // const assignedPlayerIds = new Set<string>();

  // Build a set of team names that have already been used by previous shuffle
  // rounds so we never reuse a name within the same tournament.
  const existingShuffleTeams = await db.queryAsync<DbTeamRow>(
    "SELECT id, name, tag FROM teams WHERE id LIKE 'shuffle-r%'"
  );
  const usedTeamNames = new Set<string>(existingShuffleTeams.map((t) => t.name));

  // Create matches for each team pair
  for (let matchNum = 0; matchNum < teams.length / 2; matchNum++) {
    const team1Index = matchNum * 2;
    const team2Index = team1Index + 1;

    if (team2Index >= teams.length) {
      // Odd number of teams - handle rotation
      const lastTeam = teams[team1Index];
      const lastTeamPlayerIds = lastTeam.players.map((p) => p.id);

      // Candidates to rotate in are players from the leftover team who did NOT play last round
      // (i.e. they sat out previously and we want to prioritize getting them into matches)
      let candidateIds = lastTeamPlayerIds.filter((id) => !playersWhoPlayedLastRound.includes(id));

      if (candidateIds.length > 0 && roundNumber > 1) {
        // Try to swap as many candidates as possible with players who played last round.
        // This avoids the same players sitting out multiple rounds in a row when we have options.
        let swappedAny = false;

        for (const match of matches) {
          if (candidateIds.length === 0) break;

          const existingTeam1 = await teamService.getTeamById(match.team1_id || '');
          const existingTeam2 = await teamService.getTeamById(match.team2_id || '');

          for (const existingTeam of [existingTeam1, existingTeam2].filter(Boolean)) {
            if (!existingTeam) continue;
            if (candidateIds.length === 0) break;

            for (const existingPlayer of existingTeam.players) {
              if (candidateIds.length === 0) break;

              // Only consider swapping out players who played last round
              if (!playersWhoPlayedLastRound.includes(existingPlayer.steamId)) {
                continue;
              }

              // Prefer the candidate with the fewest matches played overall (fair rotation)
              let bestCandidateId: string | null = null;
              let bestMatchCount = Number.POSITIVE_INFINITY;

              for (const candidateId of candidateIds) {
                const candidateRecord = players.find((p) => p.id === candidateId);
                const matchCount = candidateRecord?.match_count ?? 0;
                if (matchCount < bestMatchCount) {
                  bestMatchCount = matchCount;
                  bestCandidateId = candidateId;
                }
              }

              if (!bestCandidateId) {
                continue;
              }

              const candidateRecord = players.find((p) => p.id === bestCandidateId);
              if (!candidateRecord) {
                // Remove bad candidate and continue
                candidateIds = candidateIds.filter((id) => id !== bestCandidateId);
                continue;
              }

              // Swap: remove player who played last round, add player who sat out
              const playerToRemove = existingPlayer.steamId;
              const updatedPlayers = existingTeam.players
                .filter((p) => p.steamId !== playerToRemove)
                .concat([
                  {
                    steamId: candidateRecord.id,
                    name: candidateRecord.name,
                    avatar: candidateRecord.avatar_url,
                  },
                ]);

              await db.updateAsync(
                'teams',
                { players: JSON.stringify(updatedPlayers), updated_at: now },
                'id = ?',
                [existingTeam.id]
              );

              // Rebuild the match config so it carries the rotated roster
              if (!match.slug) continue;
              const matchSlug = match.slug;
              const updatedMatch = await db.queryOneAsync<DbMatchRow>(
                'SELECT * FROM matches WHERE slug = ?',
                [matchSlug]
              );
              const matchTournament = updatedMatch?.tournament_id
                ? await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
                    updatedMatch.tournament_id,
                  ])
                : null;
              if (updatedMatch && updatedMatch.config && matchTournament) {
                const matchConfig = await buildMatchConfigFor(
                  {
                    slug: updatedMatch.slug,
                    id: updatedMatch.id,
                    game: updatedMatch.game,
                    round: updatedMatch.round,
                    team1Id: updatedMatch.team1_id,
                    team2Id: updatedMatch.team2_id,
                  },
                  tournamentRowToResponse(matchTournament)
                );
                await db.updateAsync(
                  'matches',
                  { config: serializeMatchConfig(matchConfig) },
                  'id = ?',
                  [updatedMatch.id]
                );
              }

              log.info(
                `Rotated player ${candidateRecord.name} into match ${matchSlug}, removed ${existingPlayer.name}`
              );
              swappedAny = true;

              // Remove this candidate so we don't try to place them again
              candidateIds = candidateIds.filter((id) => id !== bestCandidateId);
            }
          }
        }

        if (!swappedAny) {
          // Couldn't swap, log warning
          log.warn(
            `Odd number of teams in round ${roundNumber}, could not rotate players. Last team (${lastTeam.players
              .map((p) => p.name)
              .join(', ')}) will sit out.`
          );
        }
      } else {
        // First round or no rotation needed - skip last team
        log.info(
          `Odd number of teams in round ${roundNumber}, skipping last team (${lastTeam.players
            .map((p) => p.name)
            .join(', ')})`
        );
      }
      break;
    }

    const team1 = teams[team1Index];
    const team2 = teams[team2Index];

    // Create temporary teams
    const team1Id = `shuffle-r${roundNumber}-m${matchNum + 1}-team1`;
    const team2Id = `shuffle-r${roundNumber}-m${matchNum + 1}-team2`;

    // Pick two distinct, random, globally-unique team names for this match.
    const team1FriendlyName = generateUniqueTeamName(usedTeamNames);
    const team2FriendlyName = generateUniqueTeamName(usedTeamNames);

    // Convert players to team format
    const team1Players: Player[] = team1.players.map((p) => ({
      steamId: p.id,
      name: p.name,
      avatar: p.avatar_url || undefined,
    }));

    const team2Players: Player[] = team2.players.map((p) => ({
      steamId: p.id,
      name: p.name,
      avatar: p.avatar_url || undefined,
    }));

    // Create teams in database
    await db.insertAsync('teams', {
      id: team1Id,
      name: team1FriendlyName,
      tag: `R${roundNumber}M${matchNum + 1}T1`,
      players: JSON.stringify(team1Players),
      created_at: now,
      updated_at: now,
    });

    await db.insertAsync('teams', {
      id: team2Id,
      name: team2FriendlyName,
      tag: `R${roundNumber}M${matchNum + 1}T2`,
      players: JSON.stringify(team2Players),
      created_at: now,
      updated_at: now,
    });

    // Mirror both rosters into team_members (3.0 phase D), as a team written
    // through teamService would. Best effort; these teams cascade away with
    // the round.
    await teamMembers.syncFromRoster(
      team1Id,
      team1Players.map((p) => p.steamId)
    );
    await teamMembers.syncFromRoster(
      team2Id,
      team2Players.map((p) => p.steamId)
    );

    createdTeams.push({ team1Id, team2Id });

    // Build the match config through the game integration. For shuffle it is
    // Bo1 on the round's map (map sequence), random side, no veto.
    const matchSlug = `shuffle-r${roundNumber}-m${matchNum + 1}`;
    const config = await buildMatchConfigFor(
      { slug: matchSlug, round: roundNumber, team1Id, team2Id },
      tournament
    );

    // Create match
    // Shuffle tournaments skip veto, so matches are immediately ready for server allocation
    await db.insertAsync('matches', {
      slug: matchSlug,
      tournament_id: tournamentId,
      round: roundNumber,
      match_number: matchNum + 1,
      team1_id: team1Id,
      team2_id: team2Id,
      winner_id: null,
      server_id: null,
      config: serializeMatchConfig(config),
      status: 'ready', // Changed from 'pending' to 'ready' since skip_veto = true
      next_match_id: null,
      current_map: map,
      map_number: 0,
      created_at: now,
    });

    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      matchSlug,
    ]);

    if (match) {
      matches.push(match);
    }
  }

  log.success(`Generated ${matches.length} matches for round ${roundNumber}`, {
    map,
    players: players.length,
    teams: teams.length,
  });

  return { matches, teams };
}

/**
 * Check if a round is complete
 */
export async function checkRoundCompletion(
  tournamentId: number,
  roundNumber: number
): Promise<boolean> {
  const matches = await db.queryAsync<DbMatchRow>(
    'SELECT * FROM matches WHERE tournament_id = ? AND round = ?',
    [tournamentId, roundNumber]
  );

  if (matches.length === 0) {
    log.warn(`No matches found for round ${roundNumber}. Round cannot be considered complete.`);
    return false; // No matches for this round
  }

  // Check if all matches are completed
  const allComplete = matches.every((m) => m.status === 'completed');

  if (!allComplete) {
    const completed = matches.filter((m) => m.status === 'completed').length;
    log.debug(`Round ${roundNumber} progress: ${completed}/${matches.length} matches completed`);
  }

  return allComplete;
}

/**
 * Advance to next round automatically
 * Called when current round is complete
 */
export async function advanceToNextRound(tournamentId: number): Promise<{
  roundNumber: number;
  matches: DbMatchRow[];
} | null> {
  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('No shuffle tournament found. Please create a shuffle tournament first.');
  }

  // Get current round (find highest round with matches)
  const currentRoundResult = await db.queryOneAsync<{ max_round: number }>(
    'SELECT MAX(round) as max_round FROM matches WHERE tournament_id = ?',
    [tournamentId]
  );

  const currentRound = currentRoundResult?.max_round || 0;

  if (currentRound === 0) {
    log.info('No rounds have been generated yet. Starting from round 1.');
  }

  // Check if current round is complete
  if (currentRound > 0) {
    const isComplete = await checkRoundCompletion(tournamentId, currentRound);
    if (!isComplete) {
      log.debug(`Round ${currentRound} is not complete yet`);
      return null;
    }
  }

  // Get map sequence
  const mapSequence = tournament.mapSequence || tournament.maps;
  const nextRound = currentRound + 1;

  // Check if tournament is complete
  if (nextRound > mapSequence.length) {
    // Tournament complete
    const completedAt = Math.floor(Date.now() / 1000);
    await db.updateAsync(
      'tournament',
      {
        status: 'completed',
        completed_at: completedAt,
        updated_at: completedAt,
      },
      'id = ?',
      [tournamentId]
    );

    log.success(
      `Shuffle tournament completed! All ${mapSequence.length} round(s) finished. ` +
      `Final leaderboard available at /tournament/${tournamentId}/leaderboard`
    );
    return null;
  }

  // Generate next round matches
  const result = await generateRoundMatches(tournamentId, nextRound);

  // Update tournament status if starting first round
  if (currentRound === 0) {
    await db.updateAsync(
      'tournament',
      {
        status: 'in_progress',
        started_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      },
      'id = ?',
      [tournamentId]
    );
  }

  log.success(`Advanced to round ${nextRound}`);

  return {
    roundNumber: nextRound,
    matches: result.matches,
  };
}

/**
 * Get player leaderboard
 */
export async function getPlayerLeaderboard(tournamentId: number): Promise<PlayerLeaderboardEntry[]> {
  const players = await getRegisteredPlayers(tournamentId);

  // Get match results for all players
  const leaderboard: PlayerLeaderboardEntry[] = await Promise.all(
    players.map(async (player) => {
      // Get all matches this player participated in
      const matches = await db.queryAsync<{
        match_slug: string;
        team: string;
        won_match: boolean;
      }>(
        `SELECT match_slug, team, won_match 
         FROM player_match_stats 
         WHERE player_id = ? AND match_slug IN (
           SELECT slug FROM matches WHERE tournament_id = ?
         )`,
        [player.id, tournamentId]
      );

      // Deduplicate by match_slug so we only count each match once per player,
      // even if multiple player_match_stats rows exist for the same match
      // (e.g. if stats were re-tracked after late events).
      const matchBySlug = new Map<string, { team: string; won_match: boolean }>();
      for (const row of matches) {
        matchBySlug.set(row.match_slug, { team: row.team, won_match: row.won_match });
      }
      const uniqueMatches = Array.from(matchBySlug.values());

      const wins = uniqueMatches.filter((m) => m.won_match).length;
      const losses = uniqueMatches.filter((m) => !m.won_match).length;
      const totalMatches = uniqueMatches.length;
      const winRate = totalMatches > 0 ? wins / totalMatches : 0;

      // Aggregate ELO change for this tournament only
      const eloChangeRow = await db.queryOneAsync<{ total_elo_change: number }>(
        `
          SELECT COALESCE(SUM(elo_change), 0) as total_elo_change
          FROM player_rating_history
          WHERE player_id = ?
            AND match_slug IN (SELECT slug FROM matches WHERE tournament_id = ?)
        `,
        [player.id, tournamentId]
      );
      const eloChange = eloChangeRow?.total_elo_change ?? 0;

      // Calculate average ADR
      const statsWithAdr = await db.queryAsync<{ adr: number }>(
        `SELECT adr FROM player_match_stats 
         WHERE player_id = ? AND match_slug IN (
           SELECT slug FROM matches WHERE tournament_id = ?
         ) AND adr IS NOT NULL`,
        [player.id, tournamentId]
      );

      const averageAdr =
        statsWithAdr.length > 0
          ? statsWithAdr.reduce((sum, s) => sum + (s.adr || 0), 0) / statsWithAdr.length
          : undefined;

      return {
        playerId: player.id,
        name: player.name,
        avatar: player.avatar_url || undefined,
        currentElo: player.current_elo,
        startingElo: player.starting_elo,
        matchWins: wins,
        matchLosses: losses,
        winRate,
        eloChange,
        averageAdr: averageAdr ? Math.round(averageAdr * 100) / 100 : undefined,
      };
    })
  );

  // Sort by wins (descending), then by ELO (descending), then by ADR (descending)
  leaderboard.sort((a, b) => {
    if (b.matchWins !== a.matchWins) {
      return b.matchWins - a.matchWins;
    }
    if (b.currentElo !== a.currentElo) {
      return b.currentElo - a.currentElo;
    }
    const adrA = a.averageAdr ?? 0;
    const adrB = b.averageAdr ?? 0;
    return adrB - adrA;
  });

  return leaderboard;
}

/**
 * Get tournament leaderboard (public)
 *
 * Supports both shuffle tournaments (player-based Swiss style) and
 * standard bracket tournaments (team-based single/double elimination).
 */
export async function getTournamentLeaderboard(tournamentId: number): Promise<{
  tournament: TournamentResponse;
  leaderboard: PlayerLeaderboardEntry[];
  currentRound: number;
  totalRounds: number;
  roundStatus?: RoundStatus;
  teams?: TeamLeaderboardEntry[];
  /** Matches currently live or loaded, across the whole tournament. Powers the public "live now" strip. */
  liveMatchCount: number;
}> {
  // Load base tournament row
  const row = await db.queryOneAsync<DbTournamentRow>(
    'SELECT * FROM tournament WHERE id = ?',
    [tournamentId]
  );

  if (!row) {
    throw new Error('Tournament not found');
  }

  // Postgres returns COUNT(*) as a bigint-safe string; coerce it explicitly.
  const liveMatchCountResult = await db.queryOneAsync<{ count: number | string }>(
    `SELECT COUNT(*) as count FROM matches WHERE tournament_id = ? AND status IN ('live', 'loaded')`,
    [tournamentId]
  );
  const liveMatchCount = Number(liveMatchCountResult?.count ?? 0);

  // Shuffle tournaments keep the existing behaviour: player-only leaderboard
  // driven by registered players and Swiss-style rounds.
  if (row.type === 'shuffle') {
    const tournament = await getShuffleTournament(tournamentId);
    if (!tournament) {
      throw new Error('No shuffle tournament found');
    }

    const leaderboard = await getPlayerLeaderboard(tournamentId);

    const currentRoundResult = await db.queryOneAsync<{ max_round: number }>(
      'SELECT MAX(round) as max_round FROM matches WHERE tournament_id = ?',
      [tournamentId]
    );
    const currentRound = currentRoundResult?.max_round || 0;
    const totalRounds = tournament.mapSequence?.length || tournament.maps.length;

    let roundStatus: RoundStatus | undefined;
    if (currentRound > 0) {
      const matches = await db.queryAsync<DbMatchRow>(
        'SELECT * FROM matches WHERE tournament_id = ? AND round = ?',
        [tournamentId, currentRound]
      );

      const completed = matches.filter((m) => m.status === 'completed').length;
      const mapSequence = tournament.mapSequence || tournament.maps;
      const map = currentRound <= mapSequence.length ? mapSequence[currentRound - 1] : '';

      roundStatus = {
        roundNumber: currentRound,
        totalMatches: matches.length,
        completedMatches: completed,
        pendingMatches: matches.length - completed,
        isComplete: completed === matches.length && matches.length > 0,
        map,
      };
    }

    return {
      tournament,
      leaderboard,
      currentRound,
      totalRounds,
      roundStatus,
      liveMatchCount,
    };
  }

  // Standard tournament (single_elimination / double_elimination / round_robin / swiss):
  // build the public tournament object (via the shared row helper so no column
  // is dropped), team standings, and player leaderboard.
  const baseTournament: TournamentResponse = tournamentRowToResponse(row);
  const teamIds = baseTournament.teamIds;
  baseTournament.teams = [];

  // Team standings for this tournament
  let teams: TeamLeaderboardEntry[] = [];
  if (teamIds.length > 0) {
    const placeholders = teamIds.map(() => '?').join(',');
    const teamRows = await db.queryAsync<DbTeamRow>(
      `SELECT id, name, tag FROM teams WHERE id IN (${placeholders})`,
      teamIds
    );

    // Get all completed matches for win/loss counts
    const matches = await db.queryAsync<DbMatchRow>(
      'SELECT team1_id, team2_id, winner_id, round FROM matches WHERE tournament_id = ? AND status = ?',
      [row.id, 'completed']
    );

    teams = teamRows.map((team) => {
      const played = matches.filter((m) => m.team1_id === team.id || m.team2_id === team.id);
      const wins = played.filter((m) => m.winner_id === team.id).length;
      const losses = played.filter((m) => m.winner_id && m.winner_id !== team.id).length;
      const matchCount = played.length;
      const winRate = matchCount > 0 ? wins / matchCount : 0;

      return {
        teamId: team.id,
        name: team.name,
        tag: team.tag ?? null,
        matchWins: wins,
        matchLosses: losses,
        matchCount,
        winRate,
      };
    });

    if (row.type === 'swiss') {
      // Same standings (and order) the Swiss pairing uses.
      const standings = await getSwissStandingEntries(row.id);
      const byTeam = new Map(teams.map((t) => [t.teamId, t]));
      teams = standings.flatMap((s) => {
        const team = byTeam.get(s.teamId);
        if (!team) return [];
        return [
          {
            ...team,
            matchWins: s.wins,
            matchLosses: s.losses,
            rank: s.rank,
            buchholz: s.buchholz,
            roundDiff: s.roundDiff,
          },
        ];
      });
    } else if (row.type === 'round_robin') {
      // Same standings (and order) the bracket and the champion use.
      const standings = await getRoundRobinStandingEntries(row.id);
      const byTeam = new Map(teams.map((t) => [t.teamId, t]));
      teams = standings.flatMap((s) => {
        const team = byTeam.get(s.teamId);
        if (!team) return [];
        return [{ ...team, rank: s.rank, roundDiff: s.roundDiff }];
      });
    } else {
      // Sort teams by wins desc, then name
      teams.sort((a, b) => {
        if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins;
        return a.name.localeCompare(b.name);
      });
    }

    baseTournament.teams = teamRows.map((t) => ({
      id: t.id,
      name: t.name,
      tag: t.tag ?? undefined,
    }));
  }

  // Player leaderboard for this tournament, sorted by current ELO
  const playerRows = await db.queryAsync<{
    player_id: string;
    name: string;
    avatar_url: string | null;
    current_elo: number;
    starting_elo: number;
    match_wins: number;
    match_losses: number;
    match_count: number;
    total_kills: number;
    total_deaths: number;
    total_assists: number;
    total_damage: number;
    total_rounds: number;
  }>(
    `
      SELECT
        p.id as player_id,
        p.name,
        p.avatar_url,
        p.current_elo,
        p.starting_elo,
        SUM(CASE WHEN pms.won_match THEN 1 ELSE 0 END) as match_wins,
        SUM(CASE WHEN pms.won_match THEN 0 ELSE 1 END) as match_losses,
        COUNT(DISTINCT pms.match_slug) as match_count,
        COALESCE(SUM(pms.kills), 0) as total_kills,
        COALESCE(SUM(pms.deaths), 0) as total_deaths,
        COALESCE(SUM(pms.assists), 0) as total_assists,
        COALESCE(SUM(pms.total_damage), 0) as total_damage,
        COALESCE(SUM(pms.rounds_played), 0) as total_rounds
      FROM player_match_stats pms
      JOIN matches m ON pms.match_slug = m.slug
      JOIN players p ON p.id = pms.player_id
      WHERE m.tournament_id = ?
      GROUP BY p.id, p.name, p.avatar_url, p.current_elo, p.starting_elo
    `,
    [row.id]
  );

  // Aggregate ELO change for this tournament only, treating the first recorded
  // post-match rating as the "starting point" to avoid huge negative jumps
  // from initial calibration (e.g. 3000 -> realistic value).
  const ratingRows = await db.queryAsync<{
    player_id: string;
    elo_after: number;
    created_at: number;
  }>(
    `
      SELECT prh.player_id, prh.elo_after, prh.created_at
      FROM player_rating_history prh
      JOIN matches m ON prh.match_slug = m.slug
      WHERE m.tournament_id = ?
      ORDER BY prh.player_id, prh.created_at ASC
    `,
    [row.id]
  );

  const eloChangeMap = new Map<string, number>();
  for (const r of ratingRows) {
    const existing = eloChangeMap.get(r.player_id);
    if (existing === undefined) {
      // First record for this player: initialize with [firstAfter, lastAfter]
      eloChangeMap.set(r.player_id, NaN); // placeholder, will recalc later
    }
  }
  // Compute per-player first/last elo_after
  const firstLast = new Map<string, { first: number; last: number }>();
  for (const r of ratingRows) {
    const current = firstLast.get(r.player_id);
    if (!current) {
      firstLast.set(r.player_id, { first: r.elo_after, last: r.elo_after });
    } else {
      current.last = r.elo_after;
    }
  }
  firstLast.forEach((v, playerId) => {
    eloChangeMap.set(playerId, v.last - v.first);
  });

  const leaderboard: PlayerLeaderboardEntry[] = playerRows.map((pr) => {
    const winRate = pr.match_count > 0 ? pr.match_wins / pr.match_count : 0;
    const averageAdr = pr.total_rounds > 0 ? pr.total_damage / pr.total_rounds : undefined;

    return {
      playerId: pr.player_id,
      name: pr.name,
      avatar: pr.avatar_url || undefined,
      currentElo: pr.current_elo,
      startingElo: pr.starting_elo,
      matchWins: pr.match_wins,
      matchLosses: pr.match_losses,
      winRate,
      eloChange: eloChangeMap.get(pr.player_id) ?? 0,
      averageAdr: averageAdr ? Math.round(averageAdr * 100) / 100 : undefined,
    };
  });

  // Sort players by ELO (desc), then wins, then ADR
  leaderboard.sort((a, b) => {
    if (b.currentElo !== a.currentElo) return b.currentElo - a.currentElo;
    if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins;
    const adrA = a.averageAdr ?? 0;
    const adrB = b.averageAdr ?? 0;
    return adrB - adrA;
  });

  // For standard brackets, derive current/total rounds from matches only
  const currentRoundResult = await db.queryOneAsync<{ max_round: number }>(
    'SELECT MAX(round) as max_round FROM matches WHERE tournament_id = ?',
    [row.id]
  );
  const currentRound = currentRoundResult?.max_round || 0;
  const totalRounds = currentRound || 0;

  return {
    tournament: baseTournament,
    leaderboard,
    currentRound,
    totalRounds,
    roundStatus: undefined,
    teams,
    liveMatchCount,
  };
}

/**
 * Get shuffle tournament (helper)
 */
async function getShuffleTournament(tournamentId: number): Promise<TournamentResponse | null> {
  const row = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
    tournamentId,
  ]);

  if (!row || row.type !== 'shuffle') {
    return null;
  }

  return {
    ...tournamentRowToResponse(row),
    type: 'shuffle',
    // Shuffle teams are built from registered players; 5v5 unless configured.
    teamSize: row.team_size || 5,
  };
}
