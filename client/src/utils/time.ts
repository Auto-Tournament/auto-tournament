/**
 * Dates, times and countdowns, formatted one way everywhere. Pages call these
 * instead of building their own `Intl.DateTimeFormat` / `toLocaleTimeString`,
 * so a change here (say, 24-hour clocks) reaches every page at once.
 *
 * Times take epoch milliseconds, epoch seconds (anything below 1e11 is read
 * as seconds), an ISO string or a Date. The language is the UI's; English
 * uses the 24-hour, day-month style the drafts show ("16:00", "Sat 24 Oct").
 */
import i18n from '../i18n';

export type When = number | string | Date;

/** Epoch ms for any of the accepted inputs (seconds below 1e11). */
export function toMs(at: When): number {
  if (at instanceof Date) return at.getTime();
  if (typeof at === 'string') return Date.parse(at);
  return at < 1e11 ? at * 1000 : at;
}

/** The locale the formatters use: the UI language, English as en-GB (24 h). */
export function timeLocale(language: string = i18n.language): string {
  return !language || language === 'en' ? 'en-GB' : language;
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(options: Intl.DateTimeFormatOptions, language?: string): Intl.DateTimeFormat {
  const locale = timeLocale(language);
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

/** "16:00" */
export function fmtTime(at: When, language?: string): string {
  return fmt({ hour: '2-digit', minute: '2-digit' }, language).format(toMs(at));
}

/** "Sat 16:00" */
export function fmtWeekdayTime(at: When, language?: string): string {
  return fmt({ weekday: 'short', hour: '2-digit', minute: '2-digit' }, language).format(toMs(at));
}

/** "Sat 24 Oct, 16:00" */
export function fmtDayTime(at: When, language?: string): string {
  return fmt(
    { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
    language
  ).format(toMs(at));
}

/** "24 Oct 2026" */
export function fmtDate(at: When, language?: string): string {
  return fmt({ day: 'numeric', month: 'short', year: 'numeric' }, language).format(toMs(at));
}

/** "Saturday 24 October" */
export function fmtLongDay(at: When, language?: string): string {
  return fmt({ weekday: 'long', day: 'numeric', month: 'long' }, language).format(toMs(at));
}

/** "24 Oct 2026, 16:00" */
export function fmtDateTime(at: When, language?: string): string {
  return fmt(
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    language
  ).format(toMs(at));
}

/** A length of time as a clock: "4:05", "1:02:09". */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Time left until `at`, as a clock; a day or more away: "2 d 4 h". */
export function fmtCountdown(at: When, now: number = Date.now()): string {
  const left = Math.max(0, Math.floor((toMs(at) - now) / 1000));
  if (left >= 86400) return `${Math.floor(left / 86400)} d ${Math.floor((left % 86400) / 3600)} h`;
  return fmtClock(left);
}
