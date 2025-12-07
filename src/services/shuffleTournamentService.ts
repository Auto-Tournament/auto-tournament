/**
 * Shuffle Tournament Service
 * Handles shuffle tournament creation, round generation, and automatic progression
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { balanceTeams, type BalancedTeam } from './teamBalancingService';
import { playerService, type PlayerRecord } from './playerService';
import { teamService } from './teamService';
import { generateMatchConfig } from './matchConfigBuilder';
import type { TournamentResponse } from '../types/tournament.types';
import type { DbMatchRow } from '../types/database.types';
import type { Player } from '../types/team.types';

export interface ShuffleTournamentConfig {
  name: string;
  mapSequence: string[]; // Maps in order (number of maps = number of rounds)
  teamSize: number; // Number of players per team, default: 5
  roundLimitType: 'first_to_13' | 'max_rounds';
  maxRounds?: number; // Required if roundLimitType is 'max_rounds', default: 24
  overtimeMode: 'enabled' | 'disabled';
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
  config: ShuffleTournamentConfig
): Promise<TournamentResponse> {
  const now = Math.floor(Date.now() / 1000);

  // Validate config
  if (!config.name || config.name.trim() === '') {
    throw new Error('Tournament name is required. Please provide a name for your shuffle tournament.');
  }

  if (!config.mapSequence || config.mapSequence.length === 0) {
    throw new Error(
      'At least one map must be selected. ' +
        'The number of maps you select determines the number of rounds in the tournament.'
    );
  }

  if (config.roundLimitType === 'max_rounds' && (!config.maxRounds || config.maxRounds < 1)) {
    throw new Error(
      'Invalid max rounds value. When using "Max Rounds" round limit type, ' +
        'you must specify a maximum number of rounds (minimum: 1).'
    );
  }

  // Delete existing tournament (only one at a time)
  await db.execAsync('DELETE FROM tournament WHERE id = 1');

  // Create tournament
  await db.insertAsync('tournament', {
    id: 1,
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
    round_limit_type: config.roundLimitType,
    max_rounds: config.maxRounds || 24,
    overtime_mode: config.overtimeMode || 'enabled',
    elo_template_id: config.eloTemplateId || null,
    created_at: now,
    updated_at: now,
  });

  log.success(`Shuffle tournament created: ${config.name}`, {
    rounds: config.mapSequence.length,
    roundLimitType: config.roundLimitType,
    overtimeMode: config.overtimeMode,
  });

  const tournament = await getShuffleTournament();
  if (!tournament) {
    throw new Error('Failed to create tournament');
  }

  return tournament;
}

/**
 * Register players to shuffle tournament
 * Players are automatically whitelisted for matches
 */
