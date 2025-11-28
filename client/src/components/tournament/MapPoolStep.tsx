import React from 'react';
import {
  Box,
  Typography,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Button,
  Autocomplete,
  TextField,
} from '@mui/material';
import { Warning as WarningIcon } from '@mui/icons-material';
import type { MapPool, Map as MapType } from '../../types/api.types';

interface MapPoolStepProps {
  type?: string;
  format: string;
  maps: string[];
  mapPools: MapPool[];
  availableMaps: MapType[];
  selectedMapPool: string;
  loadingMaps: boolean;
  canEdit: boolean;
  saving: boolean;
  onMapPoolChange: (poolId: string) => void;
  onMapsChange: (maps: string[]) => void;
  onSaveMapPool: () => void;
}

export function MapPoolStep({
  type,
  format,
  maps,
  mapPools,
  availableMaps,
  selectedMapPool,
  loadingMaps,
  canEdit,
  saving,
  onMapPoolChange,
  onMapsChange,
  onSaveMapPool,
}: MapPoolStepProps) {
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

  const allMapIds = sortedMaps.map((m) => m.id);
  const isVetoFormat = ['bo1', 'bo3', 'bo5'].includes(format);

  // Check if selected pool has 7 maps
  const selectedPool =
    selectedMapPool !== 'custom' ? mapPools.find((p) => p.id.toString() === selectedMapPool) : null;

  const poolHasCorrectMaps = selectedPool && selectedPool.mapIds.length === 7;
  const shouldShowVetoError = isVetoFormat && maps.length !== 7 && !poolHasCorrectMaps;

  return (
    <Box>
      <Typography variant="overline" color="primary" fontWeight={600}>
        Step 3
      </Typography>
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <Typography variant="subtitle2" fontWeight={600}>
          Map Pool
        </Typography>
        <Chip
          label={`${maps.length} map${maps.length !== 1 ? 's' : ''}`}
          size="small"
          color={maps.length > 0 ? 'success' : 'default'}
          variant="outlined"
        />
      </Box>
      {/* Map Pool Selection Dropdown */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Choose a map pool</InputLabel>
        <Select
          value={selectedMapPool || ''}
          label="Choose a map pool"
          onChange={(e) => onMapPoolChange(e.target.value)}
          disabled={!canEdit || saving || loadingMaps}
          displayEmpty
        >
          {/* Show default pool first (could be Active Duty or a custom default) */}
          {mapPools
            .filter((p) => p.isDefault && p.enabled)
            .map((pool) => (
              <MenuItem key={pool.id} value={pool.id.toString()}>
                {pool.name}
              </MenuItem>
            ))}
          {/* Show all non-default enabled pools */}
          {mapPools
            .filter((p) => !p.isDefault && p.enabled)
            .map((pool) => (
              <MenuItem key={pool.id} value={pool.id.toString()}>
                {pool.name}
              </MenuItem>
            ))}
          <MenuItem value="custom">Custom</MenuItem>
        </Select>
      </FormControl>

      {/* Map Preview */}
      {maps.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Selected Maps ({maps.length}):
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={1}>
            {maps.map((mapId) => (
              <Chip
                key={mapId}
                label={getMapDisplayName(mapId)}
                size="small"
                color="primary"
                variant="outlined"
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Map Pool Validation for Veto Formats */}
      {shouldShowVetoError && (
        <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
          <Typography variant="body2">
            <strong>Map veto requires exactly 7 maps.</strong> You have selected {maps.length}.
          </Typography>
        </Alert>
      )}

      {/* Custom Map Selection (only shown when Custom is selected) */}
      {selectedMapPool === 'custom' && (
        <Box>
          <Autocomplete
            multiple
            options={allMapIds}
            value={maps}
            onChange={(_, newValue) => onMapsChange(newValue)}
            disabled={!canEdit || saving || loadingMaps}
            disableCloseOnSelect
            fullWidth
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
                <Chip label={getMapDisplayName(option)} {...getTagProps({ index })} key={option} />
              ))
            }
          />
          {maps.length > 0 && (
            <Button
              variant="outlined"
              color="primary"
              onClick={onSaveMapPool}
              disabled={!canEdit || saving}
              sx={{ mt: 1 }}
            >
              Save Map Pool
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}
