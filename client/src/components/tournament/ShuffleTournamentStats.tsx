import React from 'react';
import { Box, Typography, Card, CardContent, Divider } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import DnsIcon from '@mui/icons-material/Dns';

interface ShuffleTournamentStatsProps {
  playerCount: number;
  teamSize: number;
}

export function ShuffleTournamentStats({ playerCount, teamSize }: ShuffleTournamentStatsProps) {
  // Calculate teams: divide players by team size (round down)
  const numberOfTeams = Math.floor(playerCount / teamSize);
  
  // Calculate matches per round: teams / 2 (round down)
  const matchesPerRound = Math.floor(numberOfTeams / 2);
  
  // Servers needed = matches per round (each match needs a server)
  const serversNeeded = matchesPerRound;

  return (
    <Card sx={{ width: '33%', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flex: 1, minHeight: 0 }}>
        <Typography variant="h6" fontWeight={600} mb={3}>
          Tournament Stats
        </Typography>

        <Box sx={{ width: '100%' }}>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Box display="flex" alignItems="center" gap={1}>
              <GroupsIcon color="action" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                Teams per Round
              </Typography>
            </Box>
            <Typography variant="h6" fontWeight={600}>
              {playerCount >= teamSize * 2 ? numberOfTeams : 0}
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Box display="flex" alignItems="center" gap={1}>
              <SportsEsportsIcon color="action" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                Matches per Round
              </Typography>
            </Box>
            <Typography variant="h6" fontWeight={600}>
              {playerCount >= teamSize * 2 ? matchesPerRound : 0}
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={1}>
              <DnsIcon color="action" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                Servers Needed
              </Typography>
            </Box>
            <Typography variant="h6" fontWeight={600}>
              {playerCount >= teamSize * 2 ? serversNeeded : 0}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

