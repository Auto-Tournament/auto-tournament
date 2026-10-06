import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Checkbox, Dialog, FormControlLabel, IconButton, Typography } from '@mui/material';
import { ArrowDownIcon, ArrowUpIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSkinsEnabled, useMySkins, type OwnedSkin, type ShowcaseItem } from '../../hooks/useSkins';
import { InspectSkinDialog } from './SkinParts';
import { tokens, fontDisplay, radii, rarityColor } from '../../theme/tokens';

const { color } = tokens;
const MAX = 8;

/** The showcase as the owner arranged it, or the equipped skins with knife and gloves big. */
function arrange(inventory: OwnedSkin[], showcase: ShowcaseItem[]): Array<{ skin: OwnedSkin; big: boolean }> {
  const byId = new Map(inventory.map((s) => [s.id, s]));
  const chosen = showcase
    .map((item) => ({ skin: byId.get(item.skinId), big: item.big }))
    .filter((x): x is { skin: OwnedSkin; big: boolean } => Boolean(x.skin));
  if (chosen.length) return chosen.slice(0, MAX);
  const equipped = inventory.filter((s) => s.equipped);
  const big = equipped.filter((s) => s.slot === 'knife' || s.slot === 'gloves');
  const rest = equipped.filter((s) => s.slot !== 'knife' && s.slot !== 'gloves');
  return [...big.map((skin) => ({ skin, big: true })), ...rest.map((skin) => ({ skin, big: false }))].slice(0, MAX);
}

