import { test, expect } from '@playwright/test';
import { firstOverlap, playWindowsOf } from '../../api/src/services/tournamentOverlaps';

/**
 * When tournaments play (services/tournamentOverlaps.ts): each round from its
 * time to the next, and whether two tournaments' rounds overlap. Pure.
 */
test.describe('Tournament play windows', () => {
  const at = (h: number, day = 14) => Date.UTC(2026, 10, day, h);
  const times = (rounds: Record<string, number>) =>
    JSON.stringify({
      matchTimes: {
        mode: 'times',
        rounds: Object.fromEntries(
          Object.entries(rounds).map(([r, t]) => [r, new Date(t).toISOString()])
        ),
      },
    });

  test('set times: a round lasts until the next (at most three hours), the last one two', () => {
    expect(playWindowsOf(times({ '1': at(18), '2': at(20), '3': at(19, 15) }))).toEqual([
      { start: at(18), end: at(20), round: 1 },
      { start: at(20), end: at(23), round: 2 },
      { start: at(19, 15), end: at(21, 15), round: 3 },
    ]);
  });

  test('as soon as ready: from the start; no start: nowhere', () => {
    expect(playWindowsOf(JSON.stringify({ startsAt: new Date(at(18)).toISOString() }))).toEqual([
      { start: at(18), end: at(22), round: null },
    ]);
    expect(playWindowsOf('{}')).toEqual([]);
  });

  test('the same day is fine; only overlapping times count', () => {
    const evening = playWindowsOf(times({ '1': at(18), '2': at(20) }));
    const morning = playWindowsOf(times({ '1': at(9), '2': at(11) }));
    const late = playWindowsOf(times({ '1': at(21) }));
    expect(firstOverlap(evening, morning)).toBeNull();
    expect(firstOverlap(evening, late)?.theirs.start).toBe(at(21));
  });
});
