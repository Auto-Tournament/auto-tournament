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
  Tooltip,
} from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../../constants/tournament';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { api } from '../../utils/api';
import { useIsDevelopment } from '../../hooks/useIsDevelopment';
import { useSimulationMode } from '../../hooks/useSimulationMode';
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
  hasBracket?: boolean;
  onBulkCreateShuffleMatches?: () => void;
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
  hasBracket,
  onBulkCreateShuffleMatches,
}) => {
  const { t } = useTranslation();
  const { showWarning } = useSnackbar();
  const isShuffle = tournament.type === 'shuffle';
  const teamSize = tournament.teamSize || 5;
  const minPlayers = teamSize * 2;
  const hasEnoughPlayers =
    registeredPlayerCount !== undefined ? registeredPlayerCount >= minPlayers : true;
  const canStart = !isShuffle || hasEnoughPlayers;
  const canRegenerate = !isShuffle && (hasBracket ?? true);
  const [availableMaps, setAvailableMaps] = useState<Map[]>([]);
  const isDev = useIsDevelopment();
  const { simulationEnabled } = useSimulationMode();

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

  useEffect(() => {
    // no-op placeholder to keep hooks grouping clear; simulation mode is
    // handled by useSimulationMode and doesn't need extra effects here.
  }, [isDev, simulationEnabled]);

  const getDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : getMapDisplayName(mapId);
  };

  const handleStart = () => {
    if (!canStart && isShuffle) {
      showWarning(
        t('tournament.reviewCard.needPlayersWarning', {
          minPlayers,
          teamSize,
          registered: registeredPlayerCount || 0,
        })
      );
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
                  {t('tournament.labels.teams')}
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
                {t('tournament.labels.maps')}
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
            startIcon={
              starting ? (
                <CircularProgress size={20} color="inherit" />
              ) : simulationEnabled ? (
                <SmartToyIcon />
              ) : (
                <RocketLaunchIcon />
              )
            }
            onClick={handleStart}
            disabled={starting || saving}
            data-testid="tournament-start-button"
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
            {starting
              ? simulationEnabled
                ? t('tournament.reviewCard.startingSimulation')
                : t('tournament.reviewCard.starting')
              : simulationEnabled
              ? t('tournament.reviewCard.startSimulation')
              : t('tournament.reviewCard.start')}
          </Button>

          {isShuffle && onBulkCreateShuffleMatches && (
            <Button
              variant="outlined"
              size="large"
              onClick={onBulkCreateShuffleMatches}
              disabled={starting || saving}
            >
              {t('tournament.reviewCard.bulkCreateMatches')}
            </Button>
          )}

          {onEdit && (
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={onEdit}
              disabled={starting || saving}
            >
              {t('tournament.reviewCard.edit')}
            </Button>
          )}

          <Box display="flex" gap={1} flexWrap="wrap" sx={{ ml: { xs: 0, sm: 'auto' } }}>
            {!isShuffle && (
              <Tooltip
                title={
                  canRegenerate
                    ? t('tournament.reviewCard.regenerateTooltip')
                    : t('tournament.reviewCard.regenerateDisabledTooltip')
                }
                enterDelay={500}
              >
                <Box component="span">
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={onRegenerate}
                    disabled={saving || !canRegenerate}
                  >
                    {t('tournament.reviewCard.regenerate')}
                  </Button>
                </Box>
              </Tooltip>
            )}
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteForeverIcon />}
              onClick={onDelete}
              disabled={saving}
            >
              {t('common.delete')}
            </Button>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};
