/**
 * "Starts in 2d 4h" / "Starts in 1h 05m" / "Starts in 4:32": the time left to a
 * tournament's start (settings.startsAt). Ticks every second in the last hour,
 * else every 30 seconds. Nothing once the start has passed.
 */
import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function countdownParts(ms: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

export function StartCountdown({ at, color }: { at: number; color?: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const left = at - now;
  useEffect(() => {
    if (left <= 0) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), left < 3600_000 ? 1000 : 30_000);
    return () => window.clearInterval(id);
  }, [left < 3600_000, left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  if (left <= 0) return null;
  const { d, h, m, s } = countdownParts(left);
  const pad = (n: number) => String(n).padStart(2, '0');
  const text =
    d > 0
      ? t('tournament.countdown.days', { d, h })
      : h > 0
        ? t('tournament.countdown.hours', { h, m: pad(m) })
        : t('tournament.countdown.minutes', { m, s: pad(s) });
  return (
    <Box
      component="span"
      data-testid="start-countdown"
      sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color }}
    >
      {text}
    </Box>
  );
}
