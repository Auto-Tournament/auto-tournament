import { test, expect } from '@playwright/test';
import { benchTooLate, LATE_BENCH_SECONDS } from '../../api/src/services/shuffleTournamentService';

const TAGS = { tag: ['@api', '@shuffle'] };

test.describe('shuffle bench (pure)', () => {
  test('a bench match only early in a round, before any match of it finished', TAGS, () => {
    const start = 1000;
    // Early in the round: an extra match is fine.
    expect(benchTooLate({ startedAt: start, finished: 0 }, start + 60)).toBe(false);
    expect(benchTooLate({ startedAt: null, finished: 0 }, start)).toBe(false);
    // Past the window, or a match of the round already over: they play next round.
    expect(benchTooLate({ startedAt: start, finished: 0 }, start + LATE_BENCH_SECONDS + 1)).toBe(
      true
    );
    expect(benchTooLate({ startedAt: start, finished: 1 }, start + 60)).toBe(true);
  });
});
