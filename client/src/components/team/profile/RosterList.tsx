import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlayerAvatar } from '../../player/PlayerAvatar';
import { getPlayerPageUrl } from '../../../utils/playerLinks';
import type { Player } from '../../../types';
import { radii } from '../../../theme/tokens';

interface RosterListProps {
  players: Player[];
}

/**
 * Public team profile roster. Only what the roster data actually carries:
 * avatar, name and current rating. No captain marker (the app has no captain
 * concept yet) and no "Steam linked" note (every CS2 roster entry implies it,
 * and whether the player has ever signed in isn't tracked, so there is
 * nothing extra to say).
 */
export function RosterList({ players }: RosterListProps) {
  const { t } = useTranslation();

  const sorted = [...players].sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0));

  return (
    <Card data-testid="team-profile-roster">
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <GroupsIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {t('teamProfile.roster.title')}
          </Typography>
        </Box>

        {sorted.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('teamProfile.roster.empty')}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {sorted.map((player, index) => (
              <Box
                key={player.steamId || index}
                data-testid="team-profile-roster-row"
                component={player.steamId ? RouterLink : 'div'}
                to={player.steamId ? getPlayerPageUrl(player.steamId) : undefined}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  p: 1.5,
                  borderRadius: radii.sm,
                  textDecoration: 'none',
                  color: 'inherit',
                  border: 1,
                  borderColor: 'divider',
                  minWidth: 0,
                  '&:hover': player.steamId
                    ? { bgcolor: 'action.hover', borderColor: 'primary.main' }
                    : undefined,
                }}
              >
                <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
                  <PlayerAvatar
                    id={player.steamId || String(index)}
                    name={player.name}
                    avatarUrl={player.avatar}
                    size={36}
                  />
                  <Typography variant="body1" fontWeight={500} noWrap>
                    {player.name}
                  </Typography>
                </Box>
                {typeof player.elo === 'number' && (
                  <Chip
                    size="small"
                    label={t('teamProfile.roster.rating', { rating: player.elo })}
                    sx={{ flexShrink: 0 }}
                  />
                )}
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
