import React from 'react';
import { Box, Typography, Grid, Paper, Chip, Stack } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CircleIcon from '@mui/icons-material/Circle';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import type { ConnectedPlayer } from '../../hooks/usePlayerConnections';

interface PlayerRosterProps {
  team1Name: string;
  team2Name: string;
  team1Players: Array<{ steamid: string; name: string }>;
  team2Players: Array<{ steamid: string; name: string }>;
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
  // Convert players to array format if they're objects
  const normalizePlayers = (players: unknown): Array<{ steamid: string; name: string }> => {
    if (!players) return [];
    if (Array.isArray(players)) {
      // Already an array, ensure each player has correct format
      return players.map((player, index) => {
        if (typeof player === 'string') {
          return { steamid: `player_${index}`, name: player };
        }
        if (player && typeof player === 'object') {
          const p = player as {
            steamid?: string;
            steamId?: string;
            name?: string | { name: string; steamId: string };
          };
          // Handle nested name object
          const playerName =
            typeof p.name === 'object' && p.name !== null
              ? p.name.name
              : String(p.name || 'Unknown');
          const playerSteamId =
            p.steamid ||
            p.steamId ||
            (typeof p.name === 'object' && p.name !== null ? p.name.steamId : undefined) ||
            `player_${index}`;
          return { steamid: playerSteamId, name: playerName };
        }
        return { steamid: `player_${index}`, name: 'Unknown' };
      });
    }

    // Handle object format: {0: {name, steamId}, 1: {...}} or {steamid: name}
    if (typeof players === 'object') {
      return Object.entries(players).map(([key, player]) => {
        if (typeof player === 'string') {
          return { steamid: `player_${key}`, name: player };
        }
        if (player && typeof player === 'object') {
          const p = player as {
            steamid?: string;
            steamId?: string;
            name?: string | { name: string; steamId: string };
          };
          // Handle nested name object
          const playerName =
            typeof p.name === 'object' && p.name !== null
              ? p.name.name
              : String(p.name || 'Unknown');
          const playerSteamId =
            p.steamid ||
            p.steamId ||
            (typeof p.name === 'object' && p.name !== null ? p.name.steamId : undefined) ||
            `player_${key}`;
          return { steamid: playerSteamId, name: playerName };
        }
        return { steamid: `player_${key}`, name: 'Unknown' };
      });
    }

    return [];
  };

  const team1Players = normalizePlayers(team1PlayersRaw);
  const team2Players = normalizePlayers(team2PlayersRaw);

  // Debug: Log what we're working with
  React.useEffect(() => {
    console.log('[PlayerRoster] Team 1 Players:', team1Players);
    console.log('[PlayerRoster] Team 2 Players:', team2Players);
    console.log('[PlayerRoster] Connected Players:', connectedPlayers);
  }, [team1Players, team2Players, connectedPlayers]);

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
    players: Array<{ steamid: string; name: string }>,
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

                {/* Player Name */}
                <Typography
                  variant="body2"
                  sx={{
                    flex: 1,
                    color: status.isReady
                      ? 'success.contrastText'
                      : status.isConnected
                      ? 'text.primary'
                      : 'text.disabled',
                    fontWeight: status.isConnected ? 600 : 400,
                  }}
                >
                  {player.name}
                </Typography>

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
