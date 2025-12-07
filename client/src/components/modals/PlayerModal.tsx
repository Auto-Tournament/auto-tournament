import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  CircularProgress,
  IconButton,
  Avatar,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import ConfirmDialog from './ConfirmDialog';
import type { PlayerDetail } from '../../types/api.types';

interface PlayerModalProps {
  open: boolean;
  player: PlayerDetail | null;
  onClose: () => void;
  onSave: () => void;
  onDelete: (playerId: string) => void;
}

export default function PlayerModal({ open, player, onClose, onSave, onDelete }: PlayerModalProps) {
  const { showSuccess, showError, showWarning } = useSnackbar();
  const [steamId, setSteamId] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [elo, setElo] = useState<number | ''>('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmEloUpdateOpen, setConfirmEloUpdateOpen] = useState(false);
  const [pendingElo, setPendingElo] = useState<number | ''>('');

  const isEditing = !!player;
  const originalElo = player?.currentElo ?? null;

  useEffect(() => {
    if (player) {
      setSteamId(player.id);
      setName(player.name);
      setAvatar(player.avatar || '');
      setElo(player.currentElo);
      setPendingElo('');
    } else {
      resetForm();
    }
  }, [player, open]);

  const resetForm = () => {
    setSteamId('');
    setName('');
    setAvatar('');
    setElo('');
    setError('');
  };

  const handleResolveSteam = async () => {
    if (!steamId.trim()) {
      setError('Please enter a Steam ID, vanity URL, or profile URL');
      return;
    }

    setResolving(true);
    setError('');

    try {
      const response: { success: boolean; player?: { steamId: string; name: string; avatar?: string } } =
        await api.post('/api/steam/resolve', {
          input: steamId.trim(),
        });

      if (response.player) {
        setSteamId(response.player.steamId);
        setName(response.player.name);
        if (response.player.avatar) {
          setAvatar(response.player.avatar);
        }
        setError('');
      }
    } catch (err) {
      const error = err as Error;
      // If Steam API not available or resolution failed, allow manual entry
      if (error.message?.includes('Steam API is not configured')) {
        setError('Steam API not configured - enter Steam ID64 manually');
      } else {
        setError('Could not resolve Steam ID - please enter Steam ID64 manually');
      }
    } finally {
      setResolving(false);
    }
  };

  const handleSave = async () => {
    if (!steamId.trim()) {
      showWarning('Steam ID is required');
      return;
    }

    if (!name.trim()) {
      showWarning('Player name is required');
      return;
    }

    // Check if ELO is being changed for an existing player
    if (isEditing && originalElo !== null && elo !== '' && Number(elo) !== originalElo) {
      setPendingElo(elo);
      setConfirmEloUpdateOpen(true);
      return;
    }

    await performSave();
  };

  const performSave = async () => {
    setSaving(true);
    setError('');

    try {
      const payload = {
        id: steamId.trim(),
        name: name.trim(),
        avatar: avatar.trim() || undefined,
        elo: elo !== '' ? Number(elo) : undefined,
      };

      if (isEditing) {
        await api.put(`/api/players/${player.id}`, payload);
        showSuccess('Player updated successfully');
      } else {
        await api.post('/api/players', payload);
        showSuccess('Player created successfully');
      }

      onSave();
      onClose();
      resetForm();
      setConfirmEloUpdateOpen(false);
      setPendingElo('');
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || 'Failed to save player';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleEloUpdateConfirm = async () => {
    setConfirmEloUpdateOpen(false);
    await performSave();
  };

  const handleEloUpdateCancel = () => {
    setConfirmEloUpdateOpen(false);
    setPendingElo('');
    // Reset ELO to original value
    if (player) {
      setElo(player.currentElo);
    }
  };

  const handleDeleteClick = () => {
    setConfirmDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!player) return;
    setConfirmDeleteOpen(false);
    onDelete(player.id);
    onClose();
    resetForm();
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="player-modal">
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">{isEditing ? 'Edit Player' : 'Create Player'}</Typography>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>

          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              label="Steam ID or Profile URL"
              value={steamId}
              onChange={(e) => setSteamId(e.target.value)}
              disabled={isEditing || resolving}
              fullWidth
              required
              inputProps={{ 'data-testid': 'player-steam-id-input' }}
              helperText={
                isEditing
                  ? 'Steam ID cannot be changed'
                  : 'Enter Steam ID64, vanity URL, or profile URL. Click "Resolve" to auto-fill name and avatar.'
              }
            />

            {!isEditing && (
              <Button
                variant="outlined"
                onClick={handleResolveSteam}
                disabled={resolving || !steamId.trim()}
                startIcon={resolving ? <CircularProgress size={16} /> : undefined}
              >
                {resolving ? 'Resolving...' : 'Resolve Steam ID'}
              </Button>
            )}

            {avatar && (
              <Box display="flex" alignItems="center" gap={2}>
                <Avatar src={avatar} alt={name} sx={{ width: 48, height: 48 }} />
              </Box>
            )}

            <TextField
              label="Player Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
              disabled={resolving}
              inputProps={{ 'data-testid': 'player-name-input' }}
            />

            <TextField
              label={isEditing ? 'ELO' : 'Initial ELO'}
              type="number"
              value={elo}
              onChange={(e) => setElo(e.target.value === '' ? '' : Number(e.target.value))}
              fullWidth
              inputProps={{ 'data-testid': 'player-elo-input' }}
              helperText={
                isEditing
                  ? 'Changing ELO will reset the player\'s rating and stats. This action cannot be undone.'
                  : 'Leave empty to use default (3000).'
              }
            />

            {isEditing && (
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Current ELO: {player.currentElo}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Starting ELO: {player.startingElo}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Matches Played: {player.matchCount}
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          {isEditing && (
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteClick}
              disabled={saving}
            >
              Delete
            </Button>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            data-testid="player-save-button"
            variant="contained"
            onClick={handleSave}
            disabled={saving || resolving}
            sx={{
              ...((!steamId.trim() || !name.trim()) && !saving && !resolving && {
                bgcolor: 'action.disabledBackground',
                color: 'action.disabled',
                '&:hover': {
                  bgcolor: 'action.disabledBackground',
                },
              }),
            }}
          >
            {saving ? 'Saving...' : isEditing ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Player"
        message={`Are you sure you want to delete player "${player?.name}"? This action cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <ConfirmDialog
        open={confirmEloUpdateOpen}
        title="Update Player ELO"
        message={`Are you sure you want to update this player's ELO from ${originalElo} to ${pendingElo}? This will reset their stats and rating history. This action cannot be undone.`}
        onConfirm={handleEloUpdateConfirm}
        onCancel={handleEloUpdateCancel}
      />
    </>
  );
}

