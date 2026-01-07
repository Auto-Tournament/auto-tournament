import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Alert,
  CircularProgress,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { api } from '../../utils/api';
import type { MapPoolResponse } from '../../types/api.types';
import { useTranslation } from 'react-i18next';

interface SaveMapPoolModalProps {
  open: boolean;
  mapIds: string[];
  onClose: () => void;
  onSave: () => void;
}

export default function SaveMapPoolModal({ open, mapIds, onClose, onSave }: SaveMapPoolModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();

  React.useEffect(() => {
    if (open) {
      setName('');
      setError('');
    }
  }, [open]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('saveMapPoolModal.errors.nameRequired'));
      return;
    }

    if (mapIds.length === 0) {
      setError(t('saveMapPoolModal.errors.noMaps'));
      return;
    }

    setSaving(true);
    setError('');

    try {
      await api.post<MapPoolResponse>('/api/map-pools', {
        name: name.trim(),
        mapIds,
      });

      onSave();
      onClose();
    } catch (err: unknown) {
      const error = err as { error?: string; message?: string };
      setError(
        error.error || error.message || t('saveMapPoolModal.errors.saveFailed')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
        onClose();
      }}
      maxWidth="sm"
      fullWidth
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
          {t('saveMapPoolModal.title')}
        </Typography>
        <IconButton
          onClick={onClose}
          size="small"
          aria-label="close"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label={t('saveMapPoolModal.nameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('saveMapPoolModal.namePlaceholder')}
            required
            fullWidth
            autoFocus
          />

          <Alert severity="info">
            {t('saveMapPoolModal.info', {
              count: mapIds.length,
            })}
          </Alert>

          {error && (
            <Alert severity="error" onClose={() => setError('')}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <Button onClick={handleSave} variant="contained" disabled={saving} sx={{ ml: 'auto' }}>
          {saving ? <CircularProgress size={24} /> : t('saveMapPoolModal.saveButton')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
