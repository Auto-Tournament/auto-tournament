import React, { useState, useEffect, useRef } from 'react';
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
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const isEditing = !!map;

  useEffect(() => {
    if (map) {
      setId(map.id);
      setDisplayName(map.displayName);
      setImageUrl(map.imageUrl || '');
      setPreviewUrl(map.imageUrl || '');
    } else {
      resetForm();
    }
  }, [map, open]);

  const resetForm = () => {
    setId('');
    setDisplayName('');
    setImageUrl('');
    setPreviewUrl('');
    setSelectedFile(null);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      return;
    }

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setError('Invalid file type. Please select a PNG, JPG, GIF, or WebP image.');
      setSelectedFile(null);
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size too large. Please select an image smaller than 5MB.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setError('');

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setPreviewUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const uploadImageFile = async (mapId: string, file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64Data = e.target?.result as string;

          // Upload image
          const response = await api.post<{ success: boolean; imageUrl: string }>(
            `/api/maps/${mapId}/upload-image`,
            {
              imageData: base64Data,
            }
          );

          if (response.success && response.imageUrl) {
            resolve(response.imageUrl);
          } else {
            reject(new Error('Failed to upload image'));
          }
        } catch (err) {
          const error = err as { error?: string; message?: string };
          reject(new Error(error.error || error.message || 'Failed to upload image'));
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read image file'));
      };

      reader.readAsDataURL(file);
    });
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
      const imageUrl = `https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails/${id}.png`;

      // Test if image exists
      const response = await fetch(imageUrl, { method: 'HEAD' });
      if (response.ok) {
        setImageUrl(imageUrl);
        setPreviewUrl(imageUrl);
      } else {
        setError(`Image not found for ${id}. You can upload an image instead.`);
      }
    } catch (err) {
      setError('Failed to fetch image. You can upload an image instead.');
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = () => {
    setImageUrl('');
    setPreviewUrl('');
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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
      let finalImageUrl = imageUrl.trim() || null;

      // If there's a selected file, upload it first
      if (selectedFile) {
        try {
          const uploadedUrl = await uploadImageFile(id.trim(), selectedFile);
          finalImageUrl = uploadedUrl;
          setImageUrl(uploadedUrl);
          setPreviewUrl(uploadedUrl);
          setSelectedFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        } catch (err) {
          const error = err as Error;
          setError(error.message || 'Failed to upload image');
          setSaving(false);
          return;
        }
      }

      const payload = {
        id: id.trim(),
        displayName: displayName.trim(),
        imageUrl: finalImageUrl,
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
      <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Map Image
            </Typography>
            <Box display="flex" flexDirection="column" gap={1}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                id="map-image-upload"
              />
              <label htmlFor="map-image-upload">
                <Button
                  variant="outlined"
                  component="span"
                  startIcon={<CloudUploadIcon />}
                  fullWidth
                  disabled={saving || !id}
                >
                  Upload Image
                </Button>
              </label>
              {!isEditing && id && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleDownloadImage}
                  disabled={uploading || saving}
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
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Upload a PNG, JPG, GIF, or WebP image (max 5MB)
            </Typography>
          </Box>

          {previewUrl && (
            <Box>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="caption" color="text.secondary">
                  Preview:
                </Typography>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<DeleteIcon />}
                  onClick={handleRemoveImage}
                  disabled={saving}
                >
                  Remove Image
                </Button>
              </Box>
              <Box
                component="img"
                src={previewUrl}
                alt={displayName || id}
                sx={{
                  width: '100%',
                  maxHeight: 200,
                  objectFit: 'contain',
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
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        {isEditing && (
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving}
          sx={{ ml: isEditing ? 0 : 'auto' }}
        >
          {saving ? <CircularProgress size={24} /> : isEditing ? 'Update' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
