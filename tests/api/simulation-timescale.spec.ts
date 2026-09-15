import { test, expect } from '@playwright/test';
import {
  clampSimulationTimescale,
  SIMULATION_TIMESCALE_MAX,
  SIMULATION_TIMESCALE_MIN,
} from '../../api/src/utils/simulationTimescale';

/**
 * Range of the simulation timescale. The ceiling used to be 4×, which made a
 * simulated Bo3 bracket take hours; simulation is test-only, so it now goes to
 * 10×. The same clamp guards the settings route, the stored value and the value
 * read back into match configs.
 *
 * @tag api
 */
test.describe('Simulation timescale clamp', () => {
  test('allows speeds above the old 4× ceiling', () => {
    expect(clampSimulationTimescale(8)).toBe(8);
    expect(clampSimulationTimescale(10)).toBe(10);
  });

  test('clamps to the configured range', () => {
    expect(SIMULATION_TIMESCALE_MIN).toBe(0.1);
    expect(SIMULATION_TIMESCALE_MAX).toBe(10);
    expect(clampSimulationTimescale(50)).toBe(10);
    expect(clampSimulationTimescale(0)).toBe(0.1);
    expect(clampSimulationTimescale(-3)).toBe(0.1);
  });
});
