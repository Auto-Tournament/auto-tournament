import { test, expect } from '@playwright/test';
import {
  computeNextRoundEta,
  remainingRounds,
  ROUND_SECONDS,
  WARMUP_SECONDS,
} from '../../api/src/utils/nextRoundEta';

/**
 * "Next round about HH:MM" (overview): rounds left from the score, overtime,
 * the break after the last match, and exact times from holds.
 *
 * @tag api
 * @tag tournament
 */

const NOW = Date.UTC(2026, 9, 17, 15, 0, 0);
const team = { id: 't', name: 'T' };
const live = (slug: string, round: number, s1: number, s2: number) => ({
  slug,
  round,
  status: 'live' as const,
  team1: team,
  team2: team,
  team1Score: s1,
  team2Score: s2,
});
const pending = (slug: string, round: number) => ({
  slug,
  round,
  status: 'pending' as const,
  team1: team,
  team2: team,
});

test.describe('remainingRounds (MR24: first to 13)', () => {
  test('from the leader, not the sum', () => {
    expect(remainingRounds(0, 0)).toBe(13);
    expect(remainingRounds(7, 3)).toBe(6);
    expect(remainingRounds(12, 4)).toBe(1);
    expect(remainingRounds(13, 4)).toBe(0);
  });
  test('tied 12-12 and overtime: one segment, first to 4 more', () => {
    expect(remainingRounds(12, 12)).toBe(4);
    expect(remainingRounds(13, 12)).toBe(3);
    expect(remainingRounds(15, 13)).toBe(1);
  });
  test('other round counts', () => {
    expect(remainingRounds(0, 0, 16)).toBe(9);
  });
});

test.describe('computeNextRoundEta', () => {
  const base = { totalRounds: 5, breakMinutes: 10, nowMs: NOW };

  test('latest live match plus the break', () => {
    const eta = computeNextRoundEta({
      ...base,
      matches: [live('a', 1, 10, 5), live('b', 1, 2, 3), pending('c', 2)],
    });
    // b: 13 - 3 = 10 rounds left
    const at = NOW + 10 * ROUND_SECONDS * 1000 + 10 * 60_000;
    expect(eta).toEqual({ at: new Date(at).toISOString(), exact: false, final: false });
  });

  test('a loaded match not started counts warmup plus a full match', () => {
    const eta = computeNextRoundEta({
      ...base,
      matches: [live('a', 1, 12, 0), { ...pending('b', 1), status: 'loaded' }, pending('c', 2)],
    });
    const at = NOW + (WARMUP_SECONDS + 24 * ROUND_SECONDS) * 1000 + 10 * 60_000;
    expect(eta?.at).toBe(new Date(at).toISOString());
  });

  test('a hold on a next-round match is exact', () => {
    const held = Math.floor(NOW / 1000) + 600;
    const eta = computeNextRoundEta({
      ...base,
      matches: [live('a', 1, 10, 5), pending('c', 2)],
      heldUntil: { c: held },
    });
    expect(eta).toEqual({ at: new Date(held * 1000).toISOString(), exact: true, final: false });
  });

  test('final round: when it ends, flagged final', () => {
    const eta = computeNextRoundEta({ ...base, totalRounds: 1, matches: [live('a', 1, 11, 0)] });
    expect(eta?.final).toBe(true);
    expect(eta?.at).toBe(new Date(NOW + 2 * ROUND_SECONDS * 1000).toISOString());
  });

  test('nothing live or nothing open: no estimate', () => {
    expect(computeNextRoundEta({ ...base, matches: [pending('a', 1)] })).toBeNull();
    expect(
      computeNextRoundEta({ ...base, matches: [{ ...live('a', 1, 13, 5), status: 'completed' }] })
    ).toBeNull();
  });
});
