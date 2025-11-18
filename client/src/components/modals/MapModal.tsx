import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { api } from '../../utils/api';
import type { Map, MapResponse } from '../../types/api.types';

interface MapModalProps {
  open: boolean;
  map: Map | null;
  onClose: () => void;
  onSave: () => void;
}

export default function MapModal({ open, map, onClose, onSave }: MapModalProps) {
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const isEditing = !!map;

  useEffect(() => {
    if (map) {
      setId(map.id);
      setDisplayName(map.displayName);
      setImageUrl(map.imageUrl || '');
    } else {
      resetForm();
    }
  }, [map, open]);

  const resetForm = () => {
    setId('');
    setDisplayName('');
    setImageUrl('');
    setError('');
  };

  const handleDownloadImage = async () => {
    if (!id) {
      setError('Please enter a map ID first');
      return;
    }

    setUploading(true);
    setError('');

    try {
      // Download from GitHub repo
      const imageUrl = `https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/${id}.png`;

      // Test if image exists
      const response = await fetch(imageUrl, { method: 'HEAD' });
      if (response.ok) {
        setImageUrl(imageUrl);
      } else {
        setError(`Image not found for ${id}. You can manually enter an image URL.`);
      }
    } catch (err) {
      setError('Failed to fetch image. You can manually enter an image URL.');
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!id.trim()) {
      setError('Map ID is required');
      return;
    }

    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }

    // Validate ID format
    if (!/^[a-z0-9_]+$/.test(id.trim())) {
      setError('Map ID must contain only lowercase letters, numbers, and underscores');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        id: id.trim(),
        displayName: displayName.trim(),
        imageUrl: imageUrl.trim() || null,
      };

      if (isEditing) {
        await api.put<MapResponse>(`/api/maps/${map.id}`, payload);
      } else {
        await api.post<MapResponse>('/api/maps', payload);
      }

      onSave();
      onClose();
    } catch (err: unknown) {
      const error = err as { error?: string; message?: string };
      setError(error.error || error.message || 'Failed to save map');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditing ? 'Edit Map' : 'Add Map'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Map ID"
            value={id}
            onChange={(e) => {
              const value = e.target.value.toLowerCase().trim();
              setId(value);
            }}
            placeholder="e.g., de_dust2"
            disabled={isEditing}
            required
            helperText="Lowercase letters, numbers, and underscores only (e.g., de_dust2)"
            fullWidth
          />

          <TextField
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g., Dust II"
            required
            fullWidth
          />

          <Box>
            <TextField
              label="Image URL"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              fullWidth
              helperText="Map preview image URL"
            />
            {!isEditing && id && (
              <Button
                variant="outlined"
                size="small"
                onClick={handleDownloadImage}
                disabled={uploading}
                sx={{ mt: 1 }}
              >
                {uploading ? (
                  <>
                    <CircularProgress size={16} sx={{ mr: 1 }} />
                    Fetching...
                  </>
                ) : (
                  'Fetch from GitHub'
                )}
              </Button>
            )}
          </Box>

          {imageUrl && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Preview:
              </Typography>
              <Box
                component="img"
                src={imageUrl}
                alt={displayName || id}
                sx={{
                  width: '100%',
                  maxHeight: 200,
                  objectFit: 'contain',
                  mt: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            </Box>
          )}

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
          {saving ? <CircularProgress size={24} /> : isEditing ? 'Update' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
