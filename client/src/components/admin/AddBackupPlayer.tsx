import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  TextField,
  Button,
  Autocomplete,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Typography,
  Stack,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { api } from '../../utils/api';
import { normalizeConfigPlayers } from '../../utils/playerUtils';

interface Player {
  steamId: string;
  name: string;
  teamName: string;
  teamId: string;
}

interface AddBackupPlayerProps {
  matchSlug: string;
  serverId: string;
  team1Name: string;
  team2Name: string;
  existingTeam1Players: unknown;
  existingTeam2Players: unknown;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

export const AddBackupPlayer: React.FC<AddBackupPlayerProps> = ({
  matchSlug,
  serverId,
  team1Name,
  team2Name,
  existingTeam1Players,
  existingTeam2Players,
  onSuccess,
  onError,
}) => {
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [targetTeam, setTargetTeam] = useState<'team1' | 'team2'>('team1');
  const lastLoadedSlugRef = React.useRef<string | null>(null);
  const onErrorRef = React.useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const normalizedTeam1Players = useMemo(
    () => normalizeConfigPlayers(existingTeam1Players),
    [existingTeam1Players]
  );
  const normalizedTeam2Players = useMemo(
    () => normalizeConfigPlayers(existingTeam2Players),
    [existingTeam2Players]
  );

  const loadAllPlayers = useCallback(
    async (force = false) => {
      if (!matchSlug) return;
      if (!force && lastLoadedSlugRef.current === matchSlug) {
        return;
      }

      lastLoadedSlugRef.current = matchSlug;
      setLoading(true);
      try {
        const response = await api.get<{
          success: boolean;
          teams: Array<{
            id: string;
            name: string;
            players: Array<{ steamid?: string; steamId?: string; name: string }>;
          }>;
        }>('/api/teams');

        if (response.success && Array.isArray(response.teams)) {
          const players: Player[] = [];

          for (const team of response.teams) {
            if (!Array.isArray(team.players)) continue;
            for (const player of team.players) {
              const steamId = player.steamid || player.steamId;
              if (!steamId) continue;
              players.push({
                steamId,
                name: player.name,
                teamName: team.name,
                teamId: team.id,
              });
            }
          }

          setAllPlayers(players);
        }
      } catch (err) {
        console.error('Failed to load players:', err);
        if (onErrorRef.current) onErrorRef.current('Failed to load player list');
      } finally {
        setLoading(false);
      }
    },
    [matchSlug]
  );

  useEffect(() => {
    loadAllPlayers();
  }, [loadAllPlayers]);

  const existingSteamIds = useMemo(() => {
    const ids = new Set<string>();
    normalizedTeam1Players.forEach((player) => {
      if (player.steamid) ids.add(player.steamid);
    });
    normalizedTeam2Players.forEach((player) => {
      if (player.steamid) ids.add(player.steamid);
    });
    return ids;
  }, [normalizedTeam1Players, normalizedTeam2Players]);

  const availablePlayers = useMemo(
    () => allPlayers.filter((player) => player.steamId && !existingSteamIds.has(player.steamId)),
    [allPlayers, existingSteamIds]
  );

  useEffect(() => {
    if (selectedPlayer && existingSteamIds.has(selectedPlayer.steamId)) {
      setSelectedPlayer(null);
    }
  }, [existingSteamIds, selectedPlayer]);

  const handleAddPlayer = async () => {
    if (!selectedPlayer) return;

    setAdding(true);
    try {
      const response = await api.post<{ success: boolean; error: string }>(
        `/api/rcon/${serverId}/add-player`,
        {
          steamId: selectedPlayer.steamId,
          team: targetTeam,
          nickname: selectedPlayer.name,
        }
      );

      if (response.success) {
        if (onSuccess) {
          onSuccess(
            `Added ${selectedPlayer.name} to ${targetTeam === 'team1' ? team1Name : team2Name}`
          );
        }
        setSelectedPlayer(null);
        // Reload players to update the list
        loadAllPlayers(true);
      } else {
        if (onError) onError(response.error || 'Failed to add player');
      }
    } catch (err) {
      console.error('Error adding player:', err);
      if (onError) onError('Failed to add player to match');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} mb={2}>
        Add Backup Player
      </Typography>

      {loading ? (
        <Box display="flex" justifyContent="center" py={2}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <Stack spacing={2}>
          {/* Player Search */}
          <Autocomplete
            options={availablePlayers}
            value={selectedPlayer}
            onChange={(_event, newValue) => setSelectedPlayer(newValue)}
            getOptionLabel={(option) => `${option.name} (${option.teamName})`}
            renderOption={(props, option) => (
              <Box component="li" {...props}>
                <Box>
                  <Typography variant="body2">{option.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.teamName} • {option.steamId}
                  </Typography>
                </Box>
              </Box>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search for player"
                placeholder="Type player name..."
                helperText={`${availablePlayers.length} available players (not already in match)`}
              />
            )}
            noOptionsText="No players available"
            disabled={adding}
          />

          {/* Target Team Selection */}
          <FormControl fullWidth>
            <InputLabel>Add to Team</InputLabel>
            <Select
              value={targetTeam}
              label="Add to Team"
              onChange={(e) => setTargetTeam(e.target.value as 'team1' | 'team2')}
              disabled={adding}
            >
              <MenuItem value="team1">{team1Name} (Team 1)</MenuItem>
              <MenuItem value="team2">{team2Name} (Team 2)</MenuItem>
            </Select>
          </FormControl>

          {/* Selected Player Info */}
          {selectedPlayer && (
            <Alert severity="info">
              <Typography variant="body2">
                <strong>Selected:</strong> {selectedPlayer.name}
              </Typography>
              <Typography variant="caption" display="block">
                From team: {selectedPlayer.teamName}
              </Typography>
              <Typography variant="caption" display="block">
                Steam ID: {selectedPlayer.steamId}
              </Typography>
            </Alert>
          )}

          {/* Add Button */}
          <Button
            variant="contained"
            color="primary"
            startIcon={adding ? <CircularProgress size={20} /> : <PersonAddIcon />}
            onClick={handleAddPlayer}
            disabled={!selectedPlayer || adding}
            fullWidth
          >
            {adding ? 'Adding Player...' : 'Add Player to Match'}
          </Button>

          <Alert severity="warning" sx={{ fontSize: '0.85rem' }}>
            <Typography variant="caption">
              ⚠️ <strong>Important:</strong> The player must reconnect to the server after being
              added. They may need to restart CS2 if they're already connected.
            </Typography>
          </Alert>
        </Stack>
      )}
    </Box>
  );
};
