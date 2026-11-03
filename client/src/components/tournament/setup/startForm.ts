/**
 * The tournament's days and start, as the setup edits them (Claude Design
 * "Tournament settings with esports preset", Name and day + Schedule): step 2
 * picks the day (or a first and last day), the Schedule step gives each round
 * a day and a time, and round 1's is the tournament's start. Saved as
 * `settings.eventDays`, `settings.startsAt` (with `autoStart` and
 * `startReminders`) and `settings.matchTimes.rounds`.
 */
import { dayOf, isoOf, splitIso } from '../../../utils/localDay';
import type { Untrusted } from '../../../utils/untrusted';

export interface StartForm {
  /** The tournament's first and last day ("YYYY-MM-DD"); the same for one day, '' unset. */
  firstDay: string;
  lastDay: string;
  /** The start time when matches go as soon as they're ready ("HH:MM"). */
  startTime: string;
  /** Round number → its day, when it isn't the first day. */
  roundDays: Record<string, string>;
  autoStart: boolean;
  startReminders: number[];
}

export const DEFAULT_START: StartForm = {
  firstDay: '',
  lastDay: '',
  startTime: '',
  roundDays: {},
  autoStart: false,
  startReminders: [60, 30, 5],
};

/** A saved tournament's days and start, as the form holds them. */
export function startFormOf(settings: Untrusted): StartForm {
  const s = (settings ?? {}) as {
    eventDays?: { first?: Untrusted; last?: Untrusted };
    startsAt?: Untrusted;
    autoStart?: Untrusted;
    startReminders?: Untrusted;
    matchTimes?: { rounds?: Record<string, Untrusted> };
  };
  const start = splitIso(typeof s.startsAt === 'string' ? s.startsAt : '');
  const first = typeof s.eventDays?.first === 'string' ? s.eventDays.first : start.day;
  const last = typeof s.eventDays?.last === 'string' ? s.eventDays.last : first;
  const roundDays: Record<string, string> = {};
  for (const [round, at] of Object.entries(s.matchTimes?.rounds ?? {})) {
    const day = splitIso(typeof at === 'string' ? at : '').day;
    if (day) roundDays[round] = day;
  }
  return {
    firstDay: first,
    lastDay: last >= first ? last : first,
    startTime: start.time,
    roundDays,
    autoStart: s.autoStart === true,
    startReminders: Array.isArray(s.startReminders)
      ? s.startReminders.filter((m): m is number => typeof m === 'number')
      : DEFAULT_START.startReminders,
  };
}

/** The tournament's days, first to last ("YYYY-MM-DD"), at most 14. */
export function daysOf(form: StartForm): string[] {
  if (!form.firstDay) return [];
  const days: string[] = [];
  const d = new Date(`${form.firstDay}T12:00:00`);
  for (let i = 0; i < 14; i++) {
    const day = dayOf(d);
    if (i > 0 && day > (form.lastDay || form.firstDay)) break;
    days.push(day);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/** A round's day: its own, else the first day (else today). */
export function roundDayOf(form: StartForm, round: number): string {
  const own = form.roundDays[String(round)];
  const days = daysOf(form);
  if (own && days.includes(own)) return own;
  return form.firstDay || dayOf(new Date());
}

/**
 * The settings the days and start save as. `rounds` are the round times
 * ("HH:MM") and `timesMode` whether matches go at them: round 1's time is
 * then the start.
 */
export function startSettings(
  form: StartForm,
  rounds: Record<string, string>,
  timesMode: boolean
): {
  eventDays?: { first: string; last: string };
  startsAt: string;
  autoStart: boolean;
  startReminders: number[];
  roundsIso: Record<string, string>;
} {
  const roundsIso: Record<string, string> = {};
  for (const [round, time] of Object.entries(rounds)) {
    const iso = isoOf(roundDayOf(form, Number(round)), time);
    if (iso) roundsIso[round] = iso;
  }
  const startsAt =
    (timesMode && roundsIso['1']) || (form.firstDay ? isoOf(form.firstDay, form.startTime) : '');
  return {
    ...(form.firstDay
      ? { eventDays: { first: form.firstDay, last: form.lastDay || form.firstDay } }
      : {}),
    startsAt,
    autoStart: form.autoStart && Boolean(startsAt),
    startReminders: form.startReminders,
    roundsIso,
  };
}
