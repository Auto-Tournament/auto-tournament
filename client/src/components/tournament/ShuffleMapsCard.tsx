import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, Card, CardContent, Grid } from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import { api } from '../../utils/api';
import type { Map } from '../../types/api.types';
import { getMapDisplayName } from '../../constants/maps';

interface ShuffleMapsCardProps {
  maps: string[];
}

export function ShuffleMapsCard({ maps }: ShuffleMapsCardProps) {
  const [availableMaps, setAvailableMaps] = useState<Map[]>([]);

  useEffect(() => {
    const loadMaps = async () => {
      try {
        const response = await api.get<{ maps: Map[] }>('/api/maps');
        if (response.maps) {
          setAvailableMaps(response.maps);
        }
      } catch (err) {
        console.error('Error loading maps:', err);
      }
    };
    loadMaps();
  }, []);

  // Split maps into three columns: groups of 3 alternate between columns
  // Column 1: maps 1-3, 10-12, 19-21, etc.
  // Column 2: maps 4-6, 13-15, 22-24, etc.
  // Column 3: maps 7-9, 16-18, 25-27, etc.
  const mapRows = useMemo(() => {
    if (maps.length === 0) return [];

    const getDisplayName = (mapId: string): string => {
      const map = availableMaps.find((m) => m.id === mapId);
      return map ? map.displayName : getMapDisplayName(mapId);
    };

    const rows: Array<Array<{ map: string; index: number; displayName: string } | null>> = [];
    const groupSize = 3;

    // Process maps in groups of 9 (3 groups of 3, one per column)
    for (let i = 0; i < maps.length; i += groupSize * 3) {
      // First group of 3 goes to column 1
      const group1 = maps.slice(i, i + groupSize);
      // Second group of 3 goes to column 2
      const group2 = maps.slice(i + groupSize, i + groupSize * 2);
      // Third group of 3 goes to column 3
      const group3 = maps.slice(i + groupSize * 2, i + groupSize * 3);

      // Create rows for this set of groups
      const maxGroupSize = Math.max(group1.length, group2.length, group3.length);
      for (let j = 0; j < maxGroupSize; j++) {
        const row: Array<{ map: string; index: number; displayName: string } | null> = [];

        // Column 1
        if (j < group1.length) {
          const mapIndex = i + j;
          row.push({
            map: group1[j],
            index: mapIndex + 1,
            displayName: getDisplayName(group1[j]),
          });
        } else {
          row.push(null);
        }

        // Column 2
        if (j < group2.length) {
          const mapIndex = i + groupSize + j;
          row.push({
            map: group2[j],
            index: mapIndex + 1,
            displayName: getDisplayName(group2[j]),
          });
        } else {
          row.push(null);
        }

        // Column 3
        if (j < group3.length) {
          const mapIndex = i + groupSize * 2 + j;
          row.push({
            map: group3[j],
            index: mapIndex + 1,
            displayName: getDisplayName(group3[j]),
          });
        } else {
          row.push(null);
        }

        rows.push(row);
      }
    }

    return rows;
  }, [maps, availableMaps]);

  return (
    <Card sx={{ width: '33%', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <CardContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          flex: 1,
          minHeight: 0,
        }}
      >
        <Box display="flex" alignItems="center" gap={1} mb={3}>
          <MapIcon color="action" fontSize="small" />
          <Typography variant="h6" fontWeight={600}>
            Map Order
          </Typography>
        </Box>

        {maps.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 'auto' }}>
            No maps selected
          </Typography>
        ) : (
          <Grid container spacing={1} sx={{ width: '100%', mt: 'auto' }}>
            {mapRows.map((row, rowIndex) =>
              row.map((item, colIndex) => (
                <Grid
                  key={
                    item ? `${item.map}-${rowIndex}-${colIndex}` : `empty-${rowIndex}-${colIndex}`
                  }
                  size={{ xs: 4 }}
                >
                  {item ? (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        py: 0.5,
                      }}
                    >
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ minWidth: 24, mr: 1 }}
                      >
                        {item.index}.
                      </Typography>
                      <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'left' }}>
                        {item.displayName}
                      </Typography>
                    </Box>
                  ) : null}
                </Grid>
              ))
            )}
          </Grid>
        )}
      </CardContent>
    </Card>
  );
}
