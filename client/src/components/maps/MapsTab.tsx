import React from 'react';
import { Grid, Button } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MapIcon from '@mui/icons-material/Map';
import { EmptyState } from '../shared/EmptyState';
import { MapCard } from './MapCard';
import type { Map } from '../../types/api.types';

interface MapsTabProps {
  maps: Map[];
  onAddMap: () => void;
  onMapClick: (map: Map) => void;
}

export function MapsTab({ maps, onAddMap, onMapClick }: MapsTabProps) {
  // Sort maps alphabetically by ID
  const sortedMaps = [...maps].sort((a, b) => a.id.localeCompare(b.id));

  if (sortedMaps.length === 0) {
    return (
      <EmptyState
        icon={MapIcon}
        title="No maps found"
        description="Get started by adding your first map"
        actionLabel="Add Map"
        actionIcon={AddIcon}
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
