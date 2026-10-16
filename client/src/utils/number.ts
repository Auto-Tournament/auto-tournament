/**
 * Numbers shown to people, formatted one way everywhere in the UI's
 * language: "1.40" / "12,500" / "60%" in English, "1,40" / "12 500" / "60 %"
 * in Norwegian. Pages call these instead of `toFixed` / `toLocaleString`
 * (those stay for machine values: CSS, coordinates, URLs, input values).
 * Missing values (null / undefined / NaN) show as "—".
 */
import { timeLocale } from './time';

type Num = number | null | undefined;

const cache = new Map<string, Intl.NumberFormat>();
function nf(options: Intl.NumberFormatOptions, language?: string): Intl.NumberFormat {
  const locale = timeLocale(language);
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

const missing = (n: Num): n is null | undefined => n === null || n === undefined || Number.isNaN(n);

/** "1.40" / "1,40" with exactly `digits` decimals; "12,500" / "12 500" grouped. */
export function fmtNum(n: Num, digits = 0, fallback = '—'): string {
  if (missing(n)) return fallback;
  return nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** A share from 0–100 as a percentage: "60%" / "60 %". */
export function fmtPercent(value: Num, digits = 0, fallback = '—'): string {
  if (missing(value)) return fallback;
  return nf({
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100);
}

/** A share from 0–1 as a percentage: 0.6 → "60%" / "60 %". */
export function fmtShare(fraction: Num, digits = 0, fallback = '—'): string {
  return missing(fraction) ? fallback : fmtPercent(fraction * 100, digits, fallback);
}

/** In-game money (CS2 dollars): "$12,500" / "$12 500". */
export function fmtMoney(n: Num, fallback = '—'): string {
  return missing(n) ? fallback : `$${fmtNum(Math.round(n), 0)}`;
}
