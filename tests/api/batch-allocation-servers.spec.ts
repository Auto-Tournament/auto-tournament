import { test, expect } from '@playwright/test';
import { batchServerTarget } from '../../api/src/utils/allocationQueue';

/**
 * A shuffle round with more matches than servers still starts (#226).
 *
 * QA, MAT 2.4.12 (shuffle, 42 players -> 8 teams per round, 3 servers): round 1
 * ran, round 2 was generated and never allocated. The log repeated
 * "Waiting for idle servers before batch allocation: 3/4 available" until the
 * 15-minute cap: batch allocation waited for one idle server per match, and
 * with 4 matches and 3 servers that can never happen.
 *
 * Batch allocation now waits for min(matches, servers that can take one):
 * enabled, reported in and online. It loads that many and the rest are polled
 * onto servers as the first matches finish. The next round is still only
 * generated once the whole current round is done.
 *
 * @tag api
 * @tag allocation
 * @tag shuffle
 */

const online = (n: number) => Array.from({ length: n }, () => ({ online: true }));

test.describe('Batch allocation server target', () => {
  test('4 matches, 3 servers: waits for 3, not 4', () => {
    expect(batchServerTarget(4, online(3))).toBe(3);
  });

  test('fewer matches than servers: waits for one per match, as before', () => {
    expect(batchServerTarget(2, online(3))).toBe(2);
    expect(batchServerTarget(3, online(3))).toBe(3);
  });

  test('an offline server is not waited for', () => {
    expect(batchServerTarget(4, [...online(2), { online: false }])).toBe(2);
  });

  test('the QA round: the wait ends as soon as every usable server is idle', () => {
    // allocateSpecificMatches polls while 0 < idle < target.
    const target = batchServerTarget(4, online(3));
    const idleSnapshots = [1, 2, 3];
    const stillWaiting = idleSnapshots.map((idle) => idle > 0 && idle < target);
    expect(stillWaiting).toEqual([true, true, false]);
  });

  test('nothing to allocate or no servers: nothing to wait for', () => {
    expect(batchServerTarget(0, online(3))).toBe(0);
    expect(batchServerTarget(4, [])).toBe(0);
  });
});
