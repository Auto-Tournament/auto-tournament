import { test, expect } from '@playwright/test';
import {
  clampSimulationTimescale,
  SIMULATION_TIMESCALE_MAX,
  SIMULATION_TIMESCALE_MIN,
} from '../../api/src/utils/simulationTimescale';

/**
 * Range of the simulation timescale: 4× is Ready Up's ceiling, so the site
 * offers no more (10× ran as 4×). The same clamp guards the settings route, the
 * stored value and the value read back into match configs.
 *
 * @tag api
 */
test.describe('Simulation timescale clamp', () => {
  test("caps at Ready Up's 4×", () => {
    expect(clampSimulationTimescale(4)).toBe(4);
    expect(clampSimulationTimescale(10)).toBe(4);
  });

  test('clamps to the configured range', () => {
    expect(SIMULATION_TIMESCALE_MIN).toBe(0.1);
    expect(SIMULATION_TIMESCALE_MAX).toBe(4);
    expect(clampSimulationTimescale(50)).toBe(4);
    expect(clampSimulationTimescale(0)).toBe(0.1);
    expect(clampSimulationTimescale(-3)).toBe(0.1);
  });
});
