import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Button } from '@mui/material';
import { FilmStripIcon } from '@phosphor-icons/react';
import { api, useModuleTranslation } from '../../../module-sdk';
import type { MatchMapActionProps } from '../../types';
import { watchMatchReelPath } from '../highlights/data';

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
