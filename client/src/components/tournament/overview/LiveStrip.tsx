import { Box, Link as MuiLink } from '@mui/material';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LiveChip } from '../../common/ui';
import type { Match } from '../../../types';
import { radii, tokens, textSize } from '../../../theme/tokens';
import { seriesScore } from '../page/matchHelpers';

interface LiveStripProps {
  /** The matches being played right now. */
  matches: Match[];
  linkLabel: string;
  linkTo: string;
}

/**
 * Slim "live now" strip (the draft's `.live-strip`): a live chip, each live
 * match as "Team 1–0 Team", and a link to the Matches tab. Only shown while
 * something is actually live.
 */
export function LiveStrip({ matches, linkLabel, linkTo }: LiveStripProps) {
  const { t } = useTranslation();
  if (matches.length === 0) return null;

  return (
    <Box
      data-testid="overview-live-strip"
      aria-label={t('overviewPage.liveStripLabel')}
      role="region"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1,
        border: `1px solid ${tokens.color.rule}`,
        borderRadius: radii.pill,
        overflowX: 'auto',
        fontSize: textSize.sm,
        whiteSpace: 'nowrap',
      }}
    >
      <LiveChip label={t('overviewPage.liveNow', { count: matches.length })} />
      {matches.map((match) => {
        const score = seriesScore(match);
        return (
          <Box
            key={match.id}
            component="span"
            sx={{
              display: 'inline-flex',
              gap: 1,
              pl: 1.5,
              borderLeft: `1px solid ${tokens.color.rule}`,
            }}
          >
            {match.team1?.name ?? '?'}
            <Box component="b" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {score.team1}–{score.team2}
            </Box>
            {match.team2?.name ?? '?'}
          </Box>
        );
      })}
      <MuiLink
        component={Link}
        to={linkTo}
        underline="none"
        data-testid="overview-live-strip-link"
        sx={{
          ml: 'auto',
          pl: 1.5,
          color: tokens.color.muted,
          '&:hover': { color: tokens.color.ink },
        }}
      >
        {linkLabel}
      </MuiLink>
    </Box>
  );
}
