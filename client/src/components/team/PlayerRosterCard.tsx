import React from 'react';
import { Box, Card, CardContent, Typography, Stack, Paper, IconButton, Tooltip } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { SteamIcon } from '../icons/SteamIcon';
import { PlayerAvatar } from '../player/PlayerAvatar';
import type { Team } from '../../types';
import { getPlayerPageUrl } from '../../utils/playerLinks';

interface PlayerRosterCardProps {
  team: Team | null;
}

export function PlayerRosterCard({ team }: PlayerRosterCardProps) {
  if (!team?.players || team.players.length === 0) {
    return null;
  }

  // Normalise and sort players by rating (ELO) descending so the strongest
  // players appear at the top of the roster.
  const sortedPlayers = team.players
    .map((player, index) => {
      const base =
        typeof player === 'object' ? player : { steamId: String(index), name: 'Unknown' };
      const displayElo =
        typeof (base as { elo?: number }).elo === 'number'
          ? (base as { elo?: number }).elo!
          : 1500;
      return { ...base, displayElo, index };
    })
    .sort((a, b) => b.displayElo - a.displayElo);

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <PersonIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Team Roster
          </Typography>
        </Box>
        <Stack spacing={1.5}>
          {sortedPlayers.map((player) => {
            const playerName = String((player as { name?: string }).name || 'Unknown');
            const playerSteamId = String((player as { steamId?: string }).steamId || '');
            const displayElo = player.displayElo;

            return (
              <Paper
                key={playerSteamId || player.index}
                variant="outlined"
                sx={{
                  p: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: 'action.hover',
                    borderColor: 'primary.main',
                  },
                }}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <PlayerAvatar
                    id={playerSteamId || String(player.index)}
                    name={playerName}
                    avatarUrl={(player as { avatar?: string }).avatar}
                    size={40}
                  />
                  <Box>
                    <Typography variant="body1" fontWeight={500}>
                      {playerName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Rating: {displayElo}
                    </Typography>
                  </Box>
                </Box>
                <Box display="flex" alignItems="center" gap={0.5}>
                  {playerSteamId && (
                    <Tooltip title="View player stats">
                      <IconButton
                        size="small"
                        color="primary"
                        component="a"
                        href={getPlayerPageUrl(playerSteamId)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {playerSteamId && (
                    <Tooltip title="View Steam profile">
                      <IconButton
                        size="small"
                        color="inherit"
                        component="a"
                        href={`https://steamcommunity.com/profiles/${playerSteamId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <SteamIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Paper>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
