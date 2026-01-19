import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
  Alert,
  Divider,
  ListItemAvatar,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import CloseIcon from '@mui/icons-material/Close';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import ConfirmDialog from './ConfirmDialog';
import PlayerSelectionModal from './PlayerSelectionModal';
import { PlayerAvatar } from '../player/PlayerAvatar';
import type { Team, Player } from '../../types';
import { useTranslation } from 'react-i18next';

interface TeamModalProps {
  open: boolean;
  team: Team | null;
  onClose: () => void;
  onSave: (newTeamId?: string) => void;
}

// Utility to generate team ID from name
const slugifyTeamName = (name: string): string => {
  const baseSlug = name
    .toLowerCase()
    .trim()
    // Keep all letters and numbers from any language, plus spaces/underscores/hyphens.
    // This avoids stripping non-Latin characters while still normalizing the ID.
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores

  if (baseSlug) {
    return baseSlug;
  }

  // Fallback for names that contain no ASCII characters (e.g. purely non-English names)
  // Ensures we always have a valid, unique-ish ID while preserving the display name.
  const timestamp = Date.now().toString(36);
  return `team_${timestamp}`;
};

// Utility to generate team tag from name (max 4 chars)
const generateTeamTag = (name: string): string => {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) return '';

  if (words.length === 1) {
    // Single word: take first 4 characters
    return words[0].substring(0, 4).toUpperCase();
  }

  // Multiple words: take first letter of each word (up to 4)
  const tag = words
    .slice(0, 4)
    .map((w) => w[0])
    .join('');

  return tag.toUpperCase();
};

