import { test, expect } from '@playwright/test';
import {
  DEFAULT_START,
  daysOf,
  startFormOf,
  startSettings,
} from '../../client/src/components/tournament/setup/startForm';

/**
 * The setup's days and start (client startForm.ts): step 2 picks the days,
 * Schedule gives each round a day and a time, and round 1's is the start.
 * Pure, no database. Times are local, so the checks compare local dates.
 */
test.describe('Setup days and start', () => {
  const local = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  test('days: first to last, one day when the same, none unset', () => {
    expect(daysOf({ ...DEFAULT_START, firstDay: '2026-11-14', lastDay: '2026-11-16' })).toEqual([
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
    ]);
    expect(daysOf({ ...DEFAULT_START, firstDay: '2026-11-14', lastDay: '2026-11-14' })).toEqual([
      '2026-11-14',
    ]);
    expect(daysOf(DEFAULT_START)).toEqual([]);
  });

  test('set times: each round on its own day, and round 1 is the start', () => {
    const form = {
      ...DEFAULT_START,
      firstDay: '2026-11-14',
      lastDay: '2026-11-15',
      roundDays: { '3': '2026-11-15' },
      autoStart: true,
    };
    const out = startSettings(form, { '1': '18:00', '2': '20:00', '3': '19:00' }, true);
    expect(local(out.roundsIso['1'])).toBe('14 18:00');
    expect(local(out.roundsIso['2'])).toBe('14 20:00');
    expect(local(out.roundsIso['3'])).toBe('15 19:00');
    expect(out.startsAt).toBe(out.roundsIso['1']);
    expect(out.autoStart).toBe(true);
    expect(out.eventDays).toEqual({ first: '2026-11-14', last: '2026-11-15' });
  });

  test('as soon as ready: the start time on the first day; no time, no auto-start', () => {
    const form = {
      ...DEFAULT_START,
      firstDay: '2026-11-14',
      lastDay: '2026-11-14',
      startTime: '17:30',
    };
    expect(local(startSettings(form, {}, false).startsAt)).toBe('14 17:30');
    const noTime = startSettings({ ...form, startTime: '', autoStart: true }, {}, false);
    expect(noTime.startsAt).toBe('');
    expect(noTime.autoStart).toBe(false);
  });

  test('a saved tournament: the days from eventDays, else the start day', () => {
    const startsAt = new Date(2026, 10, 14, 18, 0).toISOString();
    expect(startFormOf({ startsAt })).toMatchObject({
      firstDay: '2026-11-14',
      lastDay: '2026-11-14',
      startTime: '18:00',
    });
    expect(
      startFormOf({ startsAt, eventDays: { first: '2026-11-14', last: '2026-11-15' } }).lastDay
    ).toBe('2026-11-15');
  });
});
