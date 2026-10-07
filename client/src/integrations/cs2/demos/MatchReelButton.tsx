import { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { FilmStripIcon, XIcon } from '@phosphor-icons/react';
import { api, useModuleTranslation } from '../../../module-sdk';
import type { MatchMapActionProps } from '../../types';

interface MatchReel {
  mapNumber: number;
  status: string;
  clips: number | null;
  video: string | null;
}

/**
 * Beside a map's demo download (`matchMapAction`): "Match reel" once the
 * recorder joined each player's best highlight of the map; it plays in a
 * dialog. Nothing until then.
 */
export function MatchReelButton({ matchSlug, mapNumber }: MatchMapActionProps) {
  const { t } = useModuleTranslation('cs2');
  const [reel, setReel] = useState<MatchReel | null>(null);
  const [open, setOpen] = useState(false);

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
    <>
      <Button
        variant="outlined"
        startIcon={<FilmStripIcon />}
        onClick={() => setOpen(true)}
        data-testid={`match-reel-button-${mapNumber}`}
        sx={{ flex: 'none', whiteSpace: 'nowrap' }}
      >
        {t('highlights.matchReel')}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {t('highlights.matchReel')}
          <IconButton onClick={() => setOpen(false)} aria-label={t('highlights.close')}>
            <XIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box
            component="video"
            src={reel.video}
            controls
            autoPlay
            playsInline
            sx={{ display: 'block', width: '100%', aspectRatio: '16 / 9', bgcolor: '#0b0d10', borderRadius: 1 }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
