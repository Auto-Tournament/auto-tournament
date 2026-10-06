import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { OverviewTeamStanding } from '../../../hooks/usePublicTournamentOverview';
import { tokens, fontDisplay, radii } from '../../../theme/tokens';

const { color } = tokens;
const SHOWN = 6;

/** "SIV" from a tag, or the first letters of the name. */
function initials(team: OverviewTeamStanding): string {
  const tag = team.tag?.trim();
  if (tag) return tag.slice(0, 4).toUpperCase();
  return team.name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

/**
 * A quick look at who is in: the teams' marks in a row and how many there
 * are. The full list is the Teams tab, which the card links to.
 */
export function TeamsPreviewCard({ teams, to }: { teams: OverviewTeamStanding[]; to: string }) {
  const { t } = useTranslation();
  const extra = teams.length - SHOWN;

  return (
    <Box
      component={RouterLink}
      to={to}
      data-testid="overview-teams-card"
      sx={{
        minHeight: 68,
        px: 2.5,
        py: 1.75,
        boxSizing: 'border-box',
        borderRadius: radii.lg,
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        color: color.ink,
        textDecoration: 'none',
        '&:hover': { borderColor: color.muted },
        '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
      }}
    >
      <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.125rem', fontWeight: 600 }}>
        {t('overviewPage.tabs.teams')}
      </Typography>
      <Typography sx={{ fontSize: '0.875rem', color: color.muted, whiteSpace: 'nowrap' }}>
        {teams.length}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, ml: 'auto', minWidth: 0, overflow: 'hidden' }} aria-hidden>
        {teams.slice(0, SHOWN).map((team) => (
          <Box
            key={team.teamId}
            component="span"
            title={team.name}
            sx={{
              width: 32,
              height: 32,
              flex: 'none',
              borderRadius: '8px',
              bgcolor: color.paper3,
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: '0.625rem',
              color: color.ink2,
            }}
          >
            {initials(team)}
          </Box>
        ))}
        {extra > 0 && (
          <Box
            component="span"
            sx={{
              height: 32,
              px: 1,
              borderRadius: '8px',
              border: `1px dashed ${color.rule}`,
              display: 'grid',
              placeItems: 'center',
              fontSize: '0.75rem',
              color: color.muted,
            }}
          >
            +{extra}
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', color: color.ink2 }} aria-hidden>
        <ArrowRightIcon size={18} />
      </Box>
    </Box>
  );
}
