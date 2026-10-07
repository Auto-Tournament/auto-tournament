import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import { FilmStripIcon } from '@phosphor-icons/react';
import { api, useModuleTranslation } from '../../../module-sdk';
import type { MatchMapActionProps } from '../../types';
import { watchMatchReelPath } from '../highlights/data';
import { RecordingDot } from '../highlights/HighlightCard';

interface MatchReel {
  mapNumber: number;
  status: string;
  clips: number | null;
  video: string | null;
}

/**
 * Beside a map's demo download (`matchMapAction`): "Match reel" once the
 * recorder joined each player's best highlight of the map. It opens the
 * reel's own page, a link to share, with our player and its chapters.
 * Nothing until then.
 */
export function MatchReelButton({ matchSlug, mapNumber, onNavigate }: MatchMapActionProps) {
  const { t } = useModuleTranslation('cs2');
  const [reel, setReel] = useState<MatchReel | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ reels: MatchReel[] }>(`/api/game/cs2/matches/${encodeURIComponent(matchSlug)}/reels`)
      .then((res) => {
        if (!cancelled) setReel(res.reels.find((r) => r.mapNumber === mapNumber) ?? null);
      })
      .catch(() => !cancelled && setReel(null));
    return () => {
      cancelled = true;
    };
  }, [matchSlug, mapNumber]);

  // Still being made: say so where the button will be.
  if (reel && !reel.video && (reel.status === 'recording' || reel.status === 'pending')) {
    return (
      <Box
        role="status"
        data-testid={`match-reel-recording-${mapNumber}`}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.5, height: 36, borderRadius: 999, border: '1px dashed', borderColor: 'divider', color: 'text.secondary', fontSize: '0.8125rem', whiteSpace: 'nowrap', flex: 'none' }}
      >
        <RecordingDot />
        {t('highlights.matchReelRecording')}
      </Box>
    );
  }
  if (!reel?.video) return null;
  return (
    <Button
      component={RouterLink}
      to={watchMatchReelPath(matchSlug, mapNumber)}
      onClick={onNavigate}
      variant="outlined"
      startIcon={<FilmStripIcon />}
      data-testid={`match-reel-button-${mapNumber}`}
      sx={{ flex: 'none', whiteSpace: 'nowrap' }}
    >
      {t('highlights.matchReel')}
    </Button>
  );
}
