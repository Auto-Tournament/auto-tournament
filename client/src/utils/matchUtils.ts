/**
 * Utility functions for match-related data formatting and calculations
 */

import i18n from '../i18n';

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
 * Calculate if a match is in overtime and which overtime number
 * @returns null if not in overtime, or the overtime number (1, 2, 3, etc.)
 */
export const calculateOvertimeNumber = (
  team1Score: number,
  team2Score: number,
  maxRounds: number | undefined,
  overtimeRoundsPerSegment: number = 6 // Default MR3 = 6 rounds per OT segment
): number | null => {
  if (!maxRounds || maxRounds <= 0) return null;

  const totalRounds = team1Score + team2Score;
  const isTied = team1Score === team2Score;
  const isPastRegulation = totalRounds >= maxRounds;

  // Match is in overtime if: past regulation AND scores are tied
  if (!isPastRegulation || !isTied) return null;

  const overtimeRounds = totalRounds - maxRounds;
  const overtimeNumber = Math.floor(overtimeRounds / overtimeRoundsPerSegment) + 1;

  return overtimeNumber;
};

/**
 * A Swiss match for a round that has not been paired yet. Its teams are picked
 * from the standings once the previous round is complete, so it is waiting for
 * pairing rather than for a veto.
 */
export const isUnpairedSwissMatch = (match: {
  slug?: string;
  status: string;
  team1?: unknown;
  team2?: unknown;
}): boolean =>
  match.status === 'pending' &&
  !match.team1 &&
  !match.team2 &&
  /^swiss-r\d+m\d+$/.test(match.slug ?? '');

export const waitingForPairingLabel = (): string =>
  i18n.t('matchesPage.statusLabel.waitingForPairing');

/**
 * Get a human-readable label for a match status
 */
