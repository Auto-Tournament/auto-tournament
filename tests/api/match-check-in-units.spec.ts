import { test, expect } from '@playwright/test';
import { checkInOpen } from '../../api/src/services/matchCheckIns';

/** When check-in before a match is open (services/matchCheckIns.ts). Pure. */
test.describe('Match check-in window', () => {
  test('from the veto opening until the start, only before the match goes live', () => {
    expect(checkInOpen(true, 'pending', 1000, 1300, 999)).toBe(false);
    expect(checkInOpen(true, 'pending', 1000, 1300, 1000)).toBe(true);
    expect(checkInOpen(true, 'loaded', 1000, 1300, 1299)).toBe(true);
    expect(checkInOpen(true, 'loaded', 1000, 1300, 1300)).toBe(false);
    expect(checkInOpen(true, 'live', 1000, 1300, 1100)).toBe(false);
  });

  test('switched off, never; no time, open until the match goes live', () => {
    expect(checkInOpen(false, 'pending', null, null, 5)).toBe(false);
    expect(checkInOpen(true, 'ready', null, null, 5)).toBe(true);
  });
});
