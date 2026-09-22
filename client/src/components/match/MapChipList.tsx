import { Box, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { MatchMapResult } from '../../types';
import { getMapDisplayName } from '../../constants/maps';

interface MapChipListProps {
  maps: string[];
  activeMapIndex: number | null;
  activeMapLabel?: string | null;
  mapResults: MatchMapResult[];
  team1Name?: string;
  team2Name?: string;
}

/** Winning side of a map: the recorded winner, else the higher score. */
function mapWinner(result: MatchMapResult): 'team1' | 'team2' | null {
  const recorded = result.winnerTeam ?? result.winner;
  if (recorded === 'team1' || recorded === 'team2') return recorded;
  if (result.team1Score === result.team2Score) return null;
  return result.team1Score > result.team2Score ? 'team1' : 'team2';
}

export function MapChipList({
  maps,
  activeMapIndex,
  activeMapLabel,
  mapResults,
  team1Name,
  team2Name,
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
          const winner = mapWinner(result);
          chipLabel = `${labelBase} • ${result.team1Score}-${result.team2Score}`;
          // Level scores with a winner were decided by the damage tiebreak; a
          // bare "2-2" gave no hint who took the map.
          if (winner && result.team1Score === result.team2Score) {
            const team = winner === 'team1' ? team1Name : team2Name;
            chipLabel += ` • ${
              team
                ? t('matchInfo.mapChips.tiebreakWin', { team })
                : t('matchInfo.mapChips.tiebreak')
            }`;
          }
          chipColor = winner === 'team1' ? 'success' : 'error';
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

