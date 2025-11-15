import React from 'react';
import { Chip, Stack } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import type { TeamMatchInfo } from '../../types';
import { getMapDisplayName } from '../../constants/maps';

type MapStatus = 'won' | 'lost' | 'ongoing' | 'upcoming';

const STATUS_STYLES: Record<
  MapStatus,
  { bgcolor: string; color: string; icon: React.ReactNode | null; border?: string }
> = {
  won: {
    bgcolor: 'success.main',
    color: 'success.contrastText',
    icon: <CheckCircleIcon fontSize="small" />,
  },
  lost: {
    bgcolor: 'error.main',
    color: 'error.contrastText',
    icon: <CancelIcon fontSize="small" />,
  },
  ongoing: {
    bgcolor: 'secondary.main',
    color: 'secondary.contrastText',
    icon: <PlayArrowIcon fontSize="small" />,
  },
  upcoming: {
    bgcolor: 'transparent',
    color: 'text.secondary',
    icon: null,
    border: '1px dashed',
  },
};

interface MatchMapChipsProps {
  match: TeamMatchInfo;
  currentMapNumber: number | null;
}

export function MatchMapChips({ match, currentMapNumber }: MatchMapChipsProps) {
  if (match.maps.length === 0) {
    return null;
  }

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {match.maps.map((map, idx) => {
        const result = match.mapResults.find((mr) => mr.mapNumber === idx);
        let status: MapStatus = 'upcoming';

        if (result) {
          if (result.team1Score > result.team2Score) {
            status = 'won';
          } else if (result.team2Score > result.team1Score) {
            status = 'lost';
          }
        } else if (
          typeof currentMapNumber === 'number' &&
          idx === currentMapNumber &&
          (match.status === 'live' || match.status === 'loaded')
        ) {
          status = 'ongoing';
        }

        const styles = STATUS_STYLES[status];

        return (
          <Chip
            key={idx}
            label={`${idx + 1}. ${getMapDisplayName(map)}`}
            size="medium"
            icon={styles.icon || undefined}
            sx={{
              bgcolor: styles.bgcolor,
              color: styles.color,
              fontWeight: 600,
              border: styles.border ?? 'none',
              borderColor: status === 'upcoming' ? 'divider' : 'transparent',
              '& .MuiChip-icon': {
                color: styles.color,
              },
            }}
          />
        );
      })}
    </Stack>
  );
}

