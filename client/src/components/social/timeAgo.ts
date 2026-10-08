/** "4 min ago", "yesterday", in the viewer's language. */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Infinity],
];

export function formatTimeAgo(epochSeconds: number, language: string, nowMs = Date.now()): string {
  let value = epochSeconds - nowMs / 1000;
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (Math.abs(value) < 45) return rtf.format(0, 'second');
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), 'year');
}

export function useTimeAgo(): (epochSeconds: number) => string {
  const { i18n } = useTranslation();
  return useCallback((epochSeconds: number) => formatTimeAgo(epochSeconds, i18n.language || 'en'), [i18n.language]);
}
