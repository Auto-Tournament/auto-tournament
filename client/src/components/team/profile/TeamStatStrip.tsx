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
}

function Tile({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId: string;
}) {
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
 * average), its record with the last ten results, and its round difference.
 * Nothing shows for a team with no rated player and no finished match.
 */
export function TeamStatStrip({ numbers }: { numbers: TeamProfileNumbers }) {
  const { t } = useTranslation();
  const { rating, record, rounds } = numbers;
  const played = record.wins + record.losses;
  if (rating === null && played === 0) return null;
  const diff = rounds.won - rounds.lost;

  return (
    <Box
      data-testid="team-profile-stats"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
        gap: 1.5,
        mt: 4,
      }}
    >
      <Tile label={t('teamProfile.stats.rating')} testId="team-profile-rating">
        <Big>{rating ?? '—'}</Big>
        <Typography sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted }}>
          {t('teamProfile.stats.ratingNote')}
        </Typography>
      </Tile>
      <Tile label={t('teamProfile.stats.record')} testId="team-profile-record">
        <Big>
          {record.wins}–{record.losses}
        </Big>
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
    </Box>
  );
}
