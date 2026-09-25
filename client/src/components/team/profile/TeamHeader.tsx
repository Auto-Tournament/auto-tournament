import { Box, Button } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Team } from '../../../types';
import { PageHead } from '../../common/ui';
import { GameMark } from '../../common/GameMark';
import { fontDisplay, mono, radii, textSize, tokens } from '../../../theme/tokens';

interface TeamHeaderProps {
  team: Team | null;
  /** Only admins may edit a team today. */
  canEdit: boolean;
  /** The game the team plays in its tournament, for the game badge. */
  game?: { slug: string; name: string } | null;
}

/**
 * Public team profile header (the draft's `.club`): an 80px crest, then the
 * page head — the team's name as the page's H1, "captain …" under it and
 * "Edit team" on the right — and the team's game below.
 *
 * No logo, location or "since" year: the team record carries none of those,
 * so they are left out rather than faked.
 */
export function TeamHeader({ team, canEdit, game }: TeamHeaderProps) {
  const { t } = useTranslation();

  const initial = (team?.name || '?').trim().charAt(0).toUpperCase() || '?';
  const captain = team?.players?.find((p) => p.role === 'captain');

  return (
    <Box
      component="section"
      aria-label={t('teamProfile.headerLabel')}
      data-testid="team-profile-header"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        gap: { xs: 2, sm: 3 },
        alignItems: 'center',
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 80,
          height: 80,
          borderRadius: radii.md,
          bgcolor: tokens.color.paper3,
          border: `1px solid ${tokens.color.rule}`,
          display: 'grid',
          placeItems: 'center',
          fontFamily: fontDisplay,
          fontWeight: 700,
          fontSize: textSize['2xl'],
          color: tokens.color.accent,
        }}
      >
        {initial}
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <PageHead
          sx={{ mb: 0, alignItems: 'center' }}
          title={
            <>
              {team?.tag && (
                <Box
                  component="span"
                  sx={{ ...mono, color: tokens.color.accent, fontSize: '0.6em', mr: 1.5 }}
                >
                  [{team.tag}]
                </Box>
              )}
              {team?.name}
            </>
          }
          subtitle={captain ? t('teamProfile.captainLine', { name: captain.name }) : undefined}
          actions={
            canEdit && team ? (
              <Button
                data-testid="team-profile-edit-link"
                variant="outlined"
                size="small"
                component={RouterLink}
                to="/teams"
              >
                {t('teamProfile.editTeam')}
              </Button>
            ) : undefined
          }
        />
        {game && (
          <Box
            data-testid="team-profile-game"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              mt: 1.5,
              fontSize: textSize.xs,
              color: tokens.color.ink2,
            }}
          >
            <GameMark name={game.name} slug={game.slug} size={24} />
            {game.name}
          </Box>
        )}
      </Box>
    </Box>
  );
}
