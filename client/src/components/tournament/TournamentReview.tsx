import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  Grid,
  Divider,
  CircularProgress,
} from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import EditIcon from '@mui/icons-material/Edit';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../../constants/tournament';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { api } from '../../utils/api';
import type { Map } from '../../types/api.types';
import { getMapDisplayName } from '../../constants/maps';

interface TournamentReviewProps {
  tournament: {
    name: string;
    type: string;
    format: string;
    teams: Array<{ id: string; name: string }>;
    maps: string[];
    teamSize?: number; // For shuffle tournaments
  };
  starting: boolean;
  saving: boolean;
  registeredPlayerCount?: number; // For shuffle tournaments
  onEdit?: () => void;
  onStart: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}

export const TournamentReview: React.FC<TournamentReviewProps> = ({
  tournament,
  starting,
  saving,
  registeredPlayerCount,
  onEdit,
  onStart,
  onRegenerate,
  onDelete,
}) => {
  const { showWarning } = useSnackbar();
  const isShuffle = tournament.type === 'shuffle';
  const teamSize = tournament.teamSize || 5;
  const minPlayers = teamSize * 2;
  const hasEnoughPlayers = registeredPlayerCount !== undefined ? registeredPlayerCount >= minPlayers : true;
  const canStart = !isShuffle || hasEnoughPlayers;
  const [availableMaps, setAvailableMaps] = useState<Map[]>([]);

  useEffect(() => {
    const loadMaps = async () => {
      try {
        const response = await api.get<{ maps: Map[] }>('/api/maps');
        if (response.maps) {
          setAvailableMaps(response.maps);
        }
      } catch (err) {
        console.error('Error loading maps:', err);
      }
    };
    loadMaps();
  }, []);

  const getDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : getMapDisplayName(mapId);
  };

  const handleStart = () => {
    if (!canStart && isShuffle) {
      showWarning(`Need at least ${minPlayers} players to start the tournament (${teamSize}v${teamSize} matches). Currently registered: ${registeredPlayerCount || 0}`);
      return;
    }
    onStart();
  };
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h5" fontWeight={600} mb={3} data-testid="tournament-name-display">
          {tournament.name} • {TOURNAMENT_TYPES.find((t) => t.value === tournament.type)?.label} •{' '}
          {MATCH_FORMATS.find((f) => f.value === tournament.format)?.label}
        </Typography>

        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, sm: 6 }}>

            {!isShuffle && (
              <>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Teams
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
                  {tournament.teams.map((team) => (
                    <Chip key={team.id} label={team.name} size="small" variant="outlined" />
                  ))}
                </Box>
              </>
            )}
          </Grid>

          {!isShuffle && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Maps
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1}>
                {tournament.maps.map((map: string) => (
                  <Chip key={map} label={getDisplayName(map)} size="small" variant="outlined" />
                ))}
              </Box>
            </Grid>
          )}
        </Grid>

        <Divider sx={{ my: 3 }} />

        <Box
          display="flex"
          gap={2}
          flexWrap="wrap"
          alignItems="center"
          sx={{
            '& > *': {
              flexShrink: 0,
            },
          }}
        >
          <Button
            variant="contained"
            size="large"
            startIcon={starting ? <CircularProgress size={20} color="inherit" /> : <RocketLaunchIcon />}
            onClick={handleStart}
            disabled={starting || saving}
            sx={{
              flex: { xs: '1 1 100%', sm: '1 1 auto' },
              minWidth: 200,
              ...(!canStart && {
                bgcolor: 'action.disabledBackground',
                color: 'action.disabled',
                '&:hover': {
                  bgcolor: 'action.disabledBackground',
                },
              }),
            }}
          >
            {starting ? 'Starting...' : 'Start Tournament'}
          </Button>

          {onEdit && (
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={onEdit}
              disabled={starting || saving}
            >
              Edit
            </Button>
          )}

          <Box display="flex" gap={1} flexWrap="wrap" sx={{ ml: { xs: 0, sm: 'auto' } }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={onRegenerate}
              disabled={saving}
            >
              Regenerate
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteForeverIcon />}
              onClick={onDelete}
              disabled={saving}
            >
              Delete
            </Button>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};
