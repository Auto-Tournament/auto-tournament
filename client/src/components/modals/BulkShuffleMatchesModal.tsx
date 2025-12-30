import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  IconButton,
  Stack,
  Grid,
  Chip,
  CircularProgress,
  MenuItem,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import PeopleIcon from '@mui/icons-material/People';
import MapIcon from '@mui/icons-material/Map';
import { Autocomplete } from '@mui/material';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { Map as MapType } from '../../types/api.types';
import { getMapDisplayName } from '../../constants/maps';

interface BulkShuffleMatchesModalProps {
  open: boolean;
  onClose: () => void;
  tournamentId: number;
  teamSize: number;
  maps: string[];
  defaultMaxRounds: number;
  onCreated?: () => void;
}

interface RegisteredPlayer {
  id: string;
  name: string;
  avatar?: string;
  avatar_url?: string;
  current_elo: number;
  starting_elo: number;
  match_count: number;
}

interface MatchRow {
  id: number;
  team1PlayerIds: string[];
  team2PlayerIds: string[];
  map?: string;
  maxRounds?: number;
}

export const BulkShuffleMatchesModal: React.FC<BulkShuffleMatchesModalProps> = ({
  open,
  onClose,
  tournamentId,
  teamSize,
  maps,
  defaultMaxRounds,
  onCreated,
}) => {
  const { showError, showSuccess } = useSnackbar();
  const [registeredPlayers, setRegisteredPlayers] = useState<RegisteredPlayer[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [availableMaps, setAvailableMaps] = useState<MapType[]>([]);
  const [selectedMap, setSelectedMap] = useState<string>('');
  const [maxRounds, setMaxRounds] = useState<number>(defaultMaxRounds || 24);
  const [rows, setRows] = useState<MatchRow[]>([
    { id: 1, team1PlayerIds: [], team2PlayerIds: [], map: undefined, maxRounds: undefined },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Reset local state when modal opens/closes
  useEffect(() => {
    if (open) {
      setLocalError(null);
      setSubmitting(false);
      // Initialize default map selection from tournament maps, falling back to first known map.
      const firstMap = maps[0];
      setSelectedMap((current) => current || firstMap || '');
      setMaxRounds(defaultMaxRounds || 24);
      setRows([
        { id: 1, team1PlayerIds: [], team2PlayerIds: [], map: undefined, maxRounds: undefined },
      ]);
    }
  }, [open, maps, defaultMaxRounds]);

  const loadRegisteredPlayers = async () => {
    setLoadingPlayers(true);
    try {
      const response = await api.get<{
        success: boolean;
        players: RegisteredPlayer[];
      }>(`/api/tournament/${tournamentId}/players`);
      if (response.success && Array.isArray(response.players)) {
        setRegisteredPlayers(response.players);
      } else {
        showError('Failed to load registered players');
      }
    } catch (err) {
      console.error('Failed to load registered players for bulk shuffle matches:', err);
      showError('Failed to load registered players');
    } finally {
      setLoadingPlayers(false);
    }
  };

  const loadMaps = async () => {
    try {
      const response = await api.get<{ maps: MapType[] }>('/api/maps');
      if (Array.isArray(response.maps)) {
        setAvailableMaps(response.maps);
      }
    } catch (err) {
      console.error('Failed to load maps for bulk shuffle matches:', err);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadRegisteredPlayers();
    void loadMaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tournamentId]);

  const playerOptions = useMemo(
    () =>
      registeredPlayers.map((p) => ({
        id: p.id,
        name: p.name,
        display: `${p.name} (${p.id})`,
      })),
    [registeredPlayers]
  );

  const getMapLabel = (mapId: string): string => {
    const m = availableMaps.find((mm) => mm.id === mapId);
    return m ? m.displayName : getMapDisplayName(mapId);
  };

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: prev.length === 0 ? 1 : prev[prev.length - 1].id + 1,
        team1PlayerIds: [],
        team2PlayerIds: [],
        map: undefined,
        maxRounds: undefined,
      },
    ]);
  };

  const handleRemoveRow = (rowId: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== rowId)));
  };

  const updateRow = (rowId: number, updater: (row: MatchRow) => MatchRow) => {
    setRows((prev) => prev.map((row) => (row.id === rowId ? updater(row) : row)));
  };

  const validate = (): boolean => {
    setLocalError(null);

    if (rows.length === 0) {
      setLocalError('Add at least one match to create.');
      return false;
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const team1Count = row.team1PlayerIds.length;
      const team2Count = row.team2PlayerIds.length;

      if (team1Count === 0 || team2Count === 0) {
        setLocalError(`Match ${i + 1}: both teams must have at least one player.`);
        return false;
      }

      const overlap = row.team1PlayerIds.filter((id) => row.team2PlayerIds.includes(id));
      if (overlap.length > 0) {
        setLocalError(
          `Match ${i + 1}: the same player cannot be on both teams. Conflicting ID(s): ${overlap.join(
            ', '
          )}`
        );
        return false;
      }

      // Resolve per‑match map: prefer row map, then default.
      const effectiveMap = (row.map && row.map.trim()) || selectedMap || maps[0] || '';
      if (!effectiveMap) {
        setLocalError(
          `Match ${i + 1}: map is required (set a default map above or choose a map for this match).`
        );
        return false;
      }

      // Resolve per‑match maxRounds: validate row override when present, otherwise fall back to global.
      if (row.maxRounds !== undefined) {
        if (row.maxRounds < 1 || row.maxRounds > 30) {
          setLocalError(
            `Match ${i + 1}: max rounds must be between 1 and 30 when overridden per match.`
          );
          return false;
        }
      } else if (maxRounds < 1 || maxRounds > 30) {
        setLocalError('Max rounds must be between 1 and 30.');
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        map: selectedMap || undefined,
        maxRounds,
        matches: rows.map((row, idx) => ({
          team1PlayerIds: row.team1PlayerIds,
          team2PlayerIds: row.team2PlayerIds,
          label: `Manual ${idx + 1}`,
          map: row.map && row.map.trim().length > 0 ? row.map.trim() : undefined,
          maxRounds: row.maxRounds,
        })),
      };

      const response = await api.post<{
        success: boolean;
        error?: string;
        message?: string;
      }>(`/api/tournament/${tournamentId}/manual-matches`, payload);

      if (!response.success) {
        showError(response.error || 'Failed to create manual shuffle matches');
        return;
      }

      showSuccess(
        response.message ||
          'Manual shuffle matches created. They will be allocated when the tournament starts.'
      );

      if (onCreated) {
        onCreated();
      }

      onClose();
    } catch (err) {
      console.error('Failed to create manual shuffle matches:', err);
      const message =
        err instanceof Error ? err.message : 'Failed to create manual shuffle matches';
      showError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={1}>
            <PeopleIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              Bulk Create Shuffle Matches
            </Typography>
          </Box>
          <IconButton aria-label="close" size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={3}>
          <Typography variant="body2" color="text.secondary">
            Configure a single‑map shuffle match (map + round limit), then define as many head‑to‑head
            matches as you like by choosing exact player lineups for each side. Matches are created as
            part of the current shuffle tournament and will be allocated to servers when you start the
            tournament.
          </Typography>

          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                label="Map"
                fullWidth
                value={selectedMap}
                onChange={(e) => setSelectedMap(e.target.value)}
                helperText={
                  maps.length === 0
                    ? 'No maps configured for this tournament'
                    : 'All matches in this batch will use this map.'
                }
              >
                {maps.map((mapId) => (
                  <MenuItem key={mapId} value={mapId}>
                    {getMapLabel(mapId)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                label="Max rounds per map"
                type="number"
                fullWidth
                value={maxRounds}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setMaxRounds(Number.isNaN(value) ? defaultMaxRounds || 24 : value);
                }}
                inputProps={{ min: 1, max: 30 }}
                helperText={
                  maxRounds > 0
                    ? `Match plays up to ${maxRounds} rounds; winner is first to ${
                        Math.floor(maxRounds / 2) + 1
                      } rounds.`
                    : 'Maximum number of rounds per map (default: 24, max: 30).'
                }
              />
            </Grid>
          </Grid>

          <Box>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
              <Typography variant="subtitle1" fontWeight={600}>
                Matches ({rows.length})
              </Typography>
              <Button
                startIcon={<AddIcon />}
                onClick={handleAddRow}
                size="small"
                variant="outlined"
              >
                Add Match
              </Button>
            </Box>

            {loadingPlayers ? (
              <Box display="flex" justifyContent="center" py={3}>
                <CircularProgress size={24} />
              </Box>
            ) : registeredPlayers.length === 0 ? (
              <Box>
                <Typography variant="body2" color="text.secondary">
                  No players are registered for this shuffle tournament yet. Register players first,
                  then you can create manual matches.
                </Typography>
              </Box>
            ) : (
              <Stack spacing={2}>
                {rows.map((row, index) => {
                  const team1Selected = playerOptions.filter((p) =>
                    row.team1PlayerIds.includes(p.id)
                  );
                  const team2Selected = playerOptions.filter((p) =>
                    row.team2PlayerIds.includes(p.id)
                  );

                  const team1Count = row.team1PlayerIds.length;
                  const team2Count = row.team2PlayerIds.length;

                  return (
                    <Box
                      key={row.id}
                      sx={{
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        p: 2,
                      }}
                    >
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        mb={1.5}
                      >
                        <Typography variant="subtitle2" fontWeight={600}>
                          Match {index + 1}
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            size="small"
                            label={`${team1Count}/${teamSize} • ${team2Count}/${teamSize}`}
                            color={
                              team1Count === teamSize && team2Count === teamSize
                                ? 'success'
                                : 'default'
                            }
                          />
                          {rows.length > 1 && (
                            <IconButton
                              size="small"
                              aria-label="Remove match"
                              onClick={() => handleRemoveRow(row.id)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          )}
                        </Stack>
                      </Box>

                      <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                          <Autocomplete
                            multiple
                            options={playerOptions}
                            value={team1Selected}
                            onChange={(_event, newValue) => {
                              const ids = newValue.map((p) => p.id);
                              // Ensure players removed from team1 remain untouched in team2 (backend will catch conflicts)
                              updateRow(row.id, (r) => ({
                                ...r,
                                team1PlayerIds: ids,
                              }));
                            }}
                            getOptionLabel={(option) => option.display}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                label={`Team 1 players (${team1Count}/${teamSize})`}
                                placeholder="Search & select players"
                              />
                            )}
                          />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <Autocomplete
                            multiple
                            options={playerOptions}
                            value={team2Selected}
                            onChange={(_event, newValue) => {
                              const ids = newValue.map((p) => p.id);
                              updateRow(row.id, (r) => ({
                                ...r,
                                team2PlayerIds: ids,
                              }));
                            }}
                            getOptionLabel={(option) => option.display}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                label={`Team 2 players (${team2Count}/${teamSize})`}
                                placeholder="Search & select players"
                              />
                            )}
                          />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            select
                            label="Map (optional override)"
                            fullWidth
                            value={row.map || ''}
                            onChange={(e) =>
                              updateRow(row.id, (r) => ({
                                ...r,
                                map: e.target.value || undefined,
                              }))
                            }
                            helperText={
                              row.map
                                ? 'This match uses its own map.'
                                : 'Leave empty to use the default map above.'
                            }
                          >
                            {maps.map((mapId) => (
                              <MenuItem key={mapId} value={mapId}>
                                {getMapLabel(mapId)}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            label="Max rounds (optional override)"
                            type="number"
                            fullWidth
                            value={row.maxRounds ?? ''}
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              updateRow(row.id, (r) => ({
                                ...r,
                                maxRounds: Number.isNaN(value) ? undefined : value,
                              }));
                            }}
                            inputProps={{ min: 1, max: 30 }}
                            helperText={
                              row.maxRounds
                                ? `Overrides default max rounds for this match (currently ${row.maxRounds}).`
                                : 'Leave empty to use the default max rounds above.'
                            }
                          />
                        </Grid>
                      </Grid>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Box>

          {localError && (
            <Typography variant="body2" color="error">
              {localError}
            </Typography>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || loadingPlayers || registeredPlayers.length === 0}
          startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <MapIcon />}
        >
          {submitting ? 'Creating…' : 'Create Matches'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};


