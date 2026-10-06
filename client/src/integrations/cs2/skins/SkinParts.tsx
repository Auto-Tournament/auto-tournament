import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Dialog, IconButton, Link, Typography } from '@mui/material';
import {
  CheckIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  PlayCircleIcon,
  PlusIcon,
  TrophyIcon,
  XIcon,
} from '@phosphor-icons/react';
import { api, useModuleTranslation, tokens, fontDisplay, mono, radii, withAlpha } from '../../../module-sdk';
import { wearKey, type OwnedSkin } from './useSkins';
import { rarityColor } from './rarity';
import { playerInventoryPath } from './paths';
import { getMapDisplayName } from '../maps/mapData';

const { color } = tokens;

/** "Mirage" for a map id, the label itself for a tournament name. */
export function sourceLabel(label: string): string {
  return /^(de|cs|ar|dz)_/.test(label) ? getMapDisplayName(label) : label;
}

/** The fixed notice: skins exist only here. Admins cannot change it. */
export function VirtualNotice({ compact = false }: { compact?: boolean }) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Box
      data-testid="skins-notice"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1.25,
        px: compact ? 0 : 2,
        py: compact ? 0 : 1.25,
        borderRadius: radii.pill,
        bgcolor: compact ? 'transparent' : color.paper2,
        border: compact ? 'none' : `1px solid ${color.rule}`,
        fontSize: '0.8125rem',
        color: compact ? color.muted : color.ink2,
      }}
    >
      {!compact && <InfoIcon size={16} aria-hidden />}
      {t('skins.notice')}
    </Box>
  );
}

/** The skin picture on a dark tile. */
export function SkinImage({ skin, height }: { skin: Pick<OwnedSkin, 'imageUrl'>; height: number }) {
  return (
    <Box
      component="img"
      src={skin.imageUrl}
      alt=""
      loading="lazy"
      sx={{ width: '100%', height, objectFit: 'contain', bgcolor: color.paper3, p: 1.25, boxSizing: 'border-box', display: 'block' }}
    />
  );
}

/**
 * One skin in a grid (board 1): picture, weapon, name and a rarity bar. A
 * click equips it; equipped skins carry an orange ring just outside the card
 * and a tick. The magnifier (on hover) opens the skin.
 */
