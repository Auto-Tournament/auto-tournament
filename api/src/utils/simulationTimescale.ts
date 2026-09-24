/**
 * Allowed range for `simulation_timescale` (Auto Tournament CS2's `host_timescale` in
 * simulation mode). Simulation only exists for testing, so the ceiling is set by
 * how fast a bracket can usefully be played through rather than by bot realism;
 * the Settings page warns about odd bot behaviour above 2×.
 *
 * Setting `host_timescale` over RCON on a live match does not help: the plugin
 * keeps re-applying the value from the match config, so the speed has to be
 * right when the match is loaded.
 */
export const SIMULATION_TIMESCALE_MIN = 0.1;
export const SIMULATION_TIMESCALE_MAX = 10;

export function clampSimulationTimescale(value: number): number {
  return Math.min(SIMULATION_TIMESCALE_MAX, Math.max(SIMULATION_TIMESCALE_MIN, value));
}
