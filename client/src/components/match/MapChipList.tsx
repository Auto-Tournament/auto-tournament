import { Box, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { MatchMapResult } from '../../types';
import { getMapDisplayName } from '../../constants/maps';

interface MapChipListProps {
  maps: string[];
  activeMapIndex: number | null;
  activeMapLabel?: string | null;
  mapResults: MatchMapResult[];
}

export function MapChipList({
  maps,
  activeMapIndex,
  activeMapLabel,
  mapResults,
}: MapChipListProps) {
  const { t } = useTranslation();
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
          chipLabel = `${labelBase} • ${t('matchInfo.mapChips.live')}`;
          chipColor = 'secondary';
        }

        return (
          <Chip
            key={`${map}-${idx}`}
            label={chipLabel}
            color={chipColor}
            variant={chipColor === 'default' ? 'outlined' : 'filled'}
          />
        );
      })}
    </Box>
  );
}

