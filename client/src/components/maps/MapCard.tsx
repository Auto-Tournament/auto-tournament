import React from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import type { Map } from '../../types/api.types';
import { FadeInImage } from '../common/FadeInImage';

interface MapCardProps {
  map: Map;
  onClick: (map: Map) => void;
}

export function MapCard({ map, onClick }: MapCardProps) {
  const getPreferredImageUrl = (): string | null => {
    const baseWebpUrl = `https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails/${map.id}.webp`;

    // If there's no stored URL or it's a repo URL, always use the standardized WebP path.
    if (!map.imageUrl || map.imageUrl.includes('cs2-server-manager')) {
      return baseWebpUrl;
    }

    // For custom uploads (non-repo URLs), use the stored URL as-is.
    return map.imageUrl;
  };

  const preferredImageUrl = getPreferredImageUrl();
  const showPlaceholder = !preferredImageUrl;

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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {!showPlaceholder && preferredImageUrl ? (
          <FadeInImage
            src={preferredImageUrl}
            alt={map.displayName}
            height="100%"
            width="100%"
            sx={{}}
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
