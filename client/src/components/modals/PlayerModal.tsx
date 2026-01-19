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
  Typography,
  FormControlLabel,
  Switch,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import ConfirmDialog from './ConfirmDialog';
import { PlayerAvatar } from '../player/PlayerAvatar';
import type { PlayerDetail } from '../../types/api.types';
import { useTranslation } from 'react-i18next';

interface PlayerModalProps {
  open: boolean;
  player: PlayerDetail | null;
  onClose: () => void;
  onSave: () => void;
  onDelete: (playerId: string) => void;
}

export default function PlayerModal({ open, player, onClose, onSave, onDelete }: PlayerModalProps) {
  const { t } = useTranslation();
  const { showSuccess, showError, showWarning } = useSnackbar();
  const [steamId, setSteamId] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [elo, setElo] = useState<number | ''>('');
  const [isAdmin, setIsAdmin] = useState(false);

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
      setIsAdmin(Boolean(player.isAdmin));
    } else {
      resetForm();
    }
  }, [player, open]);

  const resetForm = () => {
    setSteamId('');
    setName('');
    setAvatar('');
    setElo('');
    setIsAdmin(false);
    setError('');
  };

  const handleResolveSteam = async () => {
    if (!steamId.trim()) {
      setError(t('playerModal.errors.steamLookupEmpty'));
      return;
    }

    setResolving(true);
    setError('');

    try {
      const response: {
        success: boolean;
        player?: { steamId: string; name: string; avatar?: string };
      } = await api.post('/api/steam/resolve', {
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
        setError(t('playerModal.errors.steamApiNotConfigured'));
      } else {
        setError(t('playerModal.errors.steamResolveFailed'));
      }
    } finally {
      setResolving(false);
    }
  };

  const handleSave = async () => {
    if (!steamId.trim()) {
      showWarning(t('playerModal.errors.steamRequired'));
      return;
    }

    if (!name.trim()) {
      showWarning(t('playerModal.errors.nameRequired'));
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

  const performSave = async () => {
    setSaving(true);
    setError('');

    try {
      const payload = {
        id: steamId.trim(),
        name: name.trim(),
        avatar: avatar.trim() || undefined,
        elo: elo !== '' ? Number(elo) : undefined,
        isAdmin,
      };

      if (isEditing) {
        await api.put(`/api/players/${player.id}`, payload);
        showSuccess(t('playerModal.success.playerUpdated'));
      } else {
        await api.post('/api/players', payload);
        showSuccess(t('playerModal.success.playerCreated'));
      }

      onSave();
      onClose();
      resetForm();
      setConfirmEloUpdateOpen(false);
      setPendingElo('');
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || t('playerModal.errors.saveFailed');
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
      <Dialog
        open={open}
        onClose={handleDialogClose}
        maxWidth="sm"
        fullWidth
        data-testid="player-modal"
        disableEscapeKeyDown
      >
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">
              {isEditing ? t('playerModal.titleEdit') : t('playerModal.titleCreate')}
            </Typography>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              label={t('playerModal.steamLabel')}
              value={steamId}
              onChange={(e) => setSteamId(e.target.value)}
              disabled={isEditing || resolving}
              fullWidth
              required
              error={!!error}
              slotProps={{
                htmlInput: { 'data-testid': 'player-steam-id-input' },
              }}
              helperText={
                error ||
                (isEditing
                  ? t('playerModal.steamHelperEditing')
                  : t('playerModal.steamHelperNew'))
              }
            />

            {!isEditing && (
              <Button
                variant="outlined"
                onClick={handleResolveSteam}
                disabled={resolving || !steamId.trim()}
                startIcon={resolving ? <CircularProgress size={16} /> : undefined}
              >
                {resolving ? t('playerModal.resolving') : t('playerModal.resolveSteam')}
              </Button>
            )}

            {avatar && (
              <Box display="flex" alignItems="center" gap={2}>
                <PlayerAvatar
                  id={steamId || player?.id || 'unknown'}
                  name={name || player?.name || t('playerModal.playerNamePlaceholder')}
                  avatarUrl={avatar}
                  size={48}
                />
              </Box>
            )}

            <TextField
              label={t('playerModal.playerNameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
              disabled={resolving}
              slotProps={{
                htmlInput: { 'data-testid': 'player-name-input' },
              }}
            />

            <TextField
              label={isEditing ? t('playerModal.eloLabelEdit') : t('playerModal.eloLabelNew')}
              type="number"
              value={elo}
              onChange={(e) => setElo(e.target.value === '' ? '' : Number(e.target.value))}
              fullWidth
              slotProps={{
                htmlInput: { 'data-testid': 'player-elo-input' },
              }}
              helperText={
                isEditing
                  ? t('playerModal.eloHelperEdit')
                  : t('playerModal.eloHelperNew')
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                  color="primary"
                />
              }
              label={t('playerModal.isAdminLabel')}
            />

            {isEditing && (
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {t('playerModal.currentElo', { value: player.currentElo })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('playerModal.startingElo', { value: player.startingElo })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('playerModal.matchesPlayed', { count: player.matchCount })}
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
              {t('playerModal.buttons.delete')}
            </Button>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Button onClick={onClose} disabled={saving}>
            {t('playerModal.buttons.cancel')}
          </Button>
          <Button
            data-testid="player-save-button"
            variant="contained"
            onClick={handleSave}
            disabled={saving || resolving}
            startIcon={saving ? <CircularProgress size={20} color="inherit" /> : undefined}
            sx={{
              ...((!steamId.trim() || !name.trim()) &&
                !saving &&
                !resolving && {
                  bgcolor: 'action.disabledBackground',
                  color: 'action.disabled',
                  '&:hover': {
                    bgcolor: 'action.disabledBackground',
                  },
                }),
            }}
          >
            {saving
              ? t('playerModal.buttons.saving')
              : isEditing
              ? t('playerModal.buttons.save')
              : t('playerModal.buttons.create')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t('playerModal.confirmDelete.title')}
        message={t('playerModal.confirmDelete.message', { name: player?.name })}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <ConfirmDialog
        open={confirmEloUpdateOpen}
        title={t('playerModal.confirmEloUpdate.title')}
        message={t('playerModal.confirmEloUpdate.message', {
          from: originalElo,
          to: pendingElo,
        })}
        onConfirm={handleEloUpdateConfirm}
        onCancel={handleEloUpdateCancel}
      />
    </>
  );
}
