/**
 * Allowed range for `simulation_timescale` (the server's `host_timescale` in
 * simulation mode). 4× is Ready Up's own ceiling (simulation_rules.h): a higher
 * value ran as 4× anyway, and a CS2 server is CPU-bound well before that. The
 * Settings page warns about odd bot behaviour above 2×.
 *
 * Setting `host_timescale` over RCON on a live match does not help: the plugin
 * keeps re-applying the value from the match config, so the speed has to be
 * right when the match is loaded.
 */
export const SIMULATION_TIMESCALE_MIN = 0.1;
export const SIMULATION_TIMESCALE_MAX = 4;

export function clampSimulationTimescale(value: number): number {
  return Math.min(SIMULATION_TIMESCALE_MAX, Math.max(SIMULATION_TIMESCALE_MIN, value));
}
