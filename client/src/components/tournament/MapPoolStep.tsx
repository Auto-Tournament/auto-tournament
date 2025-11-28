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
      {/* Rules and Guidelines based on Tournament Type and Format */}
      {type && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} gutterBottom>
            Requirements for {type.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())} -{' '}
            {format.toUpperCase()}:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {isVetoFormat && (
              <li>
                <Typography variant="body2">
                  <strong>Map Selection:</strong> You must select exactly <strong>7 maps</strong>{' '}
                  for the veto system. Teams will ban/pick maps from this pool during the match
                  setup.
                </Typography>
              </li>
            )}
            {!isVetoFormat && (
              <li>
                <Typography variant="body2">
                  <strong>Map Selection:</strong> Select at least <strong>1 map</strong>. Maps will
                  be used for rotation in {type === 'round_robin' ? 'Round Robin' : 'Swiss System'}{' '}
                  matches.
                </Typography>
              </li>
            )}
            {type === 'single_elimination' && (
              <li>
                <Typography variant="body2">
                  <strong>Team Count:</strong> Requires a power-of-2 number of teams (2, 4, 8, 16,
                  32, 64, or 128).
                </Typography>
              </li>
            )}
            {type === 'double_elimination' && (
              <li>
                <Typography variant="body2">
                  <strong>Team Count:</strong> Requires a power-of-2 number of teams (2, 4, 8, 16,
                  32, 64, or 128).
                </Typography>
              </li>
            )}
            {type === 'round_robin' && (
              <li>
                <Typography variant="body2">
                  <strong>Team Count:</strong> Supports 2-32 teams. Each team plays every other team
                  once.
                </Typography>
              </li>
            )}
            {type === 'swiss' && (
              <li>
                <Typography variant="body2">
                  <strong>Team Count:</strong> Supports 4-64 teams. Teams with similar records face
                  each other.
                </Typography>
              </li>
            )}
            {format === 'bo1' && (
              <li>
                <Typography variant="body2">
                  <strong>Match Format:</strong> Best of 1 - First team to win 1 map wins the match.
                </Typography>
              </li>
            )}
            {format === 'bo3' && (
              <li>
                <Typography variant="body2">
                  <strong>Match Format:</strong> Best of 3 - First team to win 2 maps wins the
                  match.
                </Typography>
              </li>
            )}
            {format === 'bo5' && (
              <li>
                <Typography variant="body2">
                  <strong>Match Format:</strong> Best of 5 - First team to win 3 maps wins the
                  match.
                </Typography>
              </li>
            )}
          </Box>
        </Alert>
      )}

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