export async function registerPlayers(playerIds: string[]): Promise<{
  registered: number;
  errors: Array<{ playerId: string; error: string }>;
}> {
  const tournament = await getShuffleTournament();
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
          tournament_id: 1,
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
export async function getRegisteredPlayers(): Promise<PlayerRecord[]> {
  const playerIds = await db.queryAsync<{ player_id: string }>(
    'SELECT player_id FROM shuffle_tournament_players WHERE tournament_id = 1 ORDER BY registered_at'
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
export async function setRegisteredPlayers(playerIds: string[]): Promise<{
  registered: number;
  unregistered: number;
  errors: Array<{ playerId: string; error: string }>;
}> {
  const tournament = await getShuffleTournament();
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
    'SELECT player_id FROM shuffle_tournament_players WHERE tournament_id = 1'
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
      await db.deleteAsync('shuffle_tournament_players', 'tournament_id = ? AND player_id = ?', [1, playerId]);
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
        tournament_id: 1,
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
export async function generateRoundMatches(roundNumber: number): Promise<{
  matches: DbMatchRow[];
  teams: BalancedTeam[];
}> {
  const tournament = await getShuffleTournament();
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
  const players = await getRegisteredPlayers();
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
      'SELECT * FROM matches WHERE tournament_id = 1 AND round = ?',
      [roundNumber - 1]
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

  // Create matches for each team pair
  for (let matchNum = 0; matchNum < teams.length / 2; matchNum++) {
    const team1Index = matchNum * 2;
    const team2Index = team1Index + 1;

    if (team2Index >= teams.length) {
      // Odd number of teams - handle rotation
      const lastTeam = teams[team1Index];
      const lastTeamPlayerIds = lastTeam.players.map((p) => p.id);

      // Check if any of these players should be rotated in (they sat out last round)
      const shouldRotateIn = lastTeamPlayerIds.some(
        (id) => !playersWhoPlayedLastRound.includes(id)
      );

      if (shouldRotateIn && roundNumber > 1) {
        // Try to swap with a player from an existing match who played last round
        // Find a player in an existing match who should sit out (played last round)
        let swapped = false;
        for (const match of matches) {
          const existingTeam1 = await teamService.getTeamById(match.team1_id || '');
          const existingTeam2 = await teamService.getTeamById(match.team2_id || '');

          for (const existingTeam of [existingTeam1, existingTeam2].filter(Boolean)) {
            if (!existingTeam) continue;

            for (const existingPlayer of existingTeam.players) {
              // If this player played last round and we have someone who sat out, swap them
              if (playersWhoPlayedLastRound.includes(existingPlayer.steamId)) {
                // Candidates to rotate in are players from the leftover team who did NOT play last round
                const candidateIds = lastTeamPlayerIds.filter(
                  (id) => !playersWhoPlayedLastRound.includes(id)
                );

                if (candidateIds.length > 0) {
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

                  if (bestCandidateId) {
                    const candidateRecord = players.find((p) => p.id === bestCandidateId);
                    if (candidateRecord) {
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

                      // Update match config
                      if (!match.slug) continue;
                      const matchSlug = match.slug;
                      const updatedMatch = await db.queryOneAsync<DbMatchRow>(
                        'SELECT * FROM matches WHERE slug = ?',
                        [matchSlug]
                      );
                      if (updatedMatch && updatedMatch.config) {
                        const matchConfig = JSON.parse(updatedMatch.config);
                        if (existingTeam.id === match.team1_id) {
                          matchConfig.team1.players = updatedPlayers.reduce((acc, p) => {
                            acc[p.steamId] = p.name;
                            return acc;
                          }, {} as Record<string, string>);
                        } else {
                          matchConfig.team2.players = updatedPlayers.reduce((acc, p) => {
                            acc[p.steamId] = p.name;
                            return acc;
                          }, {} as Record<string, string>);
                        }
                        await db.updateAsync(
                          'matches',
                          { config: JSON.stringify(matchConfig) },
                          'id = ?',
                          [updatedMatch.id]
                        );
                      }

                      log.info(
                        `Rotated player ${candidateRecord.name} into match ${matchSlug}, removed ${existingPlayer.name}`
                      );
                      swapped = true;
                      break;
                    }
                  }
                }
              }
              if (swapped) break;
            }
            if (swapped) break;
          }
          if (swapped) break;
        }

        if (!swapped) {
          // Couldn't swap, log warning
          log.warn(`Odd number of teams in round ${roundNumber}, could not rotate players. Last team (${lastTeam.players.map(p => p.name).join(', ')}) will sit out.`);
        }
      } else {
        // First round or no rotation needed - skip last team
        log.info(`Odd number of teams in round ${roundNumber}, skipping last team (${lastTeam.players.map(p => p.name).join(', ')})`);
      }
      break;
    }

    const team1 = teams[team1Index];
    const team2 = teams[team2Index];

    // Create temporary teams
    const team1Id = `shuffle-r${roundNumber}-m${matchNum + 1}-team1`;
    const team2Id = `shuffle-r${roundNumber}-m${matchNum + 1}-team2`;

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
      name: `Round ${roundNumber} Match ${matchNum + 1} - Team 1`,
      tag: `R${roundNumber}M${matchNum + 1}T1`,
      players: JSON.stringify(team1Players),
      created_at: now,
      updated_at: now,
    });

    await db.insertAsync('teams', {
      id: team2Id,
      name: `Round ${roundNumber} Match ${matchNum + 1} - Team 2`,
      tag: `R${roundNumber}M${matchNum + 1}T2`,
      players: JSON.stringify(team2Players),
      created_at: now,
      updated_at: now,
    });

    createdTeams.push({ team1Id, team2Id });

    // Generate match config
    const matchSlug = `shuffle-r${roundNumber}-m${matchNum + 1}`;
    const config = await generateMatchConfig(tournament, team1Id, team2Id, matchSlug);

    // Update config for shuffle tournament specifics
    config.skip_veto = true; // No veto for shuffle
    config.maplist = [map]; // Single map for this round
    config.map_sides = [Math.random() > 0.5 ? 'team1_ct' : 'team2_ct']; // Random side

    // Create match
    await db.insertAsync('matches', {
      slug: matchSlug,
      tournament_id: 1,
      round: roundNumber,
      match_number: matchNum + 1,
      team1_id: team1Id,
      team2_id: team2Id,
      winner_id: null,
      server_id: null,
      config: JSON.stringify(config),
      status: 'pending',
      next_match_id: null,
      current_map: map,
      map_number: 0,
      created_at: now,
    });

    const match = await db.queryOneAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE slug = ?',
      [matchSlug]
    );

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
export async function checkRoundCompletion(roundNumber: number): Promise<boolean> {
  const matches = await db.queryAsync<DbMatchRow>(
    'SELECT * FROM matches WHERE tournament_id = 1 AND round = ?',
    [roundNumber]
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
export async function advanceToNextRound(): Promise<{
  roundNumber: number;
  matches: DbMatchRow[];
} | null> {
  const tournament = await getShuffleTournament();
  if (!tournament) {
    throw new Error('No shuffle tournament found. Please create a shuffle tournament first.');
  }

  // Get current round (find highest round with matches)
  const currentRoundResult = await db.queryOneAsync<{ max_round: number }>(
    'SELECT MAX(round) as max_round FROM matches WHERE tournament_id = 1'
  );

  const currentRound = currentRoundResult?.max_round || 0;
  
  if (currentRound === 0) {
    log.info('No rounds have been generated yet. Starting from round 1.');
  }

  // Check if current round is complete
  if (currentRound > 0) {
    const isComplete = await checkRoundCompletion(currentRound);
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
      [1]
    );

    log.success(
      `Shuffle tournament completed! All ${mapSequence.length} round(s) finished. ` +
        `Final leaderboard available at /tournament/1/standings`
    );
    return null;
  }

  // Generate next round matches
  const result = await generateRoundMatches(nextRound);

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
      [1]
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
export async function getPlayerLeaderboard(): Promise<PlayerLeaderboardEntry[]> {
  const players = await getRegisteredPlayers();

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
           SELECT slug FROM matches WHERE tournament_id = 1
         )`,
        [player.id]
      );

      const wins = matches.filter((m) => m.won_match).length;
      const losses = matches.filter((m) => !m.won_match).length;
      const winRate = matches.length > 0 ? wins / matches.length : 0;
      const eloChange = player.current_elo - player.starting_elo;

      // Calculate average ADR
      const statsWithAdr = await db.queryAsync<{ adr: number }>(
        `SELECT adr FROM player_match_stats 
         WHERE player_id = ? AND match_slug IN (
           SELECT slug FROM matches WHERE tournament_id = 1
         ) AND adr IS NOT NULL`,
        [player.id]
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
 * Get tournament standings (public)
 */
export async function getTournamentStandings(): Promise<{
  tournament: TournamentResponse;
  leaderboard: PlayerLeaderboardEntry[];
  currentRound: number;
  totalRounds: number;
  roundStatus?: RoundStatus;
}> {
  const tournament = await getShuffleTournament();
  if (!tournament) {
    throw new Error('No shuffle tournament found');
  }

  const leaderboard = await getPlayerLeaderboard();

  // Get current round status
  const currentRoundResult = await db.queryOneAsync<{ max_round: number }>(
    'SELECT MAX(round) as max_round FROM matches WHERE tournament_id = 1'
  );
  const currentRound = currentRoundResult?.max_round || 0;
  const totalRounds = tournament.mapSequence?.length || tournament.maps.length;

  let roundStatus: RoundStatus | undefined;
  if (currentRound > 0) {
    const matches = await db.queryAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE tournament_id = 1 AND round = ?',
      [currentRound]
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
  };
}

/**
 * Get shuffle tournament (helper)
 */
async function getShuffleTournament(): Promise<TournamentResponse | null> {
  const row = await db.queryOneAsync<{
    id: number;
    name: string;
    type: string;
    format: string;
    status: string;
    maps: string;
    team_ids: string;
    settings: string;
    map_sequence?: string;
    team_size?: number;
    round_limit_type?: string;
    max_rounds?: number;
    overtime_mode?: string;
    elo_template_id?: string | null;
    created_at: number;
    updated_at: number;
    started_at?: number;
    completed_at?: number;
  }>('SELECT * FROM tournament WHERE id = 1');

  if (!row || row.type !== 'shuffle') {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    type: 'shuffle',
    format: row.format as 'bo1',
    status: row.status as TournamentResponse['status'],
    maps: JSON.parse(row.maps),
    teamIds: JSON.parse(row.team_ids),
    settings: JSON.parse(row.settings),
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    teams: [],
    mapSequence: row.map_sequence ? JSON.parse(row.map_sequence) : undefined,
    teamSize: row.team_size || 5,
    roundLimitType: (row.round_limit_type as 'first_to_13' | 'max_rounds') || undefined,
    maxRounds: row.max_rounds,
    overtimeMode: (row.overtime_mode as 'enabled' | 'disabled') || undefined,
    eloTemplateId: row.elo_template_id || undefined,
  } as TournamentResponse;
}

