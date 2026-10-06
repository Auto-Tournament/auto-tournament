import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Panel } from '../../common/ui';
import { fontMono, textSize, tokens } from '../../../theme/tokens';

const { color } = tokens;

export interface TeamProfileNumbers {
  rating: number | null;
  record: { wins: number; losses: number; last10: Array<'w' | 'l'> };
  rounds: { won: number; lost: number };
  /** The roster's average rating change over the last 30 days. */
  monthDelta?: number | null;
  /** Names of the tournaments the team won, newest first. */
  trophies?: string[];
}

function Tile({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <Panel
      data-testid={testId}
      sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0 }}
    >
      <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>{label}</Typography>
      {children}
    </Panel>
  );
}

function Big({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <Typography
      sx={{
        fontWeight: 700,
        fontSize: '2.5rem',
        lineHeight: 1,
        color: tone,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * The team page's numbers, for any game: the team's rating (its roster's
 * average) and this month's change, its record with the last ten results,
 * its round difference and its trophies. A new team shows the same tiles
 * with dashes, so the page keeps its shape.
 */
export function TeamStatStrip({ numbers }: { numbers: TeamProfileNumbers }) {
  const { t } = useTranslation();
  const { rating, record, rounds, monthDelta = null, trophies = [] } = numbers;
  const played = record.wins + record.losses;
  const diff = rounds.won - rounds.lost;

  return (
    <Box
      data-testid="team-profile-stats"
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(4, minmax(0, 1fr))',
        },
        gap: 1.5,
        mt: 4,
      }}
    >
      <Tile label={t('teamProfile.stats.rating')} testId="team-profile-rating">
        <Big>{rating ?? '—'}</Big>
        <Typography sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted }}>
          {monthDelta ? (
            <Box
              component="span"
              data-testid="team-profile-month-delta"
              sx={{ color: monthDelta > 0 ? color.pick : color.ban }}
            >
              {t('teamProfile.stats.thisMonth', {
                delta: `${monthDelta > 0 ? '+' : ''}${monthDelta}`,
              })}
            </Box>
          ) : (
            t('teamProfile.stats.ratingNote')
          )}
        </Typography>
      </Tile>
      <Tile label={t('teamProfile.stats.record')} testId="team-profile-record">
        <Big>{played === 0 ? '—' : `${record.wins}–${record.losses}`}</Big>
        {record.last10.length > 0 && (
          <Box
            sx={{ display: 'flex', gap: 0.5 }}
            role="img"
            aria-label={t('teamProfile.stats.last10', {
              total: record.last10.length,
              won: record.last10.filter((r) => r === 'w').length,
            })}
          >
            {[...record.last10].reverse().map((r, i) => (
              <Box
                key={i}
                sx={{
                  flex: 1,
                  height: 20,
                  borderRadius: 0.5,
                  bgcolor: r === 'w' ? color.pick : color.ban,
                }}
              />
            ))}
          </Box>
        )}
      </Tile>
      <Tile label={t('teamProfile.stats.rounds')} testId="team-profile-rounds">
        <Big tone={diff > 0 ? color.pick : diff < 0 ? color.ban : undefined}>
          {rounds.won + rounds.lost === 0 ? '—' : `${diff > 0 ? '+' : ''}${diff}`}
        </Big>
        <Typography sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted }}>
          {t('teamProfile.stats.roundsNote', { won: rounds.won, lost: rounds.lost })}
        </Typography>
      </Tile>
      <Tile label={t('teamProfile.stats.trophies')} testId="team-profile-trophies">
        <Big tone={trophies.length > 0 ? color.accent : undefined}>
          {trophies.length > 0 ? trophies.length : '—'}
        </Big>
        <Typography
          noWrap
          title={trophies.join(' · ')}
          sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted }}
        >
          {trophies.length > 0
            ? trophies.slice(0, 2).join(' · ')
            : t('teamProfile.stats.noTrophies')}
        </Typography>
      </Tile>
    </Box>
  );
}
