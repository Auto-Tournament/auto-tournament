/**
 * The amber heads-up about another tournament playing at the same time
 * (Claude Design, Name and day and Schedule). It only warns.
 */
import type { ReactNode } from 'react';
import { Box, Link, Typography } from '@mui/material';
import { WarningIcon } from '@phosphor-icons/react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { radii, tokens, withAlpha } from '../../../theme/tokens';
import { overlapping, type OtherTournament } from '../../../hooks/usePlayWindows';

export function OverlapNotice({
  title,
  body,
  to,
  linkText,
  compact = false,
}: {
  title?: ReactNode;
  body: ReactNode;
  to: string;
  linkText: string;
  compact?: boolean;
}) {
  return (
    <Box
      role="status"
      data-testid="setup-overlap-notice"
      sx={{
        flex: compact ? undefined : '1 1 260px',
        maxWidth: compact ? undefined : 420,
        display: 'flex',
        gap: 1.5,
        px: compact ? 1.5 : 2,
        py: compact ? 1.25 : 1.75,
        borderRadius: compact ? '10px' : radii.md,
        border: `1px solid ${withAlpha(tokens.color.warning, 0.45)}`,
        bgcolor: withAlpha(tokens.color.warning, 0.08),
      }}
    >
      <WarningIcon
        size={compact ? 18 : 20}
        color={tokens.color.warning}
        aria-hidden
        style={{ flex: 'none' }}
      />
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, fontSize: compact ? 13 : 14 }}
      >
        {title && <Typography sx={{ fontWeight: 600, fontSize: 'inherit' }}>{title}</Typography>}
        <Typography sx={{ fontSize: 'inherit', color: tokens.color.ink2, lineHeight: 1.45 }}>
          {body}{' '}
          {compact && (
            <Link component={RouterLink} to={to}>
              {linkText}
            </Link>
          )}
        </Typography>
        {!compact && (
          <Link component={RouterLink} to={to} sx={{ fontSize: 13 }}>
            {linkText}
          </Link>
        )}
      </Box>
    </Box>
  );
}

/** Under a round on Schedule: another tournament playing while it does. */
export function RoundOverlap({
  others,
  startIso,
  endIso,
}: {
  others: OtherTournament[];
  startIso: string;
  /** The next round's start; '' for the last round (then two hours). */
  endIso: string;
}) {
  const { t, i18n } = useTranslation();
  const from = Date.parse(startIso);
  if (!Number.isFinite(from)) return null;
  const to = Number.isFinite(Date.parse(endIso)) ? Date.parse(endIso) : from + 2 * 3600_000;
  const hit = overlapping(others, from, Math.max(to, from + 60_000));
  if (!hit) return null;
  const lang = i18n.language || 'en';
  const hhmm = (d: Date) => d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  return (
    <Box sx={{ gridColumn: '1 / -1' }}>
      <OverlapNotice
        compact
        body={t('tournament.setup.overlap.round', {
          name: hit.name,
          day: hit.start.toLocaleDateString(lang, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
          from: hhmm(hit.start),
          to: hhmm(hit.end),
        })}
        to={`/tournament/${hit.id}`}
        linkText={t('tournament.setup.overlap.see', { name: hit.name })}
      />
    </Box>
  );
}
