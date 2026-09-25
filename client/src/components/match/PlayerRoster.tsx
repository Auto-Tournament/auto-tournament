import React from 'react';
import { Box, Typography, Grid, Paper, Chip, Stack, IconButton, Tooltip } from '@mui/material';
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CircleIcon,
  UserMinusIcon,
} from '@phosphor-icons/react';
import type { ConnectedPlayer } from '../../hooks/usePlayerConnections';
import { normalizeConfigPlayers, type NormalizedPlayer } from '../../utils/playerUtils';
import { getPlayerPageUrl } from '../../utils/playerLinks';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { useTranslation } from 'react-i18next';
import { PlayerName } from '../player/PlayerName';
import { radii } from '../../theme/tokens';

interface PlayerRosterProps {
  team1Name: string;
  team2Name: string;
  team1Players: unknown;
  team2Players: unknown;
  connectedPlayers: ConnectedPlayer[];
  isTeam1?: boolean; // If viewing from team perspective
}

export const PlayerRoster: React.FC<PlayerRosterProps> = ({
  team1Name,
  team2Name,
  team1Players: team1PlayersRaw,
  team2Players: team2PlayersRaw,
  connectedPlayers,
  isTeam1,
}) => {
  const { t } = useTranslation();
  const team1Players = normalizeConfigPlayers(team1PlayersRaw);
  const team2Players = normalizeConfigPlayers(team2PlayersRaw);

  const getPlayerStatus = (steamId: string) => {
    const connected = connectedPlayers.find((p) => p.steamId === steamId);
    return {
      isConnected: !!connected,
      isReady: connected?.isReady || false,
    };
  };

  const renderPlayerList = (
    teamName: string,
    players: NormalizedPlayer[],
    teamColor: 'primary' | 'error',
    isYourTeam?: boolean
  ) => {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6" fontWeight={600} color={`${teamColor}.main`}>
            {teamName}
          </Typography>
          {isYourTeam && (
            <Chip label={t('matchDetailsModal.roster.yourTeam')} color="primary" size="small" />
          )}
        </Box>

        <Stack spacing={1}>
          {players.map((player) => {
            const status = getPlayerStatus(player.steamid);

            return (
              <Box
                key={player.steamid}
                sx={{
                  p: 1.5,
                  borderRadius: radii.sm,
                  bgcolor: status.isReady
                    ? 'success.dark'
                    : status.isConnected
                    ? 'action.hover'
                    : 'action.disabledBackground',
                  border: 1,
                  borderColor: status.isReady
                    ? 'success.main'
                    : status.isConnected
                    ? 'divider'
                    : 'action.disabled',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  transition: 'all 0.3s',
                }}
              >
                {/* Status Icon */}
                {status.isReady ? (
                  <Box component={CheckCircleIcon} size={20} sx={{ color: 'success.light' }} />
                ) : status.isConnected ? (
                  <Box component={CircleIcon} weight="fill" size={20} sx={{ color: 'warning.main' }} />
                ) : (
                  <Box component={UserMinusIcon} size={20} sx={{ color: 'action.disabled' }} />
                )}

                {/* Avatar */}
                <PlayerAvatar
                  id={player.steamid}
                  name={player.name}
                  avatarUrl={player.avatar}
                  size={32}
                />

                {/* Player Name */}
                <PlayerName
                  name={player.name}
                  // Live roster data does not currently include isAdmin info; this will
                  // render as normal text unless extended in the future.
                  variant="body2"
                  sx={{
                    flex: 1,
                    color: status.isReady
                      ? 'success.contrastText'
                      : status.isConnected
                      ? 'primary.main'
                      : 'text.disabled',
                    fontWeight: status.isConnected ? 600 : 400,
                  }}
                />

                {/* Explicit player page action */}
                <Tooltip title={t('matchDetailsModal.roster.openPlayerPage')}>
                  <IconButton
                    size="small"
                    component="a"
                    href={getPlayerPageUrl(player.steamid)}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      color:
                        status.isReady || status.isConnected
                          ? 'primary.contrastText'
                          : 'text.secondary',
                    }}
                  >
                    <ArrowSquareOutIcon size={20} />
                  </IconButton>
                </Tooltip>

                {/* Status Badge */}
                {status.isReady ? (
                  <Chip
                    label={t('matchDetailsModal.roster.ready')}
                    size="small"
                    sx={{
                      bgcolor: 'success.light',
                      color: 'success.contrastText',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                    }}
                  />
                ) : status.isConnected ? (
                  <Chip
                    label={t('matchDetailsModal.roster.connected')}
                    size="small"
                    color="warning"
                    sx={{ fontWeight: 600, fontSize: '0.7rem' }}
                  />
                ) : (
                  <Chip
                    label={t('matchDetailsModal.roster.offline')}
                    size="small"
                    sx={{
                      bgcolor: 'action.disabled',
                      color: 'text.disabled',
                      fontSize: '0.7rem',
                    }}
                  />
                )}
              </Box>
            );
          })}
        </Stack>
      </Paper>
    );
  };

  return (
    <Box>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          {renderPlayerList(team1Name, team1Players, 'primary', isTeam1 === true)}
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          {renderPlayerList(team2Name, team2Players, 'error', isTeam1 === false)}
        </Grid>
      </Grid>
    </Box>
  );
};
