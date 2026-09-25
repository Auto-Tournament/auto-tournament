import { Grid } from '@mui/material';
import { MapTrifoldIcon, PlusIcon } from '@phosphor-icons/react';
import { EmptyState, useModuleTranslation } from '../../../module-sdk';
import { MapCard } from './MapCard';
import type { Map } from '../cs2.types';

interface MapsTabProps {
  maps: Map[];
  onAddMap: () => void;
  onMapClick: (map: Map) => void;
}

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

  return (
    <Grid container spacing={2} data-testid="maps-list">
      {sortedMaps.map((map) => (
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={map.id}>
          <MapCard map={map} onClick={onMapClick} />
        </Grid>
      ))}
    </Grid>
  );
}
