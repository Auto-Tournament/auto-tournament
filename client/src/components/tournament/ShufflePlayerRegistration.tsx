import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Alert,
  CircularProgress,
  Tooltip,
  IconButton,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import InfoIcon from '@mui/icons-material/Info';
import { api } from '../../utils/api';
import PlayerSelectionModal from '../modals/PlayerSelectionModal';
// RegisteredPlayer matches the PlayerRecord type from the API
import { useSnackbar } from '../../contexts/SnackbarContext';

interface ShufflePlayerRegistrationProps {
  tournamentId: number;
  teamSize?: number; // Number of players per team (default: 5)
  onPlayersUpdated?: () => void;
}

interface RegisteredPlayer {
  id: string; // Steam ID
  name: string;
  avatar?: string;
  avatar_url?: string; // API may return this
  current_elo: number;
  starting_elo: number;
  match_count: number;
  registeredAt?: number;
}

export function ShufflePlayerRegistration({
  tournamentId,
  teamSize = 5,
  onPlayersUpdated,
}: ShufflePlayerRegistrationProps) {
  const [registeredPlayers, setRegisteredPlayers] = useState<RegisteredPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const { showSuccess, showError } = useSnackbar();
  const [playerSelectionOpen, setPlayerSelectionOpen] = useState(false);

  const loadRegisteredPlayers = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ success: boolean; players: RegisteredPlayer[] }>(
        `/api/tournament/${tournamentId}/players`
      );
      if (response.success && response.players) {
        setRegisteredPlayers(response.players);
      }
    } catch (err) {
      console.error('Failed to load registered players:', err);
      showError('Failed to load registered players');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRegisteredPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const handleSelectPlayers = async (selectedPlayerIds: string[]) => {
    setRegistering(true);

    try {
      const response = await api.put<{
        success: boolean;
        message: string;
        registered: number;
        unregistered: number;
        errors: Array<{ playerId: string; error: string }>;
      }>(`/api/tournament/${tournamentId}/set-players`, {
        playerIds: selectedPlayerIds,
      });

      if (response.success) {
        const added = response.registered || 0;
        const removed = response.unregistered || 0;
        const errors = response.errors || [];

        if (errors.length > 0) {
          showError(
            `Updated player registrations: ${added} added, ${removed} removed, but ${errors.length} error(s) occurred.`
          );
        } else {
          if (added > 0 || removed > 0) {
            showSuccess(`Updated player registrations: ${added} added, ${removed} removed.`);
          } else {
            showSuccess('Player registrations updated.');
          }
        }
        setPlayerSelectionOpen(false);
        await loadRegisteredPlayers();
        if (onPlayersUpdated) {
          onPlayersUpdated();
        }
      } else {
        showError(response.message || 'Failed to update player registrations');
      }

      if (response.errors && response.errors.length > 0) {
        const errorMessages = response.errors.map((e) => `${e.playerId}: ${e.error}`).join(', ');
        showError(`Some players failed to update: ${errorMessages}`);
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to update player registrations');
    } finally {
      setRegistering(false);
    }
  };

  const registeredPlayerIds = registeredPlayers.map((p) => p.id);

  return (
    <>
      <Card sx={{ width: '33%', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <CardContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            flex: 1,
            minHeight: 0,
            justifyContent: 'space-between',
          }}
        >
          <Box display="flex" alignItems="center" gap={1} mb={3}>
            <Typography variant="h6" fontWeight={600}>
              Player Registration
            </Typography>
            <Tooltip
              title={`Select players who will participate in the shuffle tournament. You can select or deselect players to update the registration list. Players are automatically assigned to balanced teams each round based on their ELO ratings. Minimum ${
                teamSize * 2
              } players required (for ${teamSize}v${teamSize} matches).`}
              arrow
              placement="top"
              enterDelay={500}
            >
              <IconButton size="small" sx={{ p: 0.5 }}>
                <InfoIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
          </Box>

          {loading ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              {registeredPlayers.length === 0 && (
                <Alert severity="warning" sx={{ mb: 2, width: '100%' }}>
                  <Typography variant="body2">
                    <strong>No players registered yet.</strong> Click &quot;Choose Players&quot; to
                    select players for this tournament.
                  </Typography>
                </Alert>
              )}

              {registeredPlayers.length > 0 && registeredPlayers.length < teamSize * 2 && (
                <Alert severity="warning" sx={{ mb: 2, width: '100%' }}>
                  <Typography variant="body2">
                    Need at least <strong>{teamSize * 2} players</strong> to start the tournament (
                    {teamSize}v{teamSize} matches).
                  </Typography>
                </Alert>
              )}

              {registeredPlayers.length >= teamSize * 2 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 2, width: '100%', textAlign: 'center' }}
                >
                  {registeredPlayers.length} {registeredPlayers.length === 1 ? 'player' : 'players'}{' '}
                  registered
                </Typography>
              )}

              <Button
                variant={registeredPlayers.length >= teamSize * 2 ? 'outlined' : 'contained'}
                startIcon={<PersonAddIcon />}
                onClick={() => setPlayerSelectionOpen(true)}
                disabled={registering}
                sx={{ width: '100%' }}
              >
                {registering
                  ? 'Updating...'
                  : registeredPlayers.length > 0
                    ? `Choose Players (${registeredPlayers.length})`
                    : 'Choose Players'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <PlayerSelectionModal
        open={playerSelectionOpen}
        onClose={() => setPlayerSelectionOpen(false)}
        onSelect={handleSelectPlayers}
        selectedPlayerIds={registeredPlayerIds}
        title="Choose Players for Tournament"
        confirmButtonText={registeredPlayers.length > 0 ? 'Update Players' : 'Register Players'}
      />
    </>
  );
}
