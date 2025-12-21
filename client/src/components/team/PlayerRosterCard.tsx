import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Paper,
  IconButton,
  Tooltip,
  Avatar,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { SteamIcon } from '../icons/SteamIcon';
import type { Team } from '../../types';
import { getPlayerPageUrl } from '../../utils/playerLinks';

interface PlayerRosterCardProps {
  team: Team | null;
}

export function PlayerRosterCard({ team }: PlayerRosterCardProps) {
  if (!team?.players || team.players.length === 0) {
    return null;
  }

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
          {team.players.map((player, index) => {
            // Handle both object format and potential data issues
            console.log('player', player);
            const playerData =
              typeof player === 'object' ? player : { steamId: String(index), name: 'Unknown' };
            const playerName = String(playerData.name || 'Unknown');
            const playerSteamId = String(playerData.steamId || '');

            return (
              <Paper
                key={playerSteamId || index}
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
                  <Avatar
                    src={playerData.avatar}
                    alt={playerName}
                    sx={{ width: 40, height: 40 }}
                  >
                    {playerName.charAt(0).toUpperCase()}
                  </Avatar>
                  <Typography variant="body1" fontWeight={500}>
                    {playerName}
                  </Typography>
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
