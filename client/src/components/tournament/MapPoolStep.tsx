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

  const allMapIds = availableMaps.map((m) => m.id);
  const isVetoFormat = ['bo1', 'bo3', 'bo5'].includes(format);

  // Check if selected pool has 7 maps
  const selectedPool =
    selectedMapPool === 'active-duty'
      ? mapPools.find((p) => p.isDefault)
      : selectedMapPool !== 'custom'
      ? mapPools.find((p) => p.id.toString() === selectedMapPool)
      : null;

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
      <Typography variant="body2" color="text.secondary" mb={2}>
        {isVetoFormat
          ? 'Select exactly 7 maps for veto system (BO1/BO3/BO5 requires all 7 competitive maps)'
          : 'Maps for the tournament (used for rotation in Round Robin/Swiss)'}
      </Typography>

      {/* Map Pool Selection Dropdown */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Choose a map pool</InputLabel>
        <Select
          value={selectedMapPool}
          label="Choose a map pool"
          onChange={(e) => onMapPoolChange(e.target.value)}
          disabled={!canEdit || saving || loadingMaps}
        >
          <MenuItem value="active-duty">Active Duty</MenuItem>
          {mapPools
            .filter((p) => !p.isDefault)
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
          <Box display="flex" gap={1} alignItems="flex-start" mb={1}>
            <Autocomplete
              multiple
              options={allMapIds}
              value={maps}
              onChange={(_, newValue) => onMapsChange(newValue)}
              disabled={!canEdit || saving || loadingMaps}
              sx={{ flex: 1 }}
              getOptionLabel={(option) => getMapDisplayName(option)}
              renderInput={(params) => <TextField {...params} placeholder="Choose maps..." />}
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
            <Button
              variant="outlined"
              onClick={() => onMapsChange([...allMapIds])}
              disabled={!canEdit || saving || allMapIds.length === 0 || loadingMaps}
              sx={{ mt: 1 }}
            >
              Add All ({allMapIds.length})
            </Button>
          </Box>
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
