import { test, expect } from '@playwright/test';
import { windowOfSettings } from '../../api/src/services/tournamentSignupService';

/**
 * Sign-up and check-in windows from a tournament's settings
 * (tournamentSignupService.windowOfSettings). Pure, no database.
 */
test.describe('Sign-up windows', () => {
  const startsAt = '2026-11-14T18:00:00.000Z';

  test('check-in: minutes before the start, closing at the start', () => {
    const win = windowOfSettings(JSON.stringify({ startsAt, checkInMinutes: 30 }));
    expect(win.checkInOpensAt).toBe('2026-11-14T17:30:00.000Z');
    expect(win.checkInClosesAt).toBe(startsAt);
    expect(win.checkInMinutes).toBe(30);
  });

  test('check-in off (0), or no start yet: not open', () => {
    for (const s of [{ startsAt, checkInMinutes: 0 }, { checkInMinutes: 30 }]) {
      const win = windowOfSettings(JSON.stringify(s));
      expect(win.checkInOpensAt).toBeNull();
      expect(win.checkInClosesAt).toBeNull();
    }
  });

  test('an older tournament keeps its fixed check-in times', () => {
    const win = windowOfSettings(
      JSON.stringify({
        startsAt,
        checkInOpensAt: '2026-11-14T16:00:00.000Z',
        checkInClosesAt: '2026-11-14T17:00:00.000Z',
      })
    );
    expect(win.checkInOpensAt).toBe('2026-11-14T16:00:00.000Z');
    expect(win.checkInClosesAt).toBe('2026-11-14T17:00:00.000Z');
    expect(win.checkInMinutes).toBeNull();
  });

  test('sign-up opens at its time; captains check in unless switched off', () => {
    const win = windowOfSettings(
      JSON.stringify({ registrationOpen: true, registrationOpensAt: '2026-11-09T18:00:00.000Z' })
    );
    expect(win.registrationOpensAt).toBe('2026-11-09T18:00:00.000Z');
    expect(win.captainCheckIn).toBe(true);
    expect(windowOfSettings(JSON.stringify({ captainCheckIn: false })).captainCheckIn).toBe(false);
  });
});
