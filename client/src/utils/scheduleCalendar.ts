import type { EventPageScheduleItem } from '../types';

/** One schedule item placed on the calendar. */
export interface CalendarEvent {
  label: string;
  /** Start and end, in ms. */
  start: number;
  end: number;
  /** Side-by-side lane for items that start at the same time, and how many lanes. */
  lane: number;
  lanes: number;
  /** The last item of the whole schedule (often the final). */
  isLast: boolean;
}

export interface CalendarDay {
  /** Local date, `2026-10-17`. */
  key: string;
  /** Midnight of that day, in ms. */
  midnight: number;
  events: CalendarEvent[];
}

export interface CalendarLayout {
  days: CalendarDay[];
  /** First and last hour row (local hours, end exclusive), shared by every day. */
  firstHour: number;
  lastHour: number;
}

const HOUR = 60 * 60 * 1000;
/** An item with nothing after it on its day gets an hour. */
const DEFAULT_LENGTH = HOUR;
/** An item runs until the next one starts, but never longer than this. */
const MAX_LENGTH = 4 * HOUR;

function localDayKey(time: number): string {
  const d = new Date(time);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Lays the schedule out as a week-view calendar: one column per day, an hour
 * grid shared by all days. Items carry only a start time, so each runs until
 * the next item on its day starts (an hour for the last one, at most four).
 * Items that start at the same time sit side by side.
 */
export function layoutSchedule(schedule: EventPageScheduleItem[]): CalendarLayout | null {
  const items = schedule
    .map((item) => ({ label: item.label, start: new Date(item.at).getTime() }))
    .filter((item) => Number.isFinite(item.start))
    .sort((a, b) => a.start - b.start);
  if (items.length === 0) return null;

  const lastStart = items[items.length - 1].start;
  const byDay = new Map<string, typeof items>();
  for (const item of items) {
    const key = localDayKey(item.start);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }

  let firstHour = 24;
  let lastHour = 0;
  const days: CalendarDay[] = [];
  for (const [key, dayItems] of byDay) {
    const midnight = new Date(dayItems[0].start).setHours(0, 0, 0, 0);
    const starts = [...new Set(dayItems.map((item) => item.start))];
    const events = dayItems.map((item) => {
      const next = starts.find((start) => start > item.start);
      const end = item.start + Math.min(next !== undefined ? next - item.start : DEFAULT_LENGTH, MAX_LENGTH);
      const sameStart = dayItems.filter((other) => other.start === item.start);
      return {
        label: item.label,
        start: item.start,
        end,
        lane: sameStart.indexOf(item),
        lanes: sameStart.length,
        isLast: item.start === lastStart,
      };
    });
    for (const event of events) {
      firstHour = Math.min(firstHour, Math.floor((event.start - midnight) / HOUR));
      lastHour = Math.max(lastHour, Math.ceil((event.end - midnight) / HOUR));
    }
    days.push({ key, midnight, events });
  }

  return { days, firstHour, lastHour: Math.min(Math.max(lastHour, firstHour + 1), 24) };
}

function icsTime(time: number): string {
  return new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

/** The schedule as an iCalendar file, one event per item. */
export function scheduleToIcs(title: string, layout: CalendarLayout, idPrefix: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Auto Tournament//Schedule//EN'];
  const stamp = icsTime(Date.UTC(2026, 0, 1));
  layout.days.forEach((day) =>
    day.events.forEach((event, index) => {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${idPrefix}-${day.key}-${index}@autotournament`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsTime(event.start)}`,
        `DTEND:${icsTime(event.end)}`,
        `SUMMARY:${icsText(`${event.label} · ${title}`)}`,
        'END:VEVENT'
      );
    })
  );
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
