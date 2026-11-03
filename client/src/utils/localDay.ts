/** Local days ("YYYY-MM-DD") and times ("HH:MM"), for the date pickers and the setup. */

const pad = (n: number) => String(n).padStart(2, '0');

/** A local date as "YYYY-MM-DD". */
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "YYYY-MM-DD" as a local Date at midnight (null when it isn't one). */
export function parseDay(day: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
/** A day and "HH:MM" as an ISO date-time ('' when either is missing). */
export function isoOf(day: string, time: string): string {
  const d = parseDay(day);
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !m) return '';
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.toISOString();
}
/** An ISO date-time as its local day and "HH:MM". */
export function splitIso(iso: string | null | undefined): { day: string; time: string } {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return { day: '', time: '' };
  return { day: dayOf(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
