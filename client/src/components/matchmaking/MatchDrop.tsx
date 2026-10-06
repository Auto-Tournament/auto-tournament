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
import { useSnackbar } from '../../contexts/SnackbarContext';
import { fontDisplay, radii, textSize, tokens } from '../../theme/tokens';

const { color } = tokens;

/** The rarity colours CS2 uses (the same as the skins module's). */
const RARITY_COLOR: Record<string, string> = {
  common: '#b0c3d9',
  uncommon: '#5e98d9',
  rare: '#4b69ff',
  mythical: '#8847ff',
  legendary: '#d32ce6',
  ancient: '#eb4b4b',
  immortal: '#e4ae39',
};

interface Drop {
  id: number;
  weaponName: string;
  name: string;
  rarity: string;
  imageUrl: string;
  equipped?: boolean;
  source: string;
  sourceRef: string | null;
  variant: string | null;
}

export function MatchDrop({ matchSlug }: { matchSlug: string }) {
  const { t } = useTranslation();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [equipping, setEquipping] = useState(false);
  const { showError } = useSnackbar();

  const equip = async () => {
    if (!drop) return;
    setEquipping(true);
    try {
      const res = await fetch('/api/skins/me/equip', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skinId: drop.id }),
      });
      if (!res.ok) throw new Error(t('matchmaking.room.equipFailed'));
      setDrop({ ...drop, equipped: true });
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setEquipping(false);
    }
  };

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
        <Box sx={{ mt: 0.75, height: 4, borderRadius: 2, bgcolor: RARITY_COLOR[drop.rarity] ?? color.rule }} aria-hidden />
        <Typography sx={{ mt: 0.5, fontSize: textSize.sm, color: RARITY_COLOR[drop.rarity] ?? color.muted, textTransform: 'capitalize' }}>
          {drop.rarity}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          disabled={equipping || drop.equipped}
          onClick={() => void equip()}
          data-testid="mm-drop-equip"
          sx={{ borderRadius: radii.pill }}
        >
          {drop.equipped ? t('matchmaking.room.equipped') : t('matchmaking.room.equip')}
        </Button>
        <Button component={RouterLink} to="/inventory" variant="outlined" sx={{ borderRadius: radii.pill }}>
          {t('matchmaking.room.inventory')}
        </Button>
      </Box>
    </Panel>
  );
}
