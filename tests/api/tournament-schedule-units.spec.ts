import { test, expect } from '@playwright/test';
import {
  autoStartDue,
  inMinutes,
  remindersDue,
  startScheduleOf,
} from '../../api/src/services/tournamentSchedule';

/**
 * Start times (services/tournamentSchedule.ts): reminders before
 * settings.startsAt and the automatic start. Pure parts, no database.
 */
test.describe('Tournament start schedule', () => {
  const at = Date.parse('2026-10-17T18:00:00Z');

  test('settings: defaults, cleaned reminders, no start time', () => {
    expect(startScheduleOf({ startsAt: '2026-10-17T18:00:00Z' })).toEqual({
      startsAt: at,
      autoStart: false,
      reminders: [60, 30, 5],
    });
    expect(
      startScheduleOf({
        startsAt: '2026-10-17T18:00:00Z',
        autoStart: true,
        startReminders: [5, 15, 15, 0, 'x'],
      })
    ).toEqual({ startsAt: at, autoStart: true, reminders: [15, 5] });
    expect(startScheduleOf({}).startsAt).toBeNull();
    expect(startScheduleOf(null).startsAt).toBeNull();
  });

  test('reminders: due at their minute, never late by more than 10 minutes, none after the start', () => {
    const s = startScheduleOf({ startsAt: '2026-10-17T18:00:00Z' });
    expect(remindersDue(s, at - 61 * 60_000)).toEqual([]);
    expect(remindersDue(s, at - 60 * 60_000)).toEqual([60]);
    expect(remindersDue(s, at - 29 * 60_000)).toEqual([30]); // the 60 one is 31 min late: skipped
    expect(remindersDue(s, at - 4 * 60_000)).toEqual([5]);
    expect(remindersDue(s, at)).toEqual([]);
    // A start time set 8 minutes ahead: the 5-minute one only.
    expect(remindersDue(s, at - 8 * 60_000)).toEqual([]);
  });

  test('auto start: only when switched on, from the start time, not hours late', () => {
    const on = startScheduleOf({ startsAt: '2026-10-17T18:00:00Z', autoStart: true });
    const off = startScheduleOf({ startsAt: '2026-10-17T18:00:00Z' });
    expect(autoStartDue(on, at - 1000)).toBe(false);
    expect(autoStartDue(on, at)).toBe(true);
    expect(autoStartDue(off, at)).toBe(false);
    expect(autoStartDue(on, at + 7 * 3600_000)).toBe(false);
  });

  test('message wording', () => {
    expect(inMinutes(60)).toBe('in 1 hour');
    expect(inMinutes(120)).toBe('in 2 hours');
    expect(inMinutes(30)).toBe('in 30 minutes');
    expect(inMinutes(1)).toBe('in 1 minute');
  });
});
