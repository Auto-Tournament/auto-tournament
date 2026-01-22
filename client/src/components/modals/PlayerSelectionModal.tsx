import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Grid,
  Card,
  CardContent,
  Checkbox,
  Typography,
  TextField,
  InputAdornment,
  CircularProgress,
  Chip,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { PlayerDetail } from '../../types/api.types';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { PlayerName } from '../player/PlayerName';
import { useTranslation } from 'react-i18next';

interface PlayerSelectionModalProps {
  open: boolean;
  teamId?: string; // If editing a team, gray out players already in it
  selectedPlayerIds: string[]; // Already selected players (from parent)
  onClose: () => void;
  onSelect: (playerIds: string[]) => void; // Called with selected player IDs
  title?: string; // Optional custom title
  confirmButtonText?: string; // Optional custom confirm button text
  maxSelection?: number; // Optional maximum number of selectable players
}

export default function PlayerSelectionModal({
  open,
  teamId,
  selectedPlayerIds,
  onClose,
  onSelect,
  title,
  confirmButtonText,
  maxSelection,
}: PlayerSelectionModalProps) {
  const [players, setPlayers] = useState<PlayerDetail[]>([]);
  const [filteredPlayers, setFilteredPlayers] = useState<PlayerDetail[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [teamPlayerIds, setTeamPlayerIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { showWarning, showError } = useSnackbar();
  const { t } = useTranslation();

  // Define functions before useEffect hooks that use them
  const loadPlayers = async () => {
    setLoading(true);

    try {
      const response = await api.get<{ success: boolean; players: PlayerDetail[] }>(
        teamId ? `/api/players/selection?teamId=${teamId}` : '/api/players'
      );

      if (response.success && response.players) {
        setPlayers(response.players);
        setFilteredPlayers(response.players);
      } else {
        showError(t('playerSelectionModal.errors.loadFailed'));
      }
    } catch (err) {
      showError(t('playerSelectionModal.errors.loadFailed'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadTeamPlayers = async () => {
    if (!teamId) return;

    try {
      const teamResponse = await api.get<{
        success: boolean;
        team: { players: Array<{ steamId: string }> };
      }>(`/api/teams/${teamId}`);

      if (teamResponse.success && teamResponse.team?.players) {
        const ids = new Set(teamResponse.team.players.map((p) => p.steamId));
        setTeamPlayerIds(ids);
      }
    } catch (err) {
      console.warn('Failed to load team players:', err);
    }
  };

  useEffect(() => {
    if (open) {
      loadPlayers();
      // Initialize selected IDs from props
      setSelectedIds(new Set(selectedPlayerIds));
    } else {
      // Reset on close
      setSearchQuery('');
      setSelectedIds(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedPlayerIds]);

  // Load team players if editing
  useEffect(() => {
    if (open && teamId) {
      loadTeamPlayers();
    } else {
      setTeamPlayerIds(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teamId]);

  // Filter players based on search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredPlayers(players);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = players.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query) ||
          p.id.includes(query)
      );
      setFilteredPlayers(filtered);
    }
  }, [searchQuery, players]);

  const handleTogglePlayer = (playerId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(playerId)) {
      newSelected.delete(playerId);
    } else {
      // Enforce maxSelection when adding new IDs
      if (typeof maxSelection === 'number' && maxSelection > 0 && newSelected.size >= maxSelection) {
        return;
      }
      newSelected.add(playerId);
    }
    setSelectedIds(newSelected);
  };

  const handleConfirm = () => {
    onSelect(Array.from(selectedIds));
    onClose();
  };

  const handleCancel = () => {
    setSelectedIds(new Set(selectedPlayerIds)); // Reset to original selection
    onClose();
  };

  const isPlayerInTeam = (playerId: string) => teamPlayerIds.has(playerId);
  const isPlayerSelected = (playerId: string) => selectedIds.has(playerId);
  const atMaxSelection =
    typeof maxSelection === 'number' && maxSelection > 0 && selectedIds.size >= maxSelection;

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="md"
      fullWidth
      data-testid="player-selection-modal"
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box display="flex" alignItems="center" gap={1}>
            <PersonIcon color="primary" />
            <Typography variant="h6">
              {title || t('playerSelectionModal.title')}
            </Typography>
            {selectedIds.size > 0 && (
              <Chip
                label={t('playerSelectionModal.selectedCount', {
                  count: selectedIds.size,
                })}
                size="small"
                color="primary"
              />
            )}
          </Box>
          <IconButton size="small" onClick={handleCancel}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box mb={2} display="flex" gap={1}>
          <TextField
            fullWidth
            placeholder={t('playerSelectionModal.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="outlined"
            onClick={() => {
              const selectablePlayers = filteredPlayers.filter((p) => !isPlayerInTeam(p.id));
              if (selectablePlayers.length === 0) {
                showWarning(t('playerSelectionModal.errors.noSelectable'));
                return;
              }

              // For constrained selection (e.g. replacing a single player),
              // "Select all" becomes "pick the first available".
              if (typeof maxSelection === 'number' && maxSelection === 1) {
                const first = selectablePlayers[0];
                if (!first) {
                  showWarning(t('playerSelectionModal.errors.noSelectable'));
                  return;
                }
                setSelectedIds(new Set([first.id]));
                return;
              }

              const allSelectableIds = selectablePlayers.map((p) => p.id);
              const allSelected = allSelectableIds.every((id) => selectedIds.has(id));
              const newSelected = new Set(selectedIds);

              if (allSelected) {
                // Deselect all selectable players
                allSelectableIds.forEach((id) => newSelected.delete(id));
              } else {
                // Select all selectable players (unconstrained mode)
                allSelectableIds.forEach((id) => newSelected.add(id));
              }
              setSelectedIds(newSelected);
            }}
            sx={{
              whiteSpace: 'nowrap',
              ...(filteredPlayers.filter((p) => !isPlayerInTeam(p.id)).length === 0 && {
                bgcolor: 'action.disabledBackground',
                color: 'action.disabled',
                '&:hover': {
                  bgcolor: 'action.disabledBackground',
                },
              }),
            }}
          >
            {(() => {
              const selectablePlayers = filteredPlayers.filter((p) => !isPlayerInTeam(p.id));
              const allSelectableIds = selectablePlayers.map((p) => p.id);
              const allSelected =
                allSelectableIds.length > 0 && allSelectableIds.every((id) => selectedIds.has(id));

              if (typeof maxSelection === 'number' && maxSelection === 1) {
                // When maxSelection is 1, this effectively means "pick one"
                return t('playerSelectionModal.selectAll.select');
              }

              return allSelected
                ? t('playerSelectionModal.selectAll.deselect')
                : t('playerSelectionModal.selectAll.select');
            })()}
          </Button>
        </Box>

        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="300px">
            <CircularProgress />
          </Box>
        ) : filteredPlayers.length === 0 ? (
          <Box textAlign="center" py={4}>
            <PersonIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="body1" color="text.secondary">
              {searchQuery
                ? t('playerSelectionModal.empty.noSearchResults')
                : t('playerSelectionModal.empty.noPlayers')}
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              maxHeight: '60vh',
              overflowY: 'auto',
              pr: 1,
            }}
          >
            <Grid container spacing={2}>
              {filteredPlayers.map((player) => {
                const inTeam = isPlayerInTeam(player.id);
                const selected = isPlayerSelected(player.id);
                const disabled = inTeam && !selected; // Can't select if already in team (unless already selected)
                const selectionLockedForOthers = atMaxSelection && !selected;
                const checkboxVisible = !selectionLockedForOthers;

                return (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={player.id}>
                    <Card
                      sx={{
                        cursor: disabled || selectionLockedForOthers ? 'not-allowed' : 'pointer',
                        opacity: disabled || selectionLockedForOthers ? 0.6 : 1,
                        border: selected ? 2 : 1,
                        borderColor: selected ? 'primary.main' : 'divider',
                        bgcolor: selected ? 'action.selected' : 'background.paper',
                        transition: 'all 0.2s',
                        '&:hover': disabled || selectionLockedForOthers
                          ? {}
                          : {
                              borderColor: 'primary.main',
                              boxShadow: 2,
                            },
                      }}
                      onClick={() =>
                        !disabled && !selectionLockedForOthers && handleTogglePlayer(player.id)
                      }
                    >
                      <CardContent>
                        <Box display="flex" alignItems="center" gap={2}>
                          {checkboxVisible && (
                            <Checkbox
                              checked={selected}
                              disabled={disabled}
                              onChange={() =>
                                !disabled && !selectionLockedForOthers && handleTogglePlayer(player.id)
                              }
                              onClick={(e) => e.stopPropagation()}
                              sx={{ p: 0 }}
                            />
                          )}
                          <PlayerAvatar
                            id={player.id}
                            name={player.name}
                            avatarUrl={player.avatar}
                            size={48}
                            isAdmin={player.isAdmin}
                          />
                          <Box flex={1} minWidth={0}>
                            <PlayerName
                              name={player.name}
                              isAdmin={player.isAdmin}
                              variant="body1"
                              noWrap
                              sx={{ mb: 0.5, fontWeight: 600 }}
                            />
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {player.id}
                            </Typography>
                            <Box display="flex" gap={0.5} mt={0.5}>
                              <Chip
                                label={`ELO: ${player.currentElo}`}
                                size="small"
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            </Box>
                          </Box>
                        </Box>
                        {inTeam && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ mt: 1, display: 'block', fontStyle: 'italic' }}
                          >
                            {t('playerSelectionModal.playerCard.alreadyInTeam')}
                          </Typography>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleCancel}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
        >
          {confirmButtonText ||
            t('playerSelectionModal.addPlayersButton', {
              count: selectedIds.size,
            })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
