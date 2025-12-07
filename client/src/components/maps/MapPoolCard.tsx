import React from 'react';
import { Card, CardContent, Typography, Box, Chip } from '@mui/material';
import type { MapPool, Map as MapType } from '../../types/api.types';

interface MapPoolCardProps {
  pool: MapPool;
  maps: MapType[];
  onClick: (pool: MapPool) => void;
}

export function MapPoolCard({ pool, maps, onClick }: MapPoolCardProps) {
  const getMapDisplayName = (mapId: string): string => {
    const map = maps.find((m) => m.id === mapId);
    return map ? map.displayName : mapId;
  };

  return (
    <Card
      onClick={() => onClick(pool)}
      elevation={1}
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        opacity: pool.enabled ? 1 : 0.7,
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 4,
        },
      }}
    >
      <CardContent
        sx={{
          flexGrow: 1,
          pt: 2,
          px: 2,
          pb: 1.5,
          '&:last-child': {
            pb: 1.5,
          },
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6" component="div">
            {pool.name}
          </Typography>
          <Box display="flex" gap={0.5}>
            {pool.isDefault && <Chip label="Default" size="small" color="primary" />}
            {!pool.enabled && <Chip label="Disabled" size="small" color="default" variant="outlined" />}
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {pool.mapIds.length} map{pool.mapIds.length !== 1 ? 's' : ''}
        </Typography>
        <Box display="flex" flexWrap="wrap" gap={0.5}>
          {pool.mapIds.slice(0, 5).map((mapId) => (
            <Chip key={mapId} label={getMapDisplayName(mapId)} size="small" variant="outlined" />
          ))}
          {pool.mapIds.length > 5 && (
            <Chip label={`+${pool.mapIds.length - 5} more`} size="small" variant="outlined" />
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
