import React from 'react';
import { Box, Chip, IconButton, Tooltip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import type { MatchMapResult } from '../../types';
import { getMapDisplayName } from '../../constants/maps';

interface MapChipListProps {
  maps: string[];
  activeMapIndex: number | null;
  activeMapLabel?: string | null;
  mapResults: MatchMapResult[];
  matchSlug: string;
}

export function MapChipList({
  maps,
  activeMapIndex,
  activeMapLabel,
  mapResults,
  matchSlug,
}: MapChipListProps) {
  const handleDownloadDemo = (mapNumber: number, event: React.MouseEvent) => {
    event.stopPropagation();
    const link = document.createElement('a');
    link.href = `/api/demos/${matchSlug}/download/${mapNumber}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Box display="flex" flexWrap="wrap" gap={1} alignItems="center">
      {maps.map((map, idx) => {
        const displayName = getMapDisplayName(map) || map;
        const labelBase = `${idx + 1}. ${displayName}`;
        const result = mapResults.find((mr) => mr.mapNumber === idx);
        let chipLabel = labelBase;
        let chipColor: 'default' | 'success' | 'error' | 'secondary' = 'default';

        if (result) {
          chipLabel = `${labelBase} • ${result.team1Score}-${result.team2Score}`;
          chipColor = result.team1Score > result.team2Score ? 'success' : 'error';
        } else if (activeMapIndex === idx && activeMapLabel) {
          chipLabel = `${labelBase} • Live`;
          chipColor = 'secondary';
        }

        const hasDemo = result?.demoFilePath;

        return (
          <Box key={`${map}-${idx}`} display="flex" alignItems="center" gap={0.5}>
            <Chip
              label={chipLabel}
              color={chipColor}
              variant={chipColor === 'default' ? 'outlined' : 'filled'}
            />
            {hasDemo && (
              <Tooltip title={`Download demo for Map ${idx + 1}`}>
                <IconButton
                  size="small"
                  onClick={(e) => handleDownloadDemo(idx, e)}
                  sx={{ color: 'primary.main' }}
                >
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