export default function TeamModal({ open, team, onClose, onSave }: TeamModalProps) {
  const { t } = useTranslation();
  const { showSuccess, showError, showWarning } = useSnackbar();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [newPlayerSteamId, setNewPlayerSteamId] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerAvatar, setNewPlayerAvatar] = useState<string | undefined>(undefined);
  const [newPlayerElo, setNewPlayerElo] = useState<number | ''>('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [playerSelectionModalOpen, setPlayerSelectionModalOpen] = useState(false);
  const [replacePlayerSteamId, setReplacePlayerSteamId] = useState<string | null>(null);

  const isEditing = !!team;

  useEffect(() => {
    if (team) {
      setId(team.id);
      setName(team.name);
      setTag(team.tag || '');
      setPlayers(team.players || []);
    } else {
      resetForm();
    }
  }, [team, open]);

  const resetForm = () => {
    setId('');
    setName('');
    setTag('');
    setPlayers([]);
    setNewPlayerSteamId('');
    setNewPlayerName('');
    setNewPlayerAvatar(undefined);
    setNewPlayerElo('');
    setError('');
  };

  const handleNameChange = (newName: string) => {
    // Allow full Unicode team names (including non-English characters)
    setName(newName);

    // Auto-generate tag if not editing (when editing, keep existing tag)
    if (!isEditing) {
      setTag(generateTeamTag(newName));
    }
  };

  const handleResolveSteam = async () => {
    if (!newPlayerSteamId.trim()) {
      setError(t('teamModal.errors.steamLookupEmpty'));
      return;
    }

    setResolving(true);
    setError('');

    try {
      const response: {
        success: boolean;
        player?: { steamId: string; name: string; avatar?: string };
      } = await api.post('/api/steam/resolve', {
        input: newPlayerSteamId.trim(),
      });

      if (response.player) {
        setNewPlayerSteamId(response.player.steamId);
        setNewPlayerName(response.player.name);
        setNewPlayerAvatar(response.player.avatar);
        setError('');
      }
    } catch (err) {
      const error = err as Error;
      // If Steam API not available or resolution failed, allow manual entry
      if (error.message?.includes('Steam API is not configured')) {
        setError(t('teamModal.errors.steamApiNotConfigured'));
      } else {
        setError(t('teamModal.errors.steamResolveFailed'));
      }
    } finally {
      setResolving(false);
    }
  };

  const handleAddPlayer = () => {
    if (!newPlayerSteamId.trim() || !newPlayerName.trim()) {
      const errorMsg = t('teamModal.errors.steamAndNameRequired');
      setError(errorMsg);
      showWarning(errorMsg);
      return;
    }

    const trimmedSteamId = newPlayerSteamId.trim();

    // Check for duplicates (case-insensitive comparison)
    if (players.some((p) => p.steamId.toLowerCase() === trimmedSteamId.toLowerCase())) {
      const errorMsg = t('teamModal.errors.steamDuplicate');
      setError(errorMsg);
      showWarning(errorMsg);
      return;
    }

    const playerToAdd: Player = {
      steamId: trimmedSteamId,
      name: newPlayerName.trim(),
      avatar: newPlayerAvatar,
      elo: newPlayerElo !== '' ? Number(newPlayerElo) : undefined,
    };

    setPlayers([...players, playerToAdd]);
    setNewPlayerSteamId('');
    setNewPlayerName('');
    setNewPlayerAvatar(undefined);
    setNewPlayerElo('');
    setError('');
    showSuccess(t('teamModal.success.playerAdded'));
  };

  const handleRemovePlayer = (steamId: string) => {
    setPlayers(players.filter((p) => p.steamId !== steamId));
  };

  const handleSelectPlayers = (selectedPlayerIds: string[]) => {
    // If we're in "replace" mode, only the first selected ID is used to replace
    // the targeted player. Otherwise we append all selected players.
    if (replacePlayerSteamId) {
      const replacementId = selectedPlayerIds[0];
      if (!replacementId) {
        setReplacePlayerSteamId(null);
        return;
      }

      // Prevent replacing with the same player or creating duplicates
      if (replacementId.toLowerCase() === replacePlayerSteamId.toLowerCase()) {
        setReplacePlayerSteamId(null);
        return;
      }
      if (players.some((p) => p.steamId.toLowerCase() === replacementId.toLowerCase())) {
        showWarning(t('teamModal.errors.steamDuplicate'));
        setReplacePlayerSteamId(null);
        return;
      }

      const replaceIndex = players.findIndex(
        (p) => p.steamId.toLowerCase() === replacePlayerSteamId.toLowerCase()
      );
      if (replaceIndex === -1) {
        setReplacePlayerSteamId(null);
        return;
      }

      const loadReplacement = async () => {
        try {
          const response = await api.get<{
            success: boolean;
            player: { id: string; name: string; avatar?: string; currentElo?: number };
          }>(`/api/players/${replacementId}`);

          let replacement: Player = {
            steamId: replacementId,
            name: `Player ${replacementId.substring(0, 8)}`,
            avatar: undefined,
          };

          if (response.success && response.player) {
            replacement = {
              steamId: response.player.id,
              name: response.player.name,
              avatar: response.player.avatar,
              elo: response.player.currentElo,
            };
          }

          const next = [...players];
          next[replaceIndex] = replacement;
          setPlayers(next);
          showSuccess(t('teamModal.success.playerReplaced'));
        } catch {
          const next = [...players];
          next[replaceIndex] = {
            steamId: replacementId,
            name: `Player ${replacementId.substring(0, 8)}`,
            avatar: undefined,
          };
          setPlayers(next);
          showSuccess(t('teamModal.success.playerReplaced'));
        } finally {
          setReplacePlayerSteamId(null);
        }
      };

      void loadReplacement();
      return;
    }

    // Add mode: append any newly selected players that are not already on the team.
    const newPlayers: Player[] = selectedPlayerIds
      .filter((id) => !players.some((p) => p.steamId.toLowerCase() === id.toLowerCase()))
      .map((id) => ({
        steamId: id,
        name: `Player ${id.substring(0, 8)}`, // Placeholder name
        avatar: undefined,
      }));

    if (newPlayers.length > 0) {
      Promise.all(
        newPlayers.map(async (player) => {
          try {
            const response = await api.get<{
              success: boolean;
              player: { id: string; name: string; avatar?: string; currentElo?: number };
            }>(`/api/players/${player.steamId}`);
            if (response.success && response.player) {
              return {
                steamId: response.player.id,
                name: response.player.name,
                avatar: response.player.avatar,
                elo: response.player.currentElo,
              };
            }
          } catch {
            // If player doesn't exist, use placeholder
          }
          return player;
        })
      ).then((resolvedPlayers) => {
        setPlayers([...players, ...resolvedPlayers]);
      });
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('teamModal.errors.teamNameRequired'));
      return;
    }

    if (players.length === 0) {
      setError(t('teamModal.errors.playersRequired'));
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        id: isEditing ? id.trim() : slugifyTeamName(name),
        name: name.trim(),
        tag: tag.trim() || undefined,
        discordRoleId: undefined, // Discord notifications not yet implemented
        players,
      };

      let newTeamId: string | undefined;
      if (isEditing) {
        await api.put(`/api/teams/${team.id}`, {
          name: payload.name,
          tag: payload.tag,
          discordRoleId: undefined, // Discord notifications not yet implemented
          players: payload.players,
        });
        showSuccess(t('teamModal.success.teamUpdated'));
      } else {
        const response = await api.post<{ success: boolean; team: Team }>(
          '/api/teams?upsert=true',
          payload
        );
        if (response.success && response.team) {
          newTeamId = response.team.id;
        }
        showSuccess(t('teamModal.success.teamCreated'));
      }

      onSave(newTeamId);
      onClose();
      resetForm();
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || t('teamModal.errors.saveFailed');
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = () => {
    setConfirmDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!team) return;
    setConfirmDeleteOpen(false);

    setSaving(true);
    try {
      await api.delete(`/api/teams/${team.id}`);
      showSuccess(t('teamModal.success.teamDeleted'));
      onSave();
      resetForm();
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || t('teamModal.errors.deleteFailed');
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDialogClose = (
    _event: React.SyntheticEvent | Event,
    reason: 'backdropClick' | 'escapeKeyDown'
  ) => {
    // Prevent accidental closes via backdrop or ESC; require explicit Cancel/X.
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
      return;
    }
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleDialogClose}
        maxWidth="sm"
        fullWidth
        data-testid="team-modal"
        disableEscapeKeyDown
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography variant="h6" fontWeight={600}>
            {isEditing ? t('teamModal.titleEdit') : t('teamModal.titleCreate')}
          </Typography>
          <IconButton onClick={onClose} size="small" aria-label="close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>
          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label={t('teamModal.teamNameLabel')}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('teamModal.teamNamePlaceholder')}
              required
              fullWidth
              slotProps={{
                htmlInput: { 'data-testid': 'team-name-input' },
              }}
              helperText={t('teamModal.teamNameHelper')}
            />

            <TextField
              label={t('teamModal.teamTagLabel')}
              value={tag}
              onChange={(e) => setTag(e.target.value.toUpperCase())}
              placeholder={t('teamModal.teamTagPlaceholder')}
              helperText={t('teamModal.teamTagHelper')}
              fullWidth
              slotProps={{
                htmlInput: { maxLength: 4, 'data-testid': 'team-tag-input' },
              }}
            />

            <Divider sx={{ my: 1 }} />

            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography data-testid="team-players-count" variant="subtitle1" fontWeight={600}>
                {t('teamModal.playersHeader', { count: players.length })}
              </Typography>
              <Button
                variant="outlined"
                size="small"
                startIcon={<PersonAddIcon />}
                onClick={() => setPlayerSelectionModalOpen(true)}
                data-testid="select-players-button"
              >
                {t('teamModal.selectPlayers')}
              </Button>
            </Box>

            {players.length > 0 ? (
              <List sx={{ bgcolor: 'background.paper' }}>
                {players.map((player) => (
                  <ListItem
                    key={player.steamId}
                    secondaryAction={
                      <Box display="flex" alignItems="center" gap={1}>
                        <IconButton
                          edge="end"
                          size="small"
                          color="primary"
                          onClick={() => {
                            setReplacePlayerSteamId(player.steamId);
                            setPlayerSelectionModalOpen(true);
                          }}
                          data-testid={`team-replace-player-${player.steamId}`}
                          aria-label={t('teamModal.replacePlayerAria', { name: player.name })}
                        >
                          <Tooltip title={t('teamModal.replacePlayerTooltip')}>
                            <SwapHorizIcon fontSize="small" />
                          </Tooltip>
                        </IconButton>
                        <IconButton
                          edge="end"
                          onClick={() => handleRemovePlayer(player.steamId)}
                          color="error"
                          size="small"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    }
                  >
                    <ListItemAvatar>
                      <PlayerAvatar
                        id={player.steamId}
                        name={player.name}
                        avatarUrl={player.avatar}
                        size={40}
                      />
                    </ListItemAvatar>
                    <ListItemText
                      primary={player.name}
                      secondary={
                        <>
                          <Typography
                            component="span"
                            variant="caption"
                            display="block"
                            fontFamily="monospace"
                          >
                            {player.steamId}
                          </Typography>
                          {player.elo !== undefined && (
                            <Typography
                              component="span"
                              variant="caption"
                              color="text.secondary"
                              display="block"
                            >
                              ELO: {player.elo}
                            </Typography>
                          )}
                        </>
                      }
                      primaryTypographyProps={{ fontWeight: 500 }}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Alert data-testid="team-no-players-alert" severity="info">
                {t('teamModal.noPlayersInfo')}
              </Alert>
            )}

            <Divider sx={{ my: 2 }} />

            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('teamModal.addPlayersHelper')}
            </Typography>

            <Box display="flex" flexDirection="column" gap={1}>
              <Box display="flex" gap={1}>
                <TextField
                  label={t('teamModal.steamInputLabel')}
                  value={newPlayerSteamId}
                  onChange={(e) => setNewPlayerSteamId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newPlayerSteamId.trim() && !resolving) {
                      handleResolveSteam();
                    }
                  }}
                  placeholder={t('teamModal.steamInputPlaceholder')}
                  size="small"
                  disabled={resolving}
                  sx={{ flex: 2 }}
                  slotProps={{
                    htmlInput: { 'data-testid': 'team-steam-id-input' },
                  }}
                />
                <Button
                  variant="outlined"
                  onClick={handleResolveSteam}
                  disabled={resolving || !newPlayerSteamId.trim()}
                  size="small"
                >
                  {resolving ? t('teamModal.resolving') : <SearchIcon fontSize="small" />}
                </Button>
              </Box>
              <Box display="flex" gap={1} alignItems="center">
                <TextField
                  label={t('teamModal.playerNameLabel')}
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder={t('teamModal.playerNamePlaceholder')}
                  size="small"
                  disabled={resolving}
                  sx={{ flex: 1 }}
                  slotProps={{
                    htmlInput: { 'data-testid': 'team-player-name-input' },
                  }}
                />
                <TextField
                  label={t('teamModal.eloLabel')}
                  type="number"
                  value={newPlayerElo}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewPlayerElo(value === '' ? '' : Number(value));
                  }}
                  placeholder={t('teamModal.eloPlaceholder')}
                  size="small"
                  disabled={resolving}
                  helperText={t('teamModal.eloHelper')}
                  sx={{ flex: 1, maxWidth: 150 }}
                  slotProps={{
                    htmlInput: { min: 0, max: 10000, 'data-testid': 'team-player-elo-input' },
                  }}
                />
                <IconButton
                  data-testid="team-add-player-button"
                  color="primary"
                  onClick={handleAddPlayer}
                  disabled={resolving}
                  size="small"
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          {isEditing && (
            <Button
              data-testid="team-delete-button"
              onClick={handleDeleteClick}
              color="error"
              disabled={saving}
              sx={{ mr: 'auto' }}
            >
              Delete Team
            </Button>
          )}
          {isEditing && (
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button
            data-testid="team-save-button"
            onClick={handleSave}
            variant="contained"
            disabled={saving}
            startIcon={saving ? <CircularProgress size={20} color="inherit" /> : undefined}
            sx={{ ml: isEditing ? 0 : 'auto' }}
          >
            {saving
              ? t('teamModal.buttons.saving')
              : isEditing
              ? t('teamModal.buttons.saveChanges')
              : t('teamModal.buttons.createTeam')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t('teamModal.confirmDelete.title')}
        message={t('teamModal.confirmDelete.message', { name: team?.name })}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteOpen(false)}
        confirmColor="error"
      />

      <PlayerSelectionModal
        open={playerSelectionModalOpen}
        teamId={team?.id}
        selectedPlayerIds={replacePlayerSteamId ? [] : players.map((p) => p.steamId)}
        maxSelection={replacePlayerSteamId ? 1 : undefined}
        onClose={() => {
          setPlayerSelectionModalOpen(false);
          setReplacePlayerSteamId(null);
        }}
        onSelect={handleSelectPlayers}
      />
    </>
  );
}
