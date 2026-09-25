import { Box, Grid, Typography } from '@mui/material';
import { MapTrifoldIcon, PlusIcon } from '@phosphor-icons/react';
import { EmptyState, useModuleTranslation } from '../../../module-sdk';
import { MapCard } from './MapCard';
import { MAP_MODES, mapModeKey, mapModeOf } from './mapModes';
import type { Map, MapGameMode } from '../cs2.types';

interface MapsTabProps {
  maps: Map[];
  onAddMap: () => void;
  onMapClick: (map: Map) => void;
}

/** The maps, one section per map type (defusal, wingman, hostage, …), then those with none. */
export function MapsTab({ maps, onAddMap, onMapClick }: MapsTabProps) {
  const { t } = useModuleTranslation('cs2');
  // Sort maps alphabetically by ID
  const sortedMaps = [...maps].sort((a, b) => a.id.localeCompare(b.id));

  if (sortedMaps.length === 0) {
    return (
      <EmptyState
        icon={MapTrifoldIcon}
        title={t('mapsPage.empty.mapsTitle')}
        description={t('mapsPage.empty.mapsDescription')}
        actionLabel={t('mapsPage.headerActions.addMap')}
        actionIcon={PlusIcon}
        onAction={onAddMap}
      />
    );
  }

  const sections: Array<{ mode: MapGameMode | null; maps: Map[] }> = [...MAP_MODES, null]
    .map((mode) => ({ mode, maps: sortedMaps.filter((map) => mapModeOf(map) === mode) }))
    .filter((section) => section.maps.length > 0);

  return (
    <Box data-testid="maps-list" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {sections.map(({ mode, maps: sectionMaps }) => (
        <Box key={mode ?? 'none'} data-testid={`maps-section-${mode ?? 'none'}`}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
            {t(mapModeKey(mode))}{' '}
            <Typography component="span" variant="body2" color="text.secondary">
              {t(
                sectionMaps.length === 1
                  ? 'mapsPage.pool.mapCount'
                  : 'mapsPage.pool.mapCountPlural',
                {
                  count: sectionMaps.length,
                }
              )}
            </Typography>
          </Typography>
          <Grid container spacing={2}>
            {sectionMaps.map((map) => (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={map.id}>
                <MapCard map={map} onClick={onMapClick} />
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Box>
  );
}
