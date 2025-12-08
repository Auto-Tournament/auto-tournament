import React from 'react';
import { Box, Typography, Grid, Paper, Chip, Stack, Avatar, IconButton, Tooltip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CircleIcon from '@mui/icons-material/Circle';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { ConnectedPlayer } from '../../hooks/usePlayerConnections';
import { normalizeConfigPlayers, type NormalizedPlayer } from '../../utils/playerUtils';
import { getPlayerPageUrl } from '../../utils/playerLinks';

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
  const team1Players = normalizeConfigPlayers(team1PlayersRaw);
  const team2Players = normalizeConfigPlayers(team2PlayersRaw);

  const getPlayerStatus = (steamId: string) => {
    console.log(`[PlayerRoster] Checking status for steamId: ${steamId}`);
    const connected = connectedPlayers.find((p) => {
      console.log(`  Comparing with connected player steamId: ${p.steamId}`);
      return p.steamId === steamId;
    });
    console.log(`  Result: ${connected ? 'CONNECTED' : 'OFFLINE'}, ready: ${connected?.isReady}`);
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
          <Typography variant="h6" fontWeight={600}>
            {teamName}
          </Typography>
          {isYourTeam && <Chip label="Your Team" color="primary" size="small" />}
        </Box>

        <Stack spacing={1}>
          {players.map((player) => {
            const status = getPlayerStatus(player.steamid);

            return (
              <Box
                key={player.steamid}
                sx={{
                  p: 1.5,
                  borderRadius: 1,
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
                  <CheckCircleIcon sx={{ color: 'success.light', fontSize: 20 }} />
                ) : status.isConnected ? (
                  <CircleIcon sx={{ color: 'warning.main', fontSize: 20 }} />
                ) : (
                  <PersonOffIcon sx={{ color: 'action.disabled', fontSize: 20 }} />
                )}

                {/* Avatar */}
                <Avatar
                  src={player.avatar}
                  alt={player.name}
                  sx={{ width: 32, height: 32 }}
                >
                  {player.name.charAt(0).toUpperCase()}
                </Avatar>

                {/* Player Name */}
                <Typography
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
                >
                  {player.name}
                </Typography>

                {/* Explicit player page action */}
                <Tooltip title="Open player page">
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
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                {/* Status Badge */}
                {status.isReady ? (
                  <Chip
                    label="READY"
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
                    label="CONNECTED"
                    size="small"
                    color="warning"
                    sx={{ fontWeight: 600, fontSize: '0.7rem' }}
                  />
                ) : (
                  <Chip
                    label="OFFLINE"
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
      <Typography variant="h6" fontWeight={600} mb={2}>
        Player Roster
      </Typography>
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
