import React from 'react';
import { Box, Button, Stack, Typography, Divider } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import type { MatchMapResult } from '../../types';
import { getMapDisplayName } from '../../constants/maps';

interface MapDemoDownloadsProps {
  maps: string[];
  mapResults: MatchMapResult[];
  matchSlug: string;
}

export function MapDemoDownloads({
  maps,
  mapResults,
  matchSlug,
}: MapDemoDownloadsProps) {
  const handleDownloadDemo = (mapNumber: number, _mapName: string) => {
    const link = document.createElement('a');
    link.href = `/api/demos/${matchSlug}/download/${mapNumber}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Get all maps that have demos
  const mapsWithDemos = maps
    .map((map, idx) => {
      const result = mapResults.find((mr) => mr.mapNumber === idx);
      if (!result?.demoFilePath) return null;

      const displayName = getMapDisplayName(map) || map;
      const mapName = result.mapName || displayName;

      return {
        mapNumber: idx,
        mapName,
        displayName,
      };
    })
    .filter((item): item is { mapNumber: number; mapName: string; displayName: string } => item !== null);

  if (mapsWithDemos.length === 0) {
    return null;
  }

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        Map Demos
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Stack spacing={1}>
        {mapsWithDemos.map(({ mapNumber, mapName }) => (
          <Button
            key={mapNumber}
            variant="outlined"
            fullWidth
            startIcon={<DownloadIcon />}
            onClick={() => handleDownloadDemo(mapNumber, mapName)}
            sx={{ justifyContent: 'flex-start' }}
          >
            Download {mapName} demo
          </Button>
        ))}
      </Stack>
    </Box>
  );
}

