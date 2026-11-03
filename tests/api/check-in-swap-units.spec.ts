import { test, expect } from '@playwright/test';
import { swapAbsent } from '../../api/src/services/checkInSwap';

/** A sub plays for a starter who didn't check in (services/checkInSwap.ts). Pure. */
test.describe('Check-in swap', () => {
  const pool = ['s1', 's2', 's3', 's4', 's5', 'sub1', 'sub2'];
  const pick = pool.slice(0, 5);

  test('a missing starter is replaced by the first sub', () => {
    expect(swapAbsent(pick, pool, 5, new Set(['s2']))).toEqual(['s1', 's3', 's4', 's5', 'sub1']);
  });

  test('more missing than subs: the missing starter still fills the last spot', () => {
    expect(swapAbsent(pick, pool, 5, new Set(['s1', 's2', 's3']))).toEqual([
      's4',
      's5',
      'sub1',
      'sub2',
      's1',
    ]);
  });

  test('nobody missing: the pick stays', () => {
    expect(swapAbsent(pick, pool, 5, new Set())).toEqual(pick);
  });
});
