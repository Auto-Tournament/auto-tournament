/**
 * Team Balancing Service
 * Creates balanced teams of players based on their ELO/OpenSkill ratings
 */

import { ordinal } from 'openskill';
import { eloToOpenSkill } from './ratingService';
import { playerService, type PlayerRecord } from './playerService';
import { log } from '../utils/logger';

export interface BalancedTeam {
  players: PlayerRecord[];
  totalELO: number;
  averageELO: number;
  totalOrdinal: number; // OpenSkill ordinal sum
  averageOrdinal: number; // OpenSkill ordinal average
}

export interface TeamBalanceResult {
  teams: BalancedTeam[];
  balanceQuality: {
    averageELOVariance: number;
    averageOrdinalVariance: number;
    maxELODifference: number;
    maxOrdinalDifference: number;
  };
}

/**
 * Balance players into teams of specified size
 * Uses greedy algorithm with optimization step
 * @param playerIds - Array of player Steam IDs
 * @param teamSize - Number of players per team (default: 5)
 * @param useOptimization - Whether to apply optimization step (default: true)
 * @returns Balanced teams
 */
export async function balanceTeams(
  playerIds: string[],
  teamSize: number = 5,
  useOptimization: boolean = true
): Promise<TeamBalanceResult> {
  if (playerIds.length === 0) {
    throw new Error('No players provided for team balancing');
  }

  if (playerIds.length < teamSize) {
    throw new Error(`Not enough players: ${playerIds.length} < ${teamSize}`);
  }

  // Fetch all players
  const players = await playerService.getPlayersByIds(playerIds);
  if (players.length !== playerIds.length) {
    const missing = playerIds.filter((id) => !players.find((p) => p.id === id));
    throw new Error(`Some players not found: ${missing.join(', ')}`);
  }

  // Calculate number of teams
  const numTeams = Math.floor(players.length / teamSize);
  const remainingPlayers = players.length % teamSize;

  if (remainingPlayers > 0) {
    log.warn(`Odd number of players: ${players.length}. ${remainingPlayers} player(s) will sit out.`);
  }

  // Initial assignment using greedy algorithm
  let teams = greedyTeamAssignment(players, numTeams, teamSize);

  // Apply optimization step if enabled
  if (useOptimization && numTeams > 1) {
    teams = optimizeTeamBalance(teams, teamSize);
  }

  // Calculate balance quality metrics
  const balanceQuality = calculateBalanceQuality(teams);

  log.success(`Balanced ${players.length} players into ${teams.length} teams`, {
    averageELOVariance: balanceQuality.averageELOVariance.toFixed(2),
    maxELODifference: balanceQuality.maxELODifference,
  });

  return {
    teams,
    balanceQuality,
  };
}

/**
 * Greedy algorithm: Assign players to teams with lowest average ELO
 */
function greedyTeamAssignment(
  players: PlayerRecord[],
  numTeams: number,
  teamSize: number
): BalancedTeam[] {
  // Sort players by ELO (descending) - using ordinal for better accuracy
  const playersWithOrdinal = players.map((p) => {
    const rating = eloToOpenSkill(p.current_elo, p.match_count);
    const ordinalValue = ordinal(rating);
    return {
      player: p,
      ordinal: ordinalValue,
    };
  });

  playersWithOrdinal.sort((a, b) => b.ordinal - a.ordinal);

  // Initialize teams
  const teams: BalancedTeam[] = Array.from({ length: numTeams }, () => ({
    players: [],
    totalELO: 0,
    averageELO: 0,
    totalOrdinal: 0,
    averageOrdinal: 0,
  }));

  // Assign players greedily
  for (const { player, ordinal: ordinalValue } of playersWithOrdinal) {
    // Find team with lowest average ordinal that isn't full
    let bestTeam: BalancedTeam | null = null;
    let minAvgOrdinal = Infinity;

    for (const team of teams) {
      if (team.players.length >= teamSize) continue;

      const currentAvg =
        team.players.length > 0 ? team.totalOrdinal / team.players.length : 0;

      if (currentAvg < minAvgOrdinal) {
        minAvgOrdinal = currentAvg;
        bestTeam = team;
      }
    }

    if (!bestTeam) {
      // All teams are full, skip remaining players
      break;
    }

    // Add player to team
    bestTeam.players.push(player);
    bestTeam.totalELO += player.current_elo;
    bestTeam.averageELO = bestTeam.totalELO / bestTeam.players.length;
    bestTeam.totalOrdinal += ordinalValue;
    bestTeam.averageOrdinal = bestTeam.totalOrdinal / bestTeam.players.length;
  }

  return teams.filter((team) => team.players.length > 0);
}

/**
 * Optimization step: Swap players between teams to improve balance
 * Based on Xwoe matchmaking algorithm approach
 */
