import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Chip,
  Box,
  Stack,
  Divider,
} from '@mui/material';
import { EmojiEvents as TournamentIcon } from '@mui/icons-material';
import type { Tournament } from '../../types';

interface TournamentInfoCardProps {
  tournament: Tournament | null;
}

export default function TournamentInfoCard({ tournament }: TournamentInfoCardProps) {
  if (!tournament) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <TournamentIcon color="primary" />
            <Typography component="h2" variant="subtitle2" sx={{ fontWeight: 600 }}>
              Tournament Info
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            No tournament information available.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'warning' | 'error' => {
    switch (status) {
      case 'in_progress':
        return 'success';
      case 'completed':
        return 'default';
      case 'setup':
        return 'warning';
      default:
        return 'default';
    }
  };

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <TournamentIcon color="primary" />
          <Typography component="h2" variant="subtitle2" sx={{ fontWeight: 600 }}>
            Tournament Info
          </Typography>
        </Box>
        <Stack spacing={2}>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Status
            </Typography>
            <Chip
              label={tournament.status.replace('_', ' ').toUpperCase()}
              size="small"
              color={getStatusColor(tournament.status)}
              sx={{ fontWeight: 600 }}
            />
          </Box>
          <Divider />
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Type
            </Typography>
            <Typography variant="body1" fontWeight={600}>
              {tournament.type?.replace('_', ' ').toUpperCase() || 'N/A'}
            </Typography>
          </Box>
          <Divider />
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Format
            </Typography>
            <Typography variant="body1" fontWeight={600}>
              {tournament.format?.toUpperCase() || 'N/A'}
            </Typography>
          </Box>
          {tournament.description && (
            <>
              <Divider />
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Description
                </Typography>
                <Typography variant="body2">
                  {tournament.description}
                </Typography>
              </Box>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

