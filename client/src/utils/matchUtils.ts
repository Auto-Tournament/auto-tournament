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
 * Get the MUI color for a match status
 */
export const getStatusColor = (
  status: string,
  walkover: boolean = false
): 'error' | 'warning' | 'info' | 'success' | 'default' => {
  if (walkover) return 'warning';

  switch (status) {
    case 'live':
      return 'error';
    case 'ready':
      return 'info';
    case 'completed':
      return 'success';
    default:
      return 'default';
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
