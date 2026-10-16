import type React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Team } from '../../../types';
import { TeamLogo, teamColor, useTeamColors } from '../../tournament/ui/draftUi';
import { fontDisplay, mono, radii, textSize, tokens, withAlpha } from '../../../theme/tokens';

interface TeamHeaderProps {
  team: Team | null;
  /** Only admins may edit a team today. */
  canEdit: boolean;
  /** The game the team plays in its tournament, for the eyebrow. */
  game?: { slug: string; name: string } | null;
  /** The team's uploaded logo, shown in place of its initials. */
  logoUrl?: string | null;
  /** The team's banner; without one the team's colour fills the strip. */
  bannerUrl?: string | null;
  /** How many players are on the roster. */
  players?: number;
  /** The team's owner, by name. */
  owner?: string | null;
  /** The team's rating, when it has one. */
  rating?: number | null;
  /** Buttons for the viewer's own team (Manage, Leave), right of the name. */
  actions?: React.ReactNode;
}

/**
 * Public team profile header (the 3.0 draft's TeamHeader board): the team's
 * banner, or its colour, across the top; the logo overlapping its lower edge;
 * then "Team · <game>", the name as the page's H1, and "5 players · owner … ·
 * rating …" under it, with the viewer's own actions on the right.
 */
export function TeamHeader({
  team,
  canEdit,
  game,
  logoUrl,
  bannerUrl,
  players,
  owner,
  rating,
  actions,
}: TeamHeaderProps) {
  const { t } = useTranslation();
  useTeamColors();
  const tone = teamColor(team?.id || team?.name || '');

  const facts = [
    typeof players === 'number' ? t('teamProfile.header.players', { count: players }) : null,
    owner ? t('teamProfile.header.owner', { name: owner }) : null,
    typeof rating === 'number'
      ? t('teamProfile.header.rating', { rating: Math.round(rating) })
      : null,
  ].filter(Boolean);

  const action = actions ? (
    actions
  ) : canEdit && team ? (
    <Button
      data-testid="team-profile-edit-link"
      variant="outlined"
      size="small"
      component={RouterLink}
      to="/manage/teams"
    >
      {t('teamProfile.editTeam')}
    </Button>
  ) : null;

  return (
    <Box
      component="section"
      aria-labelledby="team-name"
      data-testid="team-profile-header"
      sx={{ borderRadius: radii.lg, overflow: 'hidden', bgcolor: tokens.color.paper }}
    >
      <Box
        data-testid="team-profile-banner"
        sx={{ position: 'relative', height: { xs: 140, sm: 220 }, bgcolor: tokens.color.paper3 }}
      >
        {bannerUrl ? (
          <Box
            component="img"
            src={bannerUrl}
            alt=""
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(120deg, ${tone}, ${withAlpha(tone, 0.08)} 75%)`,
            }}
          />
        )}
      </Box>
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: { xs: 2, sm: 2.5 },
          px: { xs: 2, sm: 3.5 },
          pt: 2,
          pb: 3,
        }}
      >
        <TeamLogo
          team={team ? { id: team.id, name: team.name, tag: team.tag, logoUrl } : null}
          size="xl"
          // Only the logo overlaps the banner; the text stays on the page colour.
          sx={{ outline: `4px solid ${tokens.color.paper}`, mt: '-60px' }}
        />
        <Box
          sx={{
            flex: '1 1 280px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
          }}
        >
          <Typography
            component="span"
            data-testid="team-profile-game"
            sx={{
              fontSize: textSize.xs,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: tokens.color.muted,
            }}
          >
            {game
              ? t('teamProfile.header.eyebrowGame', { game: game.name })
              : t('teamProfile.header.eyebrow')}
          </Typography>
          <Typography
            id="team-name"
            component="h1"
            sx={{
              m: 0,
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: { xs: '2rem', sm: '2.5rem' },
              lineHeight: 1.1,
              overflowWrap: 'anywhere',
              textWrap: 'balance',
            }}
          >
            {team?.tag && (
              <Box
                component="span"
                sx={{ ...mono, color: tokens.color.accent, fontSize: '0.6em', mr: 1.5 }}
              >
                [{team.tag}]
              </Box>
            )}
            {team?.name}
          </Typography>
          {facts.length > 0 && (
            <Typography sx={{ fontSize: textSize.sm, color: tokens.color.ink2 }}>
              {facts.join(' · ')}
            </Typography>
          )}
        </Box>
        {action && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignSelf: 'center' }}>
            {action}
          </Box>
        )}
      </Box>
    </Box>
  );
}