function optimizeTeamBalance(teams: BalancedTeam[], _teamSize: number, maxIterations: number = 10): BalancedTeam[] {
  let iterations = 0;
  let improved = true;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    // Calculate current variance
    const averages = teams.map((t) => t.averageOrdinal);
    const currentVariance = calculateVariance(averages);

    // Try swapping players between teams
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const team1 = teams[i];
        const team2 = teams[j];

        // Try swapping each player from team1 with each player from team2
        for (const player1 of team1.players) {
          for (const player2 of team2.players) {
            // Calculate new averages if swapped
            const rating1 = eloToOpenSkill(player1.current_elo, player1.match_count);
            const rating2 = eloToOpenSkill(player2.current_elo, player2.match_count);
            const ordinal1 = ordinal(rating1);
            const ordinal2 = ordinal(rating2);

            const newTeam1Avg =
              (team1.totalOrdinal - ordinal1 + ordinal2) / team1.players.length;
            const newTeam2Avg =
              (team2.totalOrdinal - ordinal2 + ordinal1) / team2.players.length;

            const newAverages = [...averages];
            newAverages[i] = newTeam1Avg;
            newAverages[j] = newTeam2Avg;
            const newVariance = calculateVariance(newAverages);

            // If swap improves balance, apply it
            if (newVariance < currentVariance) {
              // Swap players
              const player1Index = team1.players.indexOf(player1);
              const player2Index = team2.players.indexOf(player2);

              team1.players[player1Index] = player2;
              team2.players[player2Index] = player1;

              // Update totals
              team1.totalELO = team1.totalELO - player1.current_elo + player2.current_elo;
              team1.totalOrdinal = team1.totalOrdinal - ordinal1 + ordinal2;
              team1.averageELO = team1.totalELO / team1.players.length;
              team1.averageOrdinal = team1.totalOrdinal / team1.players.length;

              team2.totalELO = team2.totalELO - player2.current_elo + player1.current_elo;
              team2.totalOrdinal = team2.totalOrdinal - ordinal2 + ordinal1;
              team2.averageELO = team2.totalELO / team2.players.length;
              team2.averageOrdinal = team2.totalOrdinal / team2.players.length;

              improved = true;
              break; // Break inner loop, continue with next iteration
            }
          }
          if (improved) break; // Break outer loop
        }
        if (improved) break; // Break team loop
      }
      if (improved) break; // Break main loop
    }
  }

  return teams;
}

/**
 * Calculate variance of an array of values
 */
function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate balance quality metrics
 */
function calculateBalanceQuality(teams: BalancedTeam[]): TeamBalanceResult['balanceQuality'] {
  if (teams.length === 0) {
    return {
      averageELOVariance: 0,
      averageOrdinalVariance: 0,
      maxELODifference: 0,
      maxOrdinalDifference: 0,
    };
  }

  const eloAverages = teams.map((t) => t.averageELO);
  const ordinalAverages = teams.map((t) => t.averageOrdinal);

  const eloVariance = calculateVariance(eloAverages);
  const ordinalVariance = calculateVariance(ordinalAverages);

  const maxELO = Math.max(...eloAverages);
  const minELO = Math.min(...eloAverages);
  const maxOrdinal = Math.max(...ordinalAverages);
  const minOrdinal = Math.min(...ordinalAverages);

  return {
    averageELOVariance: eloVariance,
    averageOrdinalVariance: ordinalVariance,
    maxELODifference: maxELO - minELO,
    maxOrdinalDifference: maxOrdinal - minOrdinal,
  };
}

/**
 * Handle odd number of players
 * Returns teams and list of players who will sit out
 */
export async function balanceTeamsWithOddPlayers(
  playerIds: string[],
  teamSize: number = 5
): Promise<{
  teams: BalancedTeam[];
  sittingOut: PlayerRecord[];
  balanceQuality: TeamBalanceResult['balanceQuality'];
}> {
  // const numTeams = Math.floor(playerIds.length / teamSize); // Not used in this function
  const remaining = playerIds.length % teamSize;

  if (remaining === 0) {
    const result = await balanceTeams(playerIds, teamSize);
    return {
      teams: result.teams,
      sittingOut: [],
      balanceQuality: result.balanceQuality,
    };
  }

  // Get all players
  const players = await playerService.getPlayersByIds(playerIds);

  // Sort by ELO and select players to sit out (lowest ELO players)
  const playersWithOrdinal = players.map((p) => {
    const rating = eloToOpenSkill(p.current_elo, p.match_count);
    const ordinalValue = ordinal(rating);
    return { player: p, ordinal: ordinalValue };
  });

  playersWithOrdinal.sort((a, b) => a.ordinal - b.ordinal); // Sort ascending (lowest first)

  // Select players to sit out (rotate each round in future)
  const sittingOut = playersWithOrdinal.slice(0, remaining).map((p) => p.player);
  const playingIds = playersWithOrdinal.slice(remaining).map((p) => p.player.id);

  // Balance remaining players
  const result = await balanceTeams(playingIds, teamSize);

  return {
    teams: result.teams,
    sittingOut,
    balanceQuality: result.balanceQuality,
  };
}

