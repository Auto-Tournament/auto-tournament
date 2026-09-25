import { Grid } from '@mui/material';
import { ImagesIcon, PlusIcon } from '@phosphor-icons/react';
import { EmptyState, useModuleTranslation } from '../../../module-sdk';
import { MapPoolCard } from './MapPoolCard';
import type { MapPool, Map as MapType } from '../cs2.types';

interface MapPoolsTabProps {
  mapPools: MapPool[];
  maps: MapType[];
  onCreatePool: () => void;
  onPoolClick: (pool: MapPool) => void;
}

export function MapPoolsTab({
  mapPools,
  maps,
  onCreatePool,
  onPoolClick,
}: MapPoolsTabProps) {
  const { t } = useModuleTranslation('cs2');
  if (mapPools.length === 0) {
    return (
      <EmptyState
        icon={ImagesIcon}
        title={t('mapsPage.empty.poolsTitle')}
        description={t('mapsPage.empty.poolsDescription')}
        actionLabel={t('mapsPage.headerActions.createMapPool')}
        actionIcon={PlusIcon}
        onAction={onCreatePool}
      />
    );
  }

  return (
    <Grid container spacing={2} data-testid="map-pools-list">
      {mapPools.map((pool) => (
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={pool.id} sx={{ display: 'flex' }}>
          <MapPoolCard pool={pool} maps={maps} onClick={onPoolClick} />
        </Grid>
      ))}
    </Grid>
  );
}

