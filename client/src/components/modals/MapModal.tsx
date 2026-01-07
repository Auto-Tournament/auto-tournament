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
  IconButton,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { Map, MapResponse } from '../../types/api.types';
import { FadeInImage } from '../common/FadeInImage';
import { useTranslation } from 'react-i18next';

interface MapModalProps {
  open: boolean;
  map: Map | null;
  onClose: () => void;
  onSave: () => void;
}

export default function MapModal({ open, map, onClose, onSave }: MapModalProps) {
  const { showSuccess, showError } = useSnackbar();
  const { t } = useTranslation();
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

  const getDefaultWebpUrlForId = (mapId: string): string =>
    `https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails/${mapId}.webp`;

  useEffect(() => {
    if (map) {
      setId(map.id);
      setDisplayName(map.displayName);
      // For repo-backed maps, always prefer the WebP URL derived from the map ID.
      // For custom uploads (non-repo URLs), keep the stored imageUrl.
      const normalizedImageUrl =
        map.imageUrl && !map.imageUrl.includes('cs2-server-manager')
          ? map.imageUrl
          : getDefaultWebpUrlForId(map.id);
      setImageUrl(normalizedImageUrl || '');
      setPreviewUrl(normalizedImageUrl || '');
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
      setError(t('mapModal.errors.invalidFileType'));
      setSelectedFile(null);
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError(t('mapModal.errors.fileTooLarge'));
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
        reject(new Error(t('mapModal.errors.readFileFailed')));
      };

      reader.readAsDataURL(file);
    });
  };

  const handleDownloadImage = async () => {
    if (!id) {
      setError(t('mapModal.errors.fetchImageIdRequired'));
      return;
    }

    setUploading(true);
    setError('');

    try {
      // Download full-size webp image from GitHub repo
      const imageUrl = `https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails/${id}.webp`;

      // Test if image exists
      const response = await fetch(imageUrl, { method: 'HEAD' });
      if (response.ok) {
        setImageUrl(imageUrl);
        setPreviewUrl(imageUrl);
      } else {
        setError(t('mapModal.errors.imageNotFound', { id }));
      }
    } catch (err) {
      setError(t('mapModal.errors.fetchImageFailed'));
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
      setError(t('mapModal.errors.mapIdRequired'));
      return;
    }

    if (!displayName.trim()) {
      setError(t('mapModal.errors.displayNameRequired'));
      return;
    }

    // Validate ID format
    if (!/^[a-z0-9_]+$/.test(id.trim())) {
      setError(t('mapModal.errors.mapIdInvalid'));
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
          setError(error.message || t('mapModal.errors.uploadFailed'));
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
        showSuccess(t('mapModal.success.mapUpdated'));
      } else {
        await api.post<MapResponse>('/api/maps', payload);
        showSuccess(t('mapModal.success.mapCreated'));
      }

      onSave();
      onClose();
    } catch (err: unknown) {
      const error = err as { error?: string; message?: string };
      const errorMessage = error.error || error.message || t('mapModal.errors.saveFailed');
      setError(errorMessage);
      showError(errorMessage);
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
      data-testid="map-modal"
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
          {isEditing ? t('mapModal.titleEdit') : t('mapModal.titleCreate')}
        </Typography>
        <IconButton onClick={onClose} size="small" aria-label="close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label={t('mapModal.mapIdLabel')}
            value={id}
            onChange={(e) => {
              const value = e.target.value.toLowerCase().trim();
              setId(value);
            }}
            placeholder={t('mapModal.mapIdPlaceholder')}
            disabled={isEditing}
            required
            slotProps={{
              htmlInput: { 'data-testid': 'map-id-input' },
            }}
            helperText={t('mapModal.mapIdHelper')}
            fullWidth
          />

          <TextField
            label={t('mapModal.displayNameLabel')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('mapModal.displayNamePlaceholder')}
            required
            fullWidth
            slotProps={{
              htmlInput: { 'data-testid': 'map-display-name-input' },
            }}
          />

          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('mapModal.mapImageLabel')}
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
                  {t('mapModal.uploadButton')}
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
                      {t('mapModal.fetchFromGitHub')}
                    </>
                  ) : (
                    t('mapModal.fetchFromGitHub')
                  )}
                </Button>
              )}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {t('mapModal.uploadHelper')}
            </Typography>
          </Box>

          {previewUrl && (
            <Box>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="caption" color="text.secondary">
                  {t('mapModal.previewLabel')}
                </Typography>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<DeleteIcon />}
                  onClick={handleRemoveImage}
                  disabled={saving}
                >
                  {t('mapModal.removeImage')}
                </Button>
              </Box>
              <FadeInImage
                src={previewUrl}
                alt={displayName || id}
                height={256}
                sx={{ width: '100%', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
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
            {t('mapModal.buttons.cancel')}
          </Button>
        )}
        <Button
          data-testid={isEditing ? 'map-update-button' : 'map-create-button'}
          onClick={handleSave}
          variant="contained"
          disabled={saving}
          sx={{ ml: isEditing ? 0 : 'auto' }}
        >
          {saving ? (
            <CircularProgress size={24} />
          ) : isEditing ? (
            t('mapModal.buttons.update')
          ) : (
            t('mapModal.buttons.create')
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
