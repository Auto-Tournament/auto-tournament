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
} from '@mui/material';
import { api } from '../../utils/api';
import type { MapPoolResponse } from '../../types/api.types';

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

  React.useEffect(() => {
    if (open) {
      setName('');
      setError('');
    }
  }, [open]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Map pool name is required');
      return;
    }

    if (mapIds.length === 0) {
      setError('Please select at least one map');
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
      setError(error.error || error.message || 'Failed to save map pool');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Save Map Pool</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Map Pool Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., My Custom Pool"
            required
            fullWidth
            autoFocus
          />

          <Alert severity="info">
            This will save a map pool with {mapIds.length} map{mapIds.length !== 1 ? 's' : ''}.
          </Alert>

          {error && (
            <Alert severity="error" onClose={() => setError('')}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? <CircularProgress size={24} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
