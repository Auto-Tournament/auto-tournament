import { Box, Card, CardContent, Chip, Button, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Team } from '../../../types';
import { fontDisplay, mono, radii } from '../../../theme/tokens';

interface TeamHeaderProps {
  team: Team | null;
  /** Only admins may edit a team today — there is no captain concept in the data yet. */
  canEdit: boolean;
}

/**
 * Public team profile header: crest tile, name/tag and the (single, for now)
 * game the team plays. No logo, location or "since" year — the team record
 * carries none of those today, so they are left out rather than faked.
 */
export function TeamHeader({ team, canEdit }: TeamHeaderProps) {
  const { t } = useTranslation();

  const initial = (team?.name || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <Card data-testid="team-profile-header">
      <CardContent>
        <Box
          display="flex"
          alignItems="center"
          gap={2}
          sx={{ flexWrap: { xs: 'wrap', sm: 'nowrap' } }}
        >
          <Box
            aria-hidden
            sx={{
              width: 64,
              height: 64,
              flexShrink: 0,
              borderRadius: radii.md,
              bgcolor: 'background.surface2',
              border: 1,
              borderColor: 'divider',
              display: 'grid',
              placeItems: 'center',
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: '1.75rem',
              color: 'primary.main',
            }}
          >
            {initial}
          </Box>

          <Box flex={1} minWidth={0}>
            <Typography
              variant="h4"
              component="h1"
              sx={{ fontSize: { xs: '1.5rem', sm: '1.875rem' }, overflowWrap: 'anywhere' }}
            >
              {team?.tag && (
                <Box component="span" sx={{ ...mono, color: 'primary.main', fontSize: '0.7em', mr: 1 }}>
                  [{team.tag}]
                </Box>
              )}
              {team?.name}
            </Typography>
            <Box display="flex" gap={1} mt={1} flexWrap="wrap">
              <Chip
                size="small"
                icon={<SportsEsportsIcon fontSize="small" />}
                label={t('teamProfile.game')}
                variant="outlined"
              />
            </Box>
          </Box>

          {canEdit && team && (
            <Button
              data-testid="team-profile-edit-link"
              variant="outlined"
              size="small"
              startIcon={<EditIcon />}
              component={RouterLink}
              to="/teams"
              sx={{ flexShrink: 0 }}
            >
              {t('teamProfile.editTeam')}
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
