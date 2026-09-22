import { test, expect } from '@playwright/test';
import {
  checkQueueTurn,
  compareQueueOrder,
  isQueueable,
  type QueueEntry,
} from '../../api/src/core/allocationQueue';

/**
 * Servers go to waiting matches in queue order.
 *
 * Seen on real servers (MAT 2.4.7, three servers, 8-team Bo1 single elim, all
 * four first-round vetoes done within 30 ms): queue positions 1-4 were r1m1-r1m4,
 * but when the servers came free r1m3 and r1m4 loaded and r1m2 waited for the
 * next one. Each ready match polled on its own timer and the first tick won.
 *
 * @tag api
 * @tag allocation
 */
const entry = (slug: string, round: number, matchNumber: number, id: number): QueueEntry => ({
  id,
  slug,
  round,
  matchNumber,
});

const r1 = [entry('r1m1', 1, 1, 11), entry('r1m2', 1, 2, 12), entry('r1m3', 1, 3, 13), entry('r1m4', 1, 4, 14)];

test.describe('Allocation queue order', () => {
  test('order is round, then match number, then row id', () => {
    const shuffled = [
      entry('r2m1', 2, 1, 5),
      entry('r1m4', 1, 4, 4),
      entry('manual-b', 0, 0, 30),
      entry('r1m2', 1, 2, 2),
      entry('manual-a', 0, 0, 29),
      entry('r1m1', 1, 1, 9),
    ];
    expect([...shuffled].sort(compareQueueOrder).map((e) => e.slug)).toEqual([
      'manual-a',
      'manual-b',
      'r1m1',
      'r1m2',
      'r1m4',
      'r2m1',
    ]);
  });

  test('with three free servers, r1m4 waits while r1m1-r1m3 may load, whatever order they ask in', () => {
    // Polling order from the QA run: r1m3, r1m4, r1m1, then r1m2.
    expect(checkQueueTurn(r1, 'r1m3', 3).allowed).toBe(true);
    const r1m4 = checkQueueTurn(r1, 'r1m4', 3);
    expect(r1m4.allowed).toBe(false);
    expect(r1m4.position).toBe(4);
    expect(r1m4.ahead.map((e) => e.slug)).toEqual(['r1m1', 'r1m2', 'r1m3']);
    expect(checkQueueTurn(r1, 'r1m1', 3).allowed).toBe(true);
    expect(checkQueueTurn(r1, 'r1m2', 3).allowed).toBe(true);
  });

  test('simulated allocation hands servers out by queue position, not by who asks first', () => {
    let queue = [...r1];
    let free = 3;
    const loaded: string[] = [];
    // Pollers tick in the unlucky order, repeatedly, until the servers are gone.
    for (let pass = 0; pass < 3 && free > 0; pass++) {
      for (const slug of ['r1m4', 'r1m3', 'r1m1', 'r1m2']) {
        if (free === 0 || !queue.some((e) => e.slug === slug)) continue;
        if (checkQueueTurn(queue, slug, free).allowed) {
          loaded.push(slug);
          queue = queue.filter((e) => e.slug !== slug);
          free -= 1;
        }
      }
    }
    expect([...loaded].sort()).toEqual(['r1m1', 'r1m2', 'r1m3']);
    expect(queue.map((e) => e.slug)).toEqual(['r1m4']);
  });

  test('no free server: nobody takes a turn; a match outside the queue is not held back', () => {
    expect(checkQueueTurn(r1, 'r1m1', 0).allowed).toBe(false);
    const manual = checkQueueTurn(r1, 'manual-1', 1);
    expect(manual.allowed).toBe(true);
    expect(manual.position).toBeNull();
  });

  /**
   * Double elimination (QA, MAT 2.4.8, 8 teams): the grand final is round 1
   * match 1 and upper/lower brackets number rounds separately, so plain round
   * order put the empty grand final at queue #3, ahead of lb-r1m2.
   */
  const de = (slug: string, bracket: string, round: number, matchNumber: number, id: number) => ({
    ...entry(slug, round, matchNumber, id),
    bracket,
  });

  test('double elimination: upper and lower rounds interleave, grand final last', () => {
    const all = [
      de('gf', 'GF', 1, 1, 15),
      de('lb-r4m1', 'LB', 4, 1, 14),
      de('lb-r3m1', 'LB', 3, 1, 13),
      de('lb-r2m2', 'LB', 2, 2, 12),
      de('lb-r2m1', 'LB', 2, 1, 11),
      de('lb-r1m2', 'LB', 1, 2, 10),
      de('lb-r1m1', 'LB', 1, 1, 9),
      de('r3m1', 'WB', 3, 1, 7),
      de('r2m2', 'WB', 2, 2, 6),
      de('r2m1', 'WB', 2, 1, 5),
      de('r1m4', 'WB', 1, 4, 4),
      de('r1m3', 'WB', 1, 3, 3),
      de('r1m2', 'WB', 1, 2, 2),
      de('r1m1', 'WB', 1, 1, 1),
    ];
    expect([...all].sort(compareQueueOrder).map((e) => e.slug)).toEqual([
      'r1m1',
      'r1m2',
      'r1m3',
      'r1m4',
      'lb-r1m1',
      'lb-r1m2',
      'r2m1',
      'r2m2',
      'lb-r2m1',
      'lb-r2m2',
      'lb-r3m1',
      'r3m1',
      'lb-r4m1',
      'gf',
    ]);
  });

  test('rows without a bracket column fall back to the slug', () => {
    const legacy = [entry('gf', 1, 1, 15), entry('lb-r1m2', 1, 2, 10), entry('r1m1', 1, 1, 1)];
    expect([...legacy].sort(compareQueueOrder).map((e) => e.slug)).toEqual(['r1m1', 'lb-r1m2', 'gf']);
  });

  test('mixed brackets: a freed server goes to queue #1 (r1m1), not lb-r1m2 or r2m2', () => {
    const queue = [de('lb-r1m2', 'LB', 1, 2, 10), de('r2m2', 'WB', 2, 2, 6), de('r1m1', 'WB', 1, 1, 1)];
    expect(checkQueueTurn(queue, 'lb-r1m2', 1).allowed).toBe(false);
    expect(checkQueueTurn(queue, 'r2m2', 1).allowed).toBe(false);
    expect(checkQueueTurn(queue, 'r1m1', 1)).toMatchObject({ allowed: true, position: 1 });
    // Two free servers: r1m1 and lb-r1m2 (stage 2) before r2m2 (stage 3).
    expect(checkQueueTurn(queue, 'lb-r1m2', 2).allowed).toBe(true);
    expect(checkQueueTurn(queue, 'r2m2', 2).allowed).toBe(false);
  });

  test('only matches with both teams and no server get a queue position', () => {
    const team = (id: string) => ({ id });
    expect(isQueueable({ status: 'pending', team1: team('a'), team2: undefined })).toBe(false);
    expect(isQueueable({ status: 'pending', team1: undefined, team2: undefined })).toBe(false);
    expect(isQueueable({ status: 'ready', team1: team('a'), team2: team('a') })).toBe(false);
    expect(isQueueable({ status: 'ready', team1: team('a'), team2: team('b'), serverId: 's1' })).toBe(
      false
    );
    expect(isQueueable({ status: 'live', team1: team('a'), team2: team('b') })).toBe(false);
    expect(isQueueable({ status: 'ready', team1: team('a'), team2: team('b') })).toBe(true);
    expect(isQueueable({ status: 'pending', team1: team('a'), team2: team('b') })).toBe(true);
  });
});
