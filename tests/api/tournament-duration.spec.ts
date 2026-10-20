import { test, expect } from '@playwright/test';
import { estimateDurationMinutes } from '../../client/src/utils/tournamentDuration';

/**
 * Setup summary, "Takes about": rounds one after another, a round's matches
 * side by side on the servers there are.
 *
 * @tag api
 */
test('rounds wait for each other; servers run a round side by side', () => {
  const base = { format: 'bo1', minutesPerMap: 50, breakMinutes: 0 };
  // 8-team single elimination: 7 matches, 3 rounds, enough servers.
  expect(estimateDurationMinutes({ ...base, matches: 7, rounds: 3, servers: 4 })).toBe(150);
  // One server: every match after the other.
  expect(estimateDurationMinutes({ ...base, matches: 7, rounds: 3, servers: 1 })).toBe(350);
  // No servers to wait for (manual reporting): the rounds alone.
  expect(estimateDurationMinutes({ ...base, matches: 7, rounds: 3, servers: 0 })).toBe(150);
  // Bo3 averages 2.5 maps.
  expect(
    estimateDurationMinutes({ ...base, format: 'bo3', matches: 1, rounds: 1, servers: 1 })
  ).toBe(125);
  // A break between rounds, not after the last.
  expect(
    estimateDurationMinutes({ ...base, breakMinutes: 5, matches: 7, rounds: 3, servers: 4 })
  ).toBe(160);
  // Nothing to play, or no map length: no estimate.
  expect(estimateDurationMinutes({ ...base, matches: 0, rounds: null, servers: 1 })).toBeNull();
  expect(
    estimateDurationMinutes({ ...base, minutesPerMap: 0, matches: 3, rounds: 2, servers: 1 })
  ).toBeNull();
});