export function SkinCard({
  skin,
  onEquip,
  onInspect,
  showNew = false,
}: {
  skin: OwnedSkin;
  onEquip?: (skin: OwnedSkin) => void;
  onInspect: (skin: OwnedSkin) => void;
  showNew?: boolean;
}) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Box sx={{ position: 'relative', display: 'flex', '&:hover .inspect, & .inspect:focus-visible': { opacity: 1 } }}>
      <ButtonBase
        onClick={() => (onEquip ? onEquip(skin) : onInspect(skin))}
        aria-label={onEquip ? (skin.equipped ? t('skins.equippedLabel', { name: skin.name }) : t('skins.equipLabel', { name: skin.name })) : skin.name}
        data-testid="skin-card"
        data-equipped={skin.equipped ? 'true' : 'false'}
        sx={{
          flex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          textAlign: 'left',
          borderRadius: '16px',
          overflow: 'hidden',
          bgcolor: color.paper2,
          border: `1px solid ${color.rule}`,
          ...(skin.equipped && { outline: `2px solid ${color.accent}`, outlineOffset: '3px' }),
          '&:hover': { borderColor: color.muted },
          '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: '3px' },
        }}
      >
        <SkinImage skin={skin} height={96} />
        <Typography sx={{ fontSize: '0.75rem', color: color.muted, px: 1.5, pt: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {skin.weaponName}
        </Typography>
        <Typography sx={{ fontWeight: 600, fontSize: '0.875rem', px: 1.5, pt: 0.25, pb: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {skin.name}
        </Typography>
        <Box sx={{ mt: 'auto', height: 3, bgcolor: rarityColor[skin.rarity] }} />
      </ButtonBase>
      {skin.equipped && (
        <Box aria-hidden sx={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%', bgcolor: color.accent, color: color.accentInk, display: 'grid', placeItems: 'center' }}>
          <CheckIcon size={14} weight="bold" />
        </Box>
      )}
      {showNew && !skin.seen && (
        <Box sx={{ position: 'absolute', top: 10, left: 10, px: 1, py: '2px', borderRadius: radii.pill, bgcolor: color.accent, color: color.accentInk, fontSize: '0.6875rem', fontWeight: 700 }}>
          {t('skins.new')}
        </Box>
      )}
      <IconButton
        className="inspect"
        aria-label={t('skins.inspect', { name: skin.name })}
        onClick={() => onInspect(skin)}
        sx={{ position: 'absolute', top: 8, left: showNew && !skin.seen ? 56 : 8, width: 32, height: 32, bgcolor: color.paper2, border: `1px solid ${color.rule}`, opacity: 0, '&:hover': { bgcolor: color.paper3 } }}
      >
        <MagnifyingGlassIcon size={16} />
      </IconButton>
    </Box>
  );
}

/** A loadout slot: the equipped skin's picture, or a plus when empty. */
export function SlotTile({ label, skin }: { label: string; skin: OwnedSkin | null }) {
  return (
    <Box
      data-testid="loadout-slot"
      sx={{
        borderRadius: '14px',
        overflow: 'hidden',
        bgcolor: color.paper2,
        border: `1px ${skin ? 'solid' : 'dashed'} ${skin ? rarityColor[skin.rarity] : color.rule}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {skin ? (
        <Box component="img" src={skin.imageUrl} alt="" sx={{ width: '100%', height: 64, objectFit: 'contain', bgcolor: color.paper3, p: 0.75, boxSizing: 'border-box' }} />
      ) : (
        <Box sx={{ height: 64, display: 'grid', placeItems: 'center', bgcolor: color.paper3, color: color.muted }} aria-hidden>
          <PlusIcon size={20} />
        </Box>
      )}
      <Typography sx={{ fontSize: '0.75rem', color: color.muted, px: 1.25, py: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </Typography>
    </Box>
  );
}

interface InspectData {
  skin: OwnedSkin;
  owner: { steamId: string; name: string; avatar: string | null };
}

/**
 * One skin up close (board 2): the picture, wear next to the weapon, float
 * and pattern, where it was won, and who owns it.
 */
export function InspectSkinDialog({ skinId, onClose }: { skinId: number | null; onClose: () => void }) {
  const { t, i18n } = useModuleTranslation('cs2');
  const [data, setData] = useState<InspectData | null>(null);

  useEffect(() => {
    if (skinId === null) return;
    let cancelled = false;
    api
      .get<InspectData>(`/api/skins/skin/${skinId}`)
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [skinId]);

  const skin = data?.skin && data.skin.id === skinId ? data.skin : null;
  const date = skin ? new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(skin.createdAt * 1000) : '';

  return (
    <Dialog open={skinId !== null} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none', overflow: 'hidden' } }}>
      {skin && data && (
        <Box data-testid="skin-inspect" sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1.2fr) minmax(0,1fr)' } }}>
          <Box sx={{ bgcolor: color.paper3, display: 'grid', placeItems: 'center', p: 5, borderBottom: `4px solid ${rarityColor[skin.rarity]}` }}>
            <Box component="img" src={skin.imageUrl} alt={`${skin.weaponName} ${skin.name}`} sx={{ width: '100%', maxHeight: 280, objectFit: 'contain' }} />
          </Box>
          <Box sx={{ p: 3.5, display: 'flex', flexDirection: 'column', gap: 2.25 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box component="span" sx={{ px: 1.25, py: 0.5, borderRadius: radii.pill, bgcolor: withAlpha(rarityColor[skin.rarity], 0.14), color: rarityColor[skin.rarity], ...mono, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                {t(`skins.rarity.${skin.rarity}`)}
              </Box>
              <IconButton aria-label={t('common.close')} onClick={onClose} sx={{ border: `1px solid ${color.rule}` }}>
                <XIcon size={16} />
              </IconButton>
            </Box>
            <Box>
              <Typography sx={{ color: color.muted }}>
                {skin.weaponName} · {t(`skins.wear.${wearKey(skin.float)}`)}
              </Typography>
              <Typography sx={{ fontFamily: fontDisplay, fontSize: '2rem', fontWeight: 700 }}>{skin.name}</Typography>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 1 }}>
              {[
                [t('skins.float'), skin.float.toFixed(4)],
                [t('skins.pattern'), String(skin.pattern)],
              ].map(([label, value]) => (
                <Box key={label} sx={{ p: '10px 12px', borderRadius: '12px', bgcolor: color.paper3 }}>
                  <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{label}</Typography>
                  <Typography sx={{ ...mono, fontWeight: 500 }}>{value}</Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', p: 1.75, borderRadius: '14px', bgcolor: color.paper3 }}>
              {skin.source === 'tournament' ? <TrophyIcon size={22} color={color.medalGold} aria-hidden /> : <PlayCircleIcon size={22} color={color.accent} aria-hidden />}
              <Box>
                <Typography sx={{ fontWeight: 600, color: skin.source === 'tournament' ? color.medalGold : color.ink }}>
                  {skin.source === 'tournament' ? t('skins.place', { n: skin.place ?? 1 }) : t('skins.wonMatchmaking')}
                </Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
                  {[skin.sourceLabel ? sourceLabel(skin.sourceLabel) : null, date].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
              <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: color.paper3, backgroundImage: data.owner.avatar ? `url("${data.owner.avatar}")` : 'none', backgroundSize: 'cover', display: 'grid', placeItems: 'center', fontWeight: 600 }}>
                {!data.owner.avatar && data.owner.name.slice(0, 1)}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography>{data.owner.name}</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{skin.equipped ? t('skins.equipped') : t('skins.inInventory')}</Typography>
              </Box>
              <Link component={RouterLink} to={playerInventoryPath(data.owner.steamId)} onClick={onClose} sx={{ fontSize: '0.875rem', color: color.ink2 }}>
                {t('skins.theirInventory', { name: data.owner.name })}
              </Link>
            </Box>
            <VirtualNotice compact />
          </Box>
        </Box>
      )}
    </Dialog>
  );
}
