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
  Autocomplete,
  Chip,
} from '@mui/material';
import { api } from '../../utils/api';
import type { MapPool, MapPoolResponse, MapsResponse, Map } from '../../types/api.types';

interface MapPoolModalProps {
  open: boolean;
  mapPool: MapPool | null;
  onClose: () => void;
  onSave: () => void;
}

export default function MapPoolModal({ open, mapPool, onClose, onSave }: MapPoolModalProps) {
  const [name, setName] = useState('');
  const [selectedMapIds, setSelectedMapIds] = useState<string[]>([]);
  const [availableMaps, setAvailableMaps] = useState<Map[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingMaps, setLoadingMaps] = useState(true);

  const isEditing = !!mapPool;

  useEffect(() => {
    if (open) {
      loadMaps();
      if (mapPool) {
        setName(mapPool.name);
        setSelectedMapIds(mapPool.mapIds);
      } else {
        resetForm();
      }
    }
  }, [mapPool, open]);

  const loadMaps = async () => {
    try {
      setLoadingMaps(true);
      const data = await api.get<MapsResponse>('/api/maps');
      setAvailableMaps(data.maps || []);
    } catch (err) {
      setError('Failed to load maps');
      console.error(err);
    } finally {
      setLoadingMaps(false);
    }
  };

  const resetForm = () => {
    setName('');
    setSelectedMapIds([]);
    setError('');
  };

  const getMapDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : mapId;
  };

  const getMapType = (mapId: string): string => {
    if (mapId.startsWith('de_')) return 'Defusal';
    if (mapId.startsWith('cs_')) return 'Hostage';
    if (mapId.startsWith('ar_')) return 'Arms Race';
    return 'Unknown';
  };

  const getMapTypeColor = (mapId: string): 'default' | 'primary' | 'secondary' | 'success' => {
    if (mapId.startsWith('de_')) return 'primary';
    if (mapId.startsWith('cs_')) return 'secondary';
    if (mapId.startsWith('ar_')) return 'success';
    return 'default';
  };

  // Sort maps by prefix: de_, ar_, cs_
  const sortedMaps = [...availableMaps].sort((a, b) => {
    const prefixOrder: Record<string, number> = { de_: 0, ar_: 1, cs_: 2 };
    const aPrefix = a.id.substring(0, 3);
    const bPrefix = b.id.substring(0, 3);
    const aOrder = prefixOrder[aPrefix] ?? 999;
    const bOrder = prefixOrder[bPrefix] ?? 999;
    
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    // If same prefix, sort alphabetically by ID
    return a.id.localeCompare(b.id);
  });

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Map pool name is required');
      return;
    }

    if (selectedMapIds.length === 0) {
      setError('Please select at least one map');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        name: name.trim(),
        mapIds: selectedMapIds,
      };

      if (isEditing) {
        await api.put<MapPoolResponse>(`/api/map-pools/${mapPool.id}`, payload);
      } else {
        await api.post<MapPoolResponse>('/api/map-pools', payload);
      }

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
      <DialogTitle>{isEditing ? 'Edit Map Pool' : 'Create Map Pool'}</DialogTitle>
      <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Map Pool Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., My Custom Pool"
            required
            fullWidth
            autoFocus
          />

          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="body2" color="text.secondary">
                Select Maps ({selectedMapIds.length} selected)
              </Typography>
              {!loadingMaps && sortedMaps.length > 0 && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setSelectedMapIds(sortedMaps.map((m) => m.id))}
                  disabled={selectedMapIds.length === sortedMaps.length}
                >
                  Add all
                </Button>
              )}
            </Box>
            {loadingMaps ? (
              <Box display="flex" justifyContent="center" p={2}>
                <CircularProgress size={24} />
              </Box>
            ) : (
              <Autocomplete
                multiple
                options={sortedMaps.map((m) => m.id)}
                value={selectedMapIds}
                onChange={(_, newValue) => setSelectedMapIds(newValue)}
                disableCloseOnSelect
                getOptionLabel={(option) => getMapDisplayName(option)}
                renderInput={(params) => <TextField {...params} placeholder="Choose maps..." />}
                renderOption={(props, option) => (
                  <Box component="li" {...props} key={option}>
                    <Box display="flex" alignItems="center" gap={1} width="100%">
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        {getMapDisplayName(option)}
                      </Typography>
                      <Chip
                        label={getMapType(option)}
                        size="small"
                        color={getMapTypeColor(option)}
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    </Box>
                  </Box>
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      label={getMapDisplayName(option)}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            )}
          </Box>

          {error && (
            <Alert severity="error" onClose={() => setError('')}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        {isEditing && (
          <Button onClick={onClose} disabled={saving || loadingMaps}>
            Cancel
          </Button>
        )}
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving || loadingMaps}
          sx={{ ml: isEditing ? 0 : 'auto' }}
        >
          {saving ? <CircularProgress size={24} /> : isEditing ? 'Update' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