function Tile({ skin, big, onClick }: { skin: OwnedSkin; big: boolean; onClick: () => void }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      aria-label={`${skin.weaponName} ${skin.name}`}
      sx={{
        all: 'unset',
        cursor: 'pointer',
        boxSizing: 'border-box',
        gridColumn: big ? 'span 2' : 'span 1',
        gridRow: big ? 'span 2' : 'span 1',
        borderRadius: big ? radii.lg : '14px',
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        borderBottom: `${big ? 4 : 3}px solid ${rarityColor[skin.rarity]}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: big ? 'center' : 'stretch',
        justifyContent: 'center',
        overflow: 'hidden',
        '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
        '&:hover': { borderColor: color.muted },
      }}
    >
      <Box component="img" src={skin.imageUrl} alt="" sx={{ width: '100%', height: big ? 170 : 84, objectFit: 'contain', bgcolor: big ? 'transparent' : color.paper3, p: 1, boxSizing: 'border-box' }} />
      <Box sx={{ px: big ? 0 : 1.25, pb: big ? 2 : 1.25, pt: 0.75, textAlign: big ? 'center' : 'left' }}>
        <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{skin.weaponName}</Typography>
        <Typography sx={{ fontWeight: 600, fontSize: big ? '1.25rem' : '0.8125rem', fontFamily: big ? fontDisplay : undefined }}>{skin.name}</Typography>
      </Box>
    </Box>
  );
}

/**
 * The loadout on a player's profile (board 4): knife and gloves big by
 * default, the rest as a shelf, at most eight. The owner arranges which ones
 * show and which are big. "Show inventory" opens everything they own.
 */
export function ProfileLoadout({ steamId, isOwn }: { steamId: string; isOwn: boolean }) {
  const { t } = useTranslation();
  const enabled = useSkinsEnabled();
  const mine = useMySkins();
  const [data, setData] = useState<{ inventory: OwnedSkin[]; showcase: ShowcaseItem[] } | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const [arranging, setArranging] = useState(false);
  const [draft, setDraft] = useState<Array<{ skinId: number; big: boolean }>>([]);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<{ inventory: OwnedSkin[]; showcase: ShowcaseItem[] }>(`/api/skins/players/${steamId}`)
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [enabled, steamId, version]);

  if (!enabled || !data || data.inventory.length === 0) return null;
  const items = arrange(data.inventory, data.showcase);

  const openArrange = () => {
    setDraft(items.map((i) => ({ skinId: i.skin.id, big: i.big })));
    setArranging(true);
  };
  const toggle = (skinId: number) =>
    setDraft((d) => (d.some((x) => x.skinId === skinId) ? d.filter((x) => x.skinId !== skinId) : d.length < MAX ? [...d, { skinId, big: false }] : d));
  const move = (index: number, delta: number) =>
    setDraft((d) => {
      const next = [...d];
      const target = index + delta;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <Box component="section" aria-labelledby="profile-loadout" sx={{ mt: 6, display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="profile-loadout">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography id="profile-loadout" component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600, flex: 1 }}>
          {t('skins.loadout')}
        </Typography>
        {isOwn && (
          <Button size="small" variant="outlined" startIcon={<PencilSimpleIcon size={14} />} onClick={openArrange} sx={{ borderRadius: radii.pill }}>
            {t('skins.arrange')}
          </Button>
        )}
        <Button size="small" component={RouterLink} to={isOwn ? '/inventory' : `/player/${steamId}/inventory`} sx={{ borderRadius: radii.pill, bgcolor: color.paper3, color: color.ink }}>
          {t('skins.showInventory')}
        </Button>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', md: 'repeat(6, minmax(0,1fr))' }, gridAutoFlow: 'dense', gap: 1.5 }}>
        {items.map(({ skin, big }) => (
          <Tile key={skin.id} skin={skin} big={big} onClick={() => setInspect(skin.id)} />
        ))}
      </Box>
      <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{t('skins.notice')}</Typography>

      <InspectSkinDialog skinId={inspect} onClose={() => setInspect(null)} />

      <Dialog open={arranging} onClose={() => setArranging(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' } }}>
        <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 600 }}>
            {t('skins.arrangeTitle')}
          </Typography>
          <Typography sx={{ color: color.muted, fontSize: '0.875rem' }}>{t('skins.arrangeHint', { max: MAX })}</Typography>
          {draft.map((item, index) => {
            const skin = mine.inventory.find((s) => s.id === item.skinId) ?? data.inventory.find((s) => s.id === item.skinId);
            if (!skin) return null;
            return (
              <Box key={item.skinId} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: '12px', bgcolor: color.paper3 }}>
                <Box component="img" src={skin.imageUrl} alt="" sx={{ width: 64, height: 40, objectFit: 'contain' }} />
                <Typography sx={{ flex: 1, minWidth: 0 }}>
                  {skin.weaponName} · {skin.name}
                </Typography>
                <FormControlLabel
                  control={<Checkbox size="small" checked={item.big} onChange={(e) => setDraft((d) => d.map((x) => (x.skinId === item.skinId ? { ...x, big: e.target.checked } : x)))} />}
                  label={t('skins.big')}
                />
                <IconButton size="small" aria-label={t('skins.moveUp')} onClick={() => move(index, -1)}>
                  <ArrowUpIcon size={14} />
                </IconButton>
                <IconButton size="small" aria-label={t('skins.moveDown')} onClick={() => move(index, 1)}>
                  <ArrowDownIcon size={14} />
                </IconButton>
                <Button size="small" onClick={() => toggle(item.skinId)}>
                  {t('skins.hide')}
                </Button>
              </Box>
            );
          })}
          <Typography sx={{ fontWeight: 600, mt: 1 }}>{t('skins.addToShowcase')}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {data.inventory
              .filter((s) => !draft.some((d) => d.skinId === s.id))
              .slice(0, 40)
              .map((s) => (
                <Button key={s.id} size="small" variant="outlined" disabled={draft.length >= MAX} onClick={() => toggle(s.id)} sx={{ borderRadius: radii.pill, borderColor: rarityColor[s.rarity] }}>
                  {s.weaponName} · {s.name}
                </Button>
              ))}
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
            <Button onClick={() => setArranging(false)}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={async () => {
                await mine.saveShowcase(draft);
                setArranging(false);
                setVersion((v) => v + 1);
              }}
            >
              {t('skins.save')}
            </Button>
          </Box>
        </Box>
      </Dialog>
    </Box>
  );
}
