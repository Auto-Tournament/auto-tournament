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
import { WarningIcon } from '@phosphor-icons/react';
import { useModuleTranslation } from '../../../module-sdk';
import { SortableMapList } from './SortableMapList';
import { validateMapCount, requiresVeto } from './mapRules';
import type { Map as MapType, MapGameMode, MapPool } from '../cs2.types';
import { MAP_MODES, fitsMapMode, mapModeColor, mapModeKey, mapModeOf } from '../maps/mapModes';

/**
 * The map pool picker, as data in and callbacks out: the tournament setup's
 * maps step (`Cs2TournamentMapsStep`) and the standalone match's maps step
 * both drive it.
 */
export interface MapPoolStepProps {
  format: string;
  type?: string; // Tournament type - needed for shuffle tournament explanation
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
  onMapRemove?: (mapId: string) => void;
  /**
   * When true, hides the shuffle‑tournament specific explanation block.
   * Useful for reusing this component in non‑tournament contexts (e.g. manual matches).
   */
  hideShuffleExplanation?: boolean;
  /**
   * When false, disables drag-and-drop ordering even for shuffle tournaments and
   * falls back to a simple chip preview. This is handy for contexts where map
   * order is irrelevant but we still want shuffle-style validation rules.
   */
  enableOrdering?: boolean;
  /**
   * The tournament's map type (`settings.cs2.mapMode`): only maps and pools of
   * that type are offered. The picker is shown when `onMapModeChange` is set.
   */
  mapMode?: MapGameMode;
  onMapModeChange?: (mode: MapGameMode | undefined) => void;
}

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
  mapMode,
  onMapModeChange,
}: MapPoolStepProps) {
  const { t } = useModuleTranslation('cs2');

  const getMapDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : mapId;
  };

  const modeOfId = (mapId: string) =>
    mapModeOf(
      availableMaps.find((m) => m.id === mapId),
      mapId
    );
  const getMapType = (mapId: string): string => t(mapModeKey(modeOfId(mapId)));
  const getMapTypeColor = (mapId: string) => mapModeColor(modeOfId(mapId));
  const fits = (mapId: string) =>
    fitsMapMode(
      availableMaps.find((m) => m.id === mapId),
      mapId,
      mapMode
    );

  // Sort maps by type (defusal, wingman, hostage, …), then by id; only the tournament's type.
  const modeOrder = (mapId: string) => {
    const mode = modeOfId(mapId);
    return mode ? MAP_MODES.indexOf(mode) : 999;
  };
  const sortedMaps = availableMaps
    .filter((m) => fits(m.id))
    .sort((a, b) => {
      const aOrder = modeOrder(a.id);
      const bOrder = modeOrder(b.id);

      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      // If same prefix, sort alphabetically by ID
      return a.id.localeCompare(b.id);
    });

  const allMapIds = sortedMaps.map((m) => m.id);
  // Pools with a map of another type are not offered under a map type.
  const offeredPools = mapPools.filter((p) => p.mapIds.every(fits));
  const offTypeMaps = maps.filter((id) => !fits(id));
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
      {onMapModeChange && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t('mapModeFilter.label')}</InputLabel>
          <Select
            data-testid="tournament-map-mode-select"
            value={mapMode ?? ''}
            label={t('mapModeFilter.label')}
            onChange={(e) =>
              onMapModeChange((e.target.value || undefined) as MapGameMode | undefined)
            }
            disabled={!canEdit || saving || loadingMaps}
            displayEmpty
          >
            <MenuItem value="">{t('mapModeFilter.any')}</MenuItem>
            {MAP_MODES.map((mode) => (
              <MenuItem key={mode} value={mode}>
                {t(mapModeKey(mode))}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      {offTypeMaps.length > 0 && mapMode && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="tournament-map-mode-warning">
          {t('mapModeFilter.offType', {
            maps: offTypeMaps.map(getMapDisplayName).join(', '),
            mode: t(mapModeKey(mapMode)),
          })}
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
          {offeredPools
            .filter((p) => p.isDefault && p.enabled)
            .map((pool) => (
              <MenuItem
                key={pool.id}
                value={pool.id.toString()}
                data-testid="tournament-map-pool-option"
              >
                {pool.name}
              </MenuItem>
            ))}
          {/* Show all non-default enabled pools */}
          {offeredPools
            .filter((p) => !p.isDefault && p.enabled)
            .map((pool) => (
              <MenuItem
                key={pool.id}
                value={pool.id.toString()}
                data-testid="tournament-map-pool-option"
              >
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
        <Alert severity="warning" icon={<WarningIcon size={24} />} sx={{ mb: 2 }}>
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
