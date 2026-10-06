/**
 * The skin a finished matchmaking game dropped for you, on the match room's
 * result (the Result draft's "New skin"). Read from your inventory: a drop
 * from this match is one whose source is matchmaking and whose ref is the
 * match. Nothing when skins are off or nothing dropped.
 */
import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Panel } from '../common/ui';
import { fontDisplay, radii, textSize, tokens } from '../../theme/tokens';

const { color } = tokens;

interface Drop {
  id: number;
  weaponName: string;
  name: string;
  rarity: string;
  imageUrl: string;
  source: string;
  sourceRef: string | null;
  variant: string | null;
}

export function MatchDrop({ matchSlug }: { matchSlug: string }) {
  const { t } = useTranslation();
  const [drop, setDrop] = useState<Drop | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/skins/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ inventory: Drop[] }>) : null))
      .then((body) => {
        if (cancelled) return;
        setDrop(
          body?.inventory.find((s) => s.source === 'matchmaking' && s.sourceRef === matchSlug) ??
            null
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [matchSlug]);

  if (!drop) return null;
  return (
    <Panel
      component="section"
      aria-labelledby="mm-drop"
      data-testid="mm-drop"
      sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      <Typography
        id="mm-drop"
        component="h2"
        sx={{ m: 0, fontSize: textSize.md, fontWeight: 600, color: color.ink2 }}
      >
        {t('matchmaking.room.newSkin')}
      </Typography>
      <Box
        component="img"
        src={drop.imageUrl}
        alt=""
        sx={{
          width: '100%',
          aspectRatio: '4 / 3',
          objectFit: 'contain',
          borderRadius: radii.md,
          bgcolor: color.paper3,
        }}
      />
      <Box>
        <Typography sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
          {drop.weaponName} · {drop.name}
          {drop.variant ? ` (${drop.variant})` : ''}
        </Typography>
        <Typography sx={{ fontSize: textSize.sm, color: color.muted, textTransform: 'capitalize' }}>
          {drop.rarity}
        </Typography>
      </Box>
      <Button
        component={RouterLink}
        to="/inventory"
        variant="outlined"
        sx={{ alignSelf: 'flex-start', borderRadius: radii.pill }}
      >
        {t('matchmaking.room.inventory')}
      </Button>
    </Panel>
  );
}