export const getStatusLabel = (
  status: string,
  walkover: boolean = false,
  vetoCompleted?: boolean,
  tournamentStarted?: boolean,
  hasServer?: boolean,
  team1Score?: number,
  team2Score?: number,
  maxRounds?: number,
  overtimeRoundsPerSegment?: number
): string => {
  const label = (key: string, options?: Record<string, unknown>) =>
    i18n.t(`matchesPage.statusLabel.${key}`, options);

  if (walkover) return label('walkover');

  switch (status) {
    case 'pending':
      if (tournamentStarted === false) return label('waitingForTournament');
      // If veto is completed but no server, show waiting for server
      if (vetoCompleted === true && hasServer === false) return label('waitingForServer');
      return label('vetoPending');
    case 'ready':
      if (tournamentStarted === false) return label('waitingForTournament');
      if (vetoCompleted === false) return label('mapVeto');
      // Only a match that actually has a server is "server allocated"; a
      // waiting match without one used to show it in the bracket list view.
      if (hasServer !== true) return label('waitingForServer');
      // Veto complete and server assigned – match is queued to be loaded on the server.
      return label('serverAllocated');
    case 'loaded':
      return label('warmup');
    case 'live':
      // Check if in overtime
      if (
        typeof team1Score === 'number' &&
        typeof team2Score === 'number' &&
        maxRounds
      ) {
        const overtimeNumber = calculateOvertimeNumber(
          team1Score,
          team2Score,
          maxRounds,
          overtimeRoundsPerSegment
        );
        if (overtimeNumber !== null) {
          return label('overtime', { n: overtimeNumber });
        }
      }
      return label('live');
    case 'completed':
      return label('completed');
    case 'cancelled':
      return label('cancelled');
    case 'needs_decision':
      return label('needsDecision');
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
  tournamentStarted?: boolean,
  hasServer?: boolean,
  team1Score?: number,
  team2Score?: number,
  maxRounds?: number,
  overtimeRoundsPerSegment?: number
): string => {
  if (walkover) return 'WALKOVER';

  const expected = expectedPlayers || 10; // Default to 10 if not provided

  switch (status) {
    case 'pending':
      // Match is pending - check if tournament has started
      if (tournamentStarted === false) {
        // If a server is already assigned, this is most likely a manual or
        // non‑bracket context. Avoid tournament‑specific copy and show a
        // neutral initialization label instead.
        if (hasServer) {
          return 'Initializing match...';
        }
        return 'Waiting for tournament to start...';
      }
      // If veto is completed but no server, show waiting for server
      if (vetoCompleted === true && hasServer === false) {
        return 'Veto complete - Waiting for server assignment...';
      }
      // Tournament started, match pending means waiting for veto
      return 'Waiting for map veto to begin...';
    case 'ready':
      // Match is ready - could be in veto or waiting for server
      if (tournamentStarted === false) {
        if (hasServer) {
          return 'Initializing match...';
        }
        return 'Waiting for tournament to start...';
      }
      if (vetoCompleted === false) {
        return 'Teams voting for maps...';
      }
      if (vetoCompleted === true && hasServer === false) {
        return 'Veto complete - Waiting for server assignment...';
      }
      // Veto is complete and a server has been assigned; the match will be
      // loaded shortly and move into warmup on that server.
      return 'Veto complete - Server allocated, waiting to load match...';
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
      // Check if in overtime
      if (
        typeof team1Score === 'number' &&
        typeof team2Score === 'number' &&
        maxRounds
      ) {
        const overtimeNumber = calculateOvertimeNumber(
          team1Score,
          team2Score,
          maxRounds,
          overtimeRoundsPerSegment
        );
        if (overtimeNumber !== null) {
          return `Overtime #${overtimeNumber} in progress`;
        }
      }
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
  expectedPlayers?: number,
  tournamentStarted?: boolean
): string => {
  const expected = expectedPlayers || 10;

  switch (status) {
    case 'pending':
      if (tournamentStarted === false) {
        return 'Tournament has not started yet. Matches will become available once the bracket is launched.';
      }
      return 'Match is scheduled but not yet assigned to a server. Will be allocated when a server becomes available.';
    case 'ready':
      if (tournamentStarted === false) {
        return 'Tournament has not started yet. Teams cannot enter the veto phase until it begins.';
      }
      return 'Match is ready and waiting for veto or server assignment.';
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
      // Cards already show LIVE state; extra copy adds noise. Return empty string
      // so UIs can choose to hide this line for live matches.
      return '';
    case 'completed':
      return 'Match has finished. Winner has been determined and bracket has been updated.';
    case 'needs_decision':
      return 'Every map has been played but the series is level. An admin has to set the winner.';
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
    case 'cancelled':
      return 'error'; // Red - match was cancelled
    case 'needs_decision':
      return 'warning'; // Maps are over, an admin has to set the winner
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
    if (round === totalRounds) return i18n.t('rounds.finals');
    if (round === totalRounds - 1) return i18n.t('rounds.semifinals');
    if (round === totalRounds - 2) return i18n.t('rounds.quarterfinals');
  }

  return i18n.t('rounds.roundN', { n: round });
};

type BracketMatchRef = {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  bracket?: string | null;
};

/** 'WB' | 'LB' | 'GF' | 'GF_RESET' | 'SE' | null, falling back to the slug. */
export const getMatchBracket = (match: Pick<BracketMatchRef, 'slug' | 'bracket'>): string | null => {
  if (match.bracket) return match.bracket;
  if (match.slug === 'gf') return 'GF';
  if (match.slug?.startsWith('lb-')) return 'LB';
  return null;
};

/** Chronological stage; mirrors queueStage in api/src/utils/allocationQueue.ts. */
const matchStage = (match: BracketMatchRef): number => {
  if (match.round <= 0) return -1;
  const bracket = getMatchBracket(match);
  if (bracket === 'GF') return 100000;
  if (bracket === 'GF_RESET') return 100001;
  if (bracket === 'LB') return match.round + 1;
  return 2 * match.round - 1;
};

const bracketRank = (match: BracketMatchRef): number => {
  const bracket = getMatchBracket(match);
  return bracket === 'LB' ? 1 : bracket === 'GF' ? 2 : bracket === 'GF_RESET' ? 3 : 0;
};

/**
 * Display / queue order: stage, upper before lower bracket, round, match
 * number, id. Double elimination numbers upper and lower rounds separately and
 * the grand final is round 1 match 1, so plain round order numbered it #3.
 */
export const compareMatchOrder = (a: BracketMatchRef, b: BracketMatchRef): number =>
  matchStage(a) - matchStage(b) ||
  bracketRank(a) - bracketRank(b) ||
  a.round - b.round ||
  a.matchNumber - b.matchNumber ||
  a.id - b.id;

/** 1-based position of `match` among `all` in display order. */
export const getGlobalMatchNumber = (match: BracketMatchRef, all: BracketMatchRef[]): number =>
  [...all].sort(compareMatchOrder).findIndex((m) => m.id === match.id) + 1;

/**
 * Bracket-aware label for double-elimination matches: "UB R1 M1", "LB R2 M1",
 * "Grand Final". Null for every other match, which keeps "Match #n".
 */
export const getBracketMatchLabel = (
  match: Pick<BracketMatchRef, 'slug' | 'bracket' | 'round' | 'matchNumber'>
): string | null => {
  const bracket = getMatchBracket(match);
  const params = { round: match.round, match: match.matchNumber };
  switch (bracket) {
    case 'WB':
      return i18n.t('matchesPage.matchLabel.upper', params);
    case 'LB':
      return i18n.t('matchesPage.matchLabel.lower', params);
    case 'GF':
      return i18n.t('matchesPage.matchLabel.grandFinal');
    case 'GF_RESET':
      return i18n.t('matchesPage.matchLabel.grandFinalReset');
    default:
      return null;
  }
};
