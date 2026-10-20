/**
 * About how long a tournament takes, for the setup summary. Matches of one
 * round run side by side, as many at once as there are servers; a round waits
 * for the one before it. Labelled "about" in the UI; never a promise.
 */

/** Maps a series plays on average (a Bo3 often ends 2-0). */
const AVERAGE_MAPS: Record<string, number> = { bo1: 1, bo3: 2.5, bo5: 4 };

export interface DurationInput {
  matches: number;
  /** Rounds that must be played one after another, or null when unknown. */
  rounds: number | null;
  /** Servers to play on; 0 = no limit (a game without servers). */
  servers: number;
  format: string;
  /** One map, warmup included. */
  minutesPerMap: number;
  /** Between one round's matches and the next's. */
  breakMinutes: number;
}

/** Minutes, or null when there is nothing to estimate. */
export function estimateDurationMinutes(input: DurationInput): number | null {
  const { matches, servers, minutesPerMap } = input;
  if (matches < 1 || minutesPerMap <= 0) return null;
  const waves = Math.max(input.rounds ?? 1, servers > 0 ? Math.ceil(matches / servers) : 1);
  const perWave = (AVERAGE_MAPS[input.format] ?? 1) * minutesPerMap;
  return Math.round(waves * perWave + (waves - 1) * Math.max(0, input.breakMinutes));
}
