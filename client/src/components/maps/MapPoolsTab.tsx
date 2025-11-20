import React from 'react';
import { Grid, Button } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CollectionsIcon from '@mui/icons-material/Collections';
import { EmptyState } from '../shared/EmptyState';
import { MapPoolCard } from './MapPoolCard';
import type { MapPool, Map as MapType } from '../../types/api.types';

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
  if (mapPools.length === 0) {
    return (
      <EmptyState
        icon={<CollectionsIcon sx={{ fontSize: 64 }} />}
        title="No map pools found"
        description="Get started by creating your first map pool"
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={onCreatePool}>
            Create Map Pool
          </Button>
        }
      />
    );
  }

  return (
    <Grid container spacing={2}>
      {mapPools.map((pool) => (
        <Grid item xs={12} sm={6} md={4} key={pool.id} sx={{ display: 'flex' }}>
          <MapPoolCard pool={pool} maps={maps} onClick={onPoolClick} />
        </Grid>
      ))}
    </Grid>
  );
}

