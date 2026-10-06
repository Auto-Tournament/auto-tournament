import { Box, Button, Dialog, Typography } from '@mui/material';
import { sourceLabel } from './SkinParts';
import { useModuleTranslation, tokens, fontDisplay, mono, radii, withAlpha } from '../../../module-sdk';
import { useMySkins, useSkinsEnabled } from './useSkins';
import { rarityColor } from './rarity';

const { color } = tokens;

/**
 * "New skin acquired" (board 3): shown once for each skin the player has not
 * seen yet, wherever they are in the app. The glow behind the skin breathes
 * slowly (still for reduced motion). Equip now or keep it in the inventory.
 */
export function NewSkinReveal() {
  const { t } = useModuleTranslation('cs2');
  const enabled = useSkinsEnabled();
  const { inventory, unseen, equip, markSeen, available } = useMySkins();
  const skin = enabled && available ? inventory.find((s) => s.id === unseen[0]) ?? null : null;
  if (!skin) return null;
  const tone = rarityColor[skin.rarity];

  const close = () => void markSeen([skin.id]);

  return (
    <Dialog
      open
      onClose={close}
      maxWidth="md"
      fullWidth
      data-testid="new-skin-reveal"
      PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper, backgroundImage: 'none' } }}
    >
      <Box sx={{ p: { xs: 3, md: 6 }, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3.5, textAlign: 'center' }}>
        <Box>
          <Typography sx={{ ...mono, fontSize: '0.8125rem', color: tone, textTransform: 'uppercase' }}>{t('skins.acquired')}</Typography>
          <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: { xs: '2rem', md: '3rem' }, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {skin.weaponName} · {skin.name}
          </Typography>
          {skin.sourceLabel && <Typography sx={{ color: color.muted }}>{sourceLabel(skin.sourceLabel)}</Typography>}
        </Box>
        <Box sx={{ width: '100%', maxWidth: 640, height: { xs: 220, md: 320 }, borderRadius: '28px', bgcolor: color.paper2, border: `1px solid ${color.rule}`, borderBottom: `4px solid ${tone}`, display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}>
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              width: { xs: 240, md: 360 },
              height: { xs: 240, md: 360 },
              borderRadius: '50%',
              bgcolor: withAlpha(tone, 0.16),
              animation: 'skinPulse 2.4s ease-in-out infinite',
              '@keyframes skinPulse': {
                '0%, 100%': { transform: 'scale(0.85)', opacity: 0.6 },
                '50%': { transform: 'scale(1.1)', opacity: 1 },
              },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          />
          <Box component="img" src={skin.imageUrl} alt={`${skin.weaponName} ${skin.name}`} sx={{ position: 'relative', width: '75%', height: '75%', objectFit: 'contain' }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button
            variant="contained"
            data-testid="new-skin-equip"
            onClick={() => {
              void equip(skin);
              close();
            }}
            sx={{ borderRadius: radii.pill, px: 4, py: 1.75, fontWeight: 600 }}
          >
            {t('skins.equipNow')}
          </Button>
          <Button variant="outlined" onClick={close} sx={{ borderRadius: radii.pill, px: 4, py: 1.75 }}>
            {t('skins.keep')}
          </Button>
        </Box>
        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{t('skins.notice')}</Typography>
      </Box>
    </Dialog>
  );
}
