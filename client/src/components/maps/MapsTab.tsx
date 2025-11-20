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
        icon={<MapIcon sx={{ fontSize: 64 }} />}
        title="No maps found"
        description="Get started by adding your first map"
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={onAddMap}>
            Add Map
          </Button>
        }
      />
    );
  }

  return (
    <Grid container spacing={2}>
      {sortedMaps.map((map) => (
        <Grid item key={map.id}>
          <MapCard map={map} onClick={onMapClick} />
        </Grid>
      ))}
    </Grid>
  );
}

