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
import { useModuleTranslation } from '../../../module-sdk';
import { SortableMapList } from './SortableMapList';
import { validateMapCount, requiresVeto } from '../../../utils/tournamentVerification';
import type { TournamentContentStepProps as MapPoolStepProps } from '../../types';

export function MapPoolStep({
  format,
  type,
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
  onMapRemove,
  hideShuffleExplanation = false,
  enableOrdering = true,
}: MapPoolStepProps) {
  const { t } = useModuleTranslation('cs2');

  const getMapDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : mapId;
  };

  const getMapType = (mapId: string): string => {
    if (mapId.startsWith('de_')) return t('tournament.mapPool.types.defusal');
    if (mapId.startsWith('cs_')) return t('tournament.mapPool.types.hostage');
    if (mapId.startsWith('ar_')) return t('tournament.mapPool.types.armsRace');
    return t('tournament.mapPool.types.unknown');
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
  const isShuffle = type === 'shuffle';

  // Use verification rules system
  const mapValidation = validateMapCount(maps, type || '', format);
  const shouldShowVetoError = requiresVeto(type || '', format) && !mapValidation.valid;

  return (
    <Box>

      {/* Shuffle Tournament Explanation */}
      {isShuffle && !hideShuffleExplanation && (
        <Alert severity="info" sx={{ mb: 3 }} data-testid="shuffle-map-sequence-field">
          <Typography variant="body2" fontWeight={600} gutterBottom>
            {t('tournament.mapPool.shuffleTitle')}
          </Typography>
          <Typography variant="body2">
            {t('tournament.mapPool.shuffleBody')}
            {maps.length > 0 && (
              <strong>
                {' '}
                {t('tournament.mapPool.shuffleSelected', {
                  maps: t('tournament.counts.maps', { count: maps.length }),
                  rounds: t('tournament.counts.rounds', { count: maps.length }),
                })}
              </strong>
            )}
          </Typography>
        </Alert>
      )}
      {/* Map Pool Selection Dropdown */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>{t('tournament.mapPool.chooseLabel')}</InputLabel>
        <Select
          data-testid="tournament-map-pool-select"
          value={selectedMapPool || ''}
          label={t('tournament.mapPool.chooseLabel')}
          onChange={(e) => onMapPoolChange(e.target.value)}
          disabled={!canEdit || saving || loadingMaps}
          displayEmpty
        >
          {/* Show default pool first (could be Active Duty or a custom default) */}
          {mapPools
            .filter((p) => p.isDefault && p.enabled)
            .map((pool) => (
              <MenuItem key={pool.id} value={pool.id.toString()} data-testid="tournament-map-pool-option">
                {pool.name}
              </MenuItem>
            ))}
          {/* Show all non-default enabled pools */}
          {mapPools
            .filter((p) => !p.isDefault && p.enabled)
            .map((pool) => (
              <MenuItem key={pool.id} value={pool.id.toString()} data-testid="tournament-map-pool-option">
                {pool.name}
              </MenuItem>
            ))}
          <MenuItem value="custom" data-testid="tournament-map-pool-option">
            {t('tournament.mapPool.custom')}
          </MenuItem>
        </Select>
      </FormControl>

      {/* Map Preview - Sortable for shuffle tournaments */}
      {maps.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('tournament.mapPool.selectedMaps', { total: maps.length })}
          </Typography>
          {isShuffle && enableOrdering ? (
            <SortableMapList
              maps={maps}
              availableMaps={availableMaps}
              onMapsReorder={onMapsChange}
              onMapRemove={onMapRemove}
              disabled={!canEdit || saving}
            />
          ) : (
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
          )}
        </Box>
      )}

      {/* Map Pool Validation */}
      {shouldShowVetoError && mapValidation.message && (
        <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
          <Typography variant="body2">
            <strong>{mapValidation.message}</strong>
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
            renderInput={(params) => (
              <TextField {...params} placeholder={t('tournament.mapPool.chooseMapsPlaceholder')} />
            )}
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
              {t('tournament.mapPool.saveMapPool')}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}
