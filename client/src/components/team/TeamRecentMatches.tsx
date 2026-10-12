/**
 * A team's last matches on its page: the opponent, the series score and each
 * map's, win or loss, and each opens the match's own page.
 */

import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { LiveChip, Panel } from '../common/ui';
import { matchPagePath } from '../../paths';
import { tokens, fontMono, radii, textSize } from '../../theme/tokens';

const { color } = tokens;

export interface TeamRecentMatch {
  slug: string;
  live: boolean;
  result: 'w' | 'l' | null;
  opponentId: string | null;
  opponent: string | null;
  score: [number, number];
  maps: string | null;
  completedAt: number | null;
}

export function TeamRecentMatches({ matches }: { matches: TeamRecentMatch[] }) {
  const { t, i18n } = useTranslation();
  if (matches.length === 0) {
    return (
      <Panel sx={{ px: 3, py: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('teamProfile.matches.none')}
        </Typography>
      </Panel>
    );
  }
  return (
    <Box
      component="ul"
      sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1 }}
      data-testid="team-recent-matches"
    >
      {matches.map((m) => (
        <li key={m.slug}>
          <Box
            component={RouterLink}
            to={matchPagePath(m.slug)}
            sx={{
              display: 'grid',
              gridTemplateColumns: '2.2rem minmax(0, 1fr) auto',
              alignItems: 'center',
              gap: 1.5,
              px: 1.75,
              py: 1.25,
              borderRadius: radii.md,
              border: `1px solid ${color.rule}`,
              bgcolor: color.paper2,
              color: 'text.primary',
              textDecoration: 'none',
              '&:hover': { bgcolor: color.paper3 },
              '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
            }}
            data-testid={`team-match-${m.slug}`}
          >
            <Box
              sx={{
                fontFamily: fontMono,
                fontWeight: 700,
                fontSize: textSize.xs,
                textAlign: 'center',
                color: m.result === 'w' ? color.live : m.result === 'l' ? color.muted : color.ink2,
              }}
            >
              {m.live ? (
                <LiveChip label={t('teamProfile.matches.live')} />
              ) : m.result === 'w' ? (
                t('teamProfile.matches.w')
              ) : m.result === 'l' ? (
                t('teamProfile.matches.l')
              ) : (
                '—'
              )}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: textSize.sm }}>
                {t('teamProfile.matches.vs', { name: m.opponent ?? t('teamProfile.matches.tbd') })}
              </Typography>
              <Typography noWrap sx={{ fontSize: textSize.xs, color: color.muted }}>
                {[
                  m.maps,
                  m.completedAt
                    ? new Date(m.completedAt * 1000).toLocaleDateString(i18n.language, {
                        day: 'numeric',
                        month: 'short',
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
            </Box>
            <Typography sx={{ fontFamily: fontMono, fontWeight: 700 }}>
              {m.score[0]}–{m.score[1]}
            </Typography>
          </Box>
        </li>
      ))}
    </Box>
  );
}
