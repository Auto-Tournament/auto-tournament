/**
 * Utility functions for match-related data formatting and calculations
 */

/**
 * Format a Unix timestamp to a localized date string
 */
export const formatDate = (timestamp: number): string => {
  return new Date(timestamp * 1000).toLocaleString();
};

/**
 * Format a duration in seconds to HH:MM:SS or MM:SS format
 */
export const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Get a human-readable label for a match status
 */
export const getStatusLabel = (
  status: string,
  walkover: boolean = false,
  vetoCompleted?: boolean,
  tournamentStarted?: boolean
): string => {
  if (walkover) return 'WALKOVER';

  switch (status) {
    case 'pending':
      if (tournamentStarted === false) return 'WAITING FOR TOURNAMENT START';
      return 'VETO PENDING';
    case 'ready':
      if (tournamentStarted === false) return 'WAITING FOR TOURNAMENT START';
      if (vetoCompleted === false) return 'MAP VETO';
      return 'READY';
    case 'loaded':
      return 'WARMUP';
    case 'live':
      return 'LIVE';
    case 'completed':
      return 'COMPLETED';
    default:
      return status.toUpperCase();
  }
};

/**
 * Get a detailed status label with player count information
 */
export const getDetailedStatusLabel = (
  status: string,
  playerCount?: number,
  expectedPlayers?: number,
  walkover: boolean = false,
  vetoCompleted?: boolean,
  tournamentStarted?: boolean
): string => {
  if (walkover) return 'WALKOVER';

  const expected = expectedPlayers || 10; // Default to 10 if not provided

  switch (status) {
    case 'pending':
      // Match is pending - check if tournament has started
      if (tournamentStarted === false) {
        return 'Waiting for tournament to start...';
      }
      // Tournament started, match pending means waiting for veto
      return 'Waiting for map veto to begin...';
    case 'ready':
      // Match is ready - could be in veto or waiting for server
      if (tournamentStarted === false) {
        return 'Waiting for tournament to start...';
      }
      if (vetoCompleted === false) {
        return 'Teams voting for maps...';
      }
      return 'Veto complete - Waiting for server...';
    case 'loaded':
      if (playerCount !== undefined) {
        if (playerCount === 0) {
          return `Server ready - Waiting for players (0/${expected})`;
        } else if (playerCount < expected) {
          return `Waiting for players (${playerCount}/${expected})`;
        } else {
          return `All players connected - Waiting for ready up`;
        }
      }
      return 'Server ready - Waiting for players';
    case 'live':
      return 'Match in progress';
    case 'completed':
      return 'Match completed';
    default:
      return status;
  }
};

/**
 * Get a detailed explanation for each match status
 */
export const getStatusExplanation = (
  status: string,
  playerCount?: number,
  expectedPlayers?: number
): string => {
  const expected = expectedPlayers || 10;

  switch (status) {
    case 'pending':
      return 'Match is scheduled but not yet assigned to a server. Will be allocated when a server becomes available.';
    case 'loaded':
      if (playerCount !== undefined) {
        if (playerCount === 0) {
          return `Match is loaded on the server and in warmup mode. Waiting for players to connect (0/${expected}).`;
        } else if (playerCount < expected) {
          return `Match is in warmup mode. ${playerCount} of ${expected} players connected. Waiting for all players to join and ready up.`;
        } else {
          return `All ${expected} players are connected! Waiting for teams to ready up to begin the match.`;
        }
      }
      return 'Match is loaded on the server and in warmup mode. Players should connect and ready up to start.';
    case 'live':
      if (playerCount !== undefined && playerCount > 0) {
        return `Match is currently in progress with ${playerCount}/${expected} players connected. Rounds are being played.`;
      }
      return 'Match is currently in progress. Players are competing and rounds are being played.';
    case 'completed':
      return 'Match has finished. Winner has been determined and bracket has been updated.';
    default:
      return '';
  }
};

/**
 * Get the MUI color for a match status
 */
export const getStatusColor = (
  status: string,
  walkover: boolean = false
): 'error' | 'warning' | 'info' | 'success' | 'default' => {
  if (walkover) return 'warning';

  switch (status) {
    case 'live':
      return 'error'; // Red - match is live
    case 'loaded':
      return 'info'; // Blue - server loaded, waiting for players
    case 'ready':
      return 'warning'; // Yellow/Orange - ready to start
    case 'completed':
      return 'success'; // Green - match finished
    default:
      return 'default'; // Gray - pending or unknown
  }
};

/**
 * Get a human-readable label for a tournament round
 * @param round The round number
 * @param totalRounds Optional total rounds for specific labels (Finals, Semi-Finals, etc.)
 */
export const getRoundLabel = (round: number, totalRounds?: number): string => {
  if (totalRounds) {
    if (round === totalRounds) return 'Finals';
    if (round === totalRounds - 1) return 'Semi-Finals';
    if (round === totalRounds - 2) return 'Quarter-Finals';
  }

  if (round === 1) return 'Round 1';
  return `Round ${round}`;
};
