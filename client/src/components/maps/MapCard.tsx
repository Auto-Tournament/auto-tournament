import React, { useState } from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import type { Map } from '../../types/api.types';

interface MapCardProps {
  map: Map;
  onClick: (map: Map) => void;
}

export function MapCard({ map, onClick }: MapCardProps) {
  const [imageError, setImageError] = useState(false);
  const showPlaceholder = !map.imageUrl || imageError;

  return (
    <Card
      data-testid={`map-card-${map.id}`}
      onClick={() => onClick(map)}
      elevation={1}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        transition: 'transform 0.2s, box-shadow 0.2s',
        cursor: 'pointer',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 4,
        },
      }}
    >
      <Box
        sx={{
          height: '140px',
          width: '100%',
          position: 'relative',
          backgroundColor: 'background.surface2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {!showPlaceholder && map.imageUrl ? (
          <Box
            component="img"
            src={map.imageUrl}
            alt={map.displayName}
            sx={{
              height: '100%',
              width: '100%',
              objectFit: 'cover',
            }}
            onError={() => setImageError(true)}
          />
        ) : (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              width: '100%',
              color: 'text.disabled',
            }}
          >
            <MapIcon sx={{ fontSize: 48 }} />
          </Box>
        )}
      </Box>
      <CardContent
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          pt: 2,
          px: 2,
          pb: 1.5,
          '&:last-child': {
            pb: 1.5,
          },
        }}
      >
        <Typography variant="h6" component="div" gutterBottom>
          {map.displayName}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {map.id}
        </Typography>
      </CardContent>
    </Card>
  );
}
