import { useEffect, useState } from 'react';
import { fmtDateTime } from '../../../module-sdk';

/** A moment as the viewer's locale writes date and time; a dash for none. */
export function formatWhen(unixSeconds: number | null | undefined, locale?: string): string {
  if (!unixSeconds) return '—';
  return fmtDateTime(unixSeconds, locale);
}

/** As `formatWhen`, but only the time for a moment today. */
export function formatWhenShort(unixSeconds: number | null | undefined, locale: string): string {
  if (!unixSeconds) return '—';
  const d = new Date(unixSeconds * 1000);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

/** How long before `nowSeconds` a moment was, in the viewer's language ("3 minutes ago"). */
export function formatAgo(unixSeconds: number, locale: string, nowSeconds: number): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const d = Math.max(0, Math.floor(nowSeconds - unixSeconds));
  if (d < 3600) return rtf.format(-Math.max(1, Math.round(d / 60)), 'minute');
  if (d < 86400) return rtf.format(-Math.round(d / 3600), 'hour');
  return rtf.format(-Math.round(d / 86400), 'day');
}

/** Seconds since the epoch, updated each minute. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
