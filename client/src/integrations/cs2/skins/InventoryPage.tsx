import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, ButtonBase, CircularProgress, Container, Dialog, MenuItem, Select, Typography } from '@mui/material';
import { PlayCircleIcon, QuestionIcon, TrophyIcon } from '@phosphor-icons/react';
import { api, pageTitle, useModuleTranslation, tokens, fontDisplay, radii } from '../../../module-sdk';
import { InspectSkinDialog, SkinCard, SlotTile, VirtualNotice } from './SkinParts';
import { loadoutSlots, useMySkins, useSkinsEnabled, type OwnedSkin, type Rarity } from './useSkins';

const { color } = tokens;
const RARITY_ORDER: Rarity[] = ['immortal', 'ancient', 'legendary', 'mythical', 'rare', 'uncommon', 'common'];

type Filter = 'all' | 'rifles' | 'pistols' | 'smgs' | 'heavy' | 'knives' | 'gloves';
const PISTOLS = ['glock', 'hkp2000', 'usp_silencer', 'p250', 'fiveseven', 'tec9', 'cz75a', 'deagle', 'revolver', 'elite'];
const SMGS = ['mac10', 'mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon'];
const HEAVY = ['nova', 'xm1014', 'sawedoff', 'mag7', 'm249', 'negev'];

function category(skin: OwnedSkin): Filter {
  if (skin.slot === 'knife') return 'knives';
  if (skin.slot === 'gloves') return 'gloves';
  const w = skin.weapon.replace('weapon_', '');
  if (PISTOLS.includes(w)) return 'pistols';
  if (SMGS.includes(w)) return 'smgs';
  if (HEAVY.includes(w)) return 'heavy';
  return 'rifles';
}

/**
 * The inventory (board 1): the equipped loadout as a row of slots, every skin
 * as a picture card, one click to equip (saved at once). On someone else's
 * page (`/player/:steamId/inventory`) the same view, read only.
 */
export function InventoryPage() {
  const { t } = useModuleTranslation('cs2');
  const { steamId } = useParams<{ steamId?: string }>();
  // /inventory is your own; /player/:steamId/inventory is anyone's, read only.
  const own = !steamId;
  const enabled = useSkinsEnabled();
  const mine = useMySkins();
  const [theirs, setTheirs] = useState<OwnedSkin[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'rarity' | 'newest'>('rarity');
  const [inspect, setInspect] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('skins.inventory'));
  }, [t]);

  useEffect(() => {
    if (own || !steamId) return;
    let cancelled = false;
    api
      .get<{ inventory: OwnedSkin[] }>(`/api/skins/players/${steamId}`)
      .then((r) => !cancelled && setTheirs(r.inventory ?? []))
      .catch(() => !cancelled && setTheirs([]));
    return () => {
      cancelled = true;
    };
  }, [own, steamId]);

  const inventory = useMemo(() => (own ? mine.inventory : (theirs ?? [])), [own, mine.inventory, theirs]);
  const loading = enabled === null || (own ? mine.loading : theirs === null);
  const shown = useMemo(() => {
    const list = inventory.filter((s) => filter === 'all' || category(s) === filter);
    return [...list].sort((a, b) =>
      sort === 'newest' ? b.createdAt - a.createdAt : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
    );
  }, [inventory, filter, sort]);
  const slots = loadoutSlots(inventory);

  const chip = (key: Filter) => (
    <ButtonBase
      key={key}
      onClick={() => setFilter(key)}
      aria-pressed={filter === key}
      sx={{
        px: 1.75,
        py: 1,
        borderRadius: radii.pill,
        fontSize: '0.875rem',
        border: `1px solid ${filter === key ? color.ink : color.rule}`,
        bgcolor: filter === key ? color.ink : 'transparent',
        color: filter === key ? color.accentInk : color.ink2,
        fontWeight: filter === key ? 600 : 400,
      }}
    >
      {t(`skins.filter.${key}`)}
    </ButtonBase>
  );

  return (
    <Box data-testid="inventory-page">
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 }, display: 'flex', flexDirection: 'column', gap: 3.5 }}>
        {enabled === false ? (
          <Typography sx={{ color: color.ink2 }}>{t('skins.off')}</Typography>
        ) : loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
            <CircularProgress aria-label={t('skins.inventory')} />
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2 }}>
              <Box>
                <Typography component="h1" sx={{ fontFamily: fontDisplay, fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {t('skins.inventory')}
                </Typography>
                <Typography sx={{ color: color.ink2 }}>{t('skins.count', { count: inventory.length })}</Typography>
              </Box>
              <VirtualNotice />
            </Box>

            <Box component="section" aria-labelledby="loadout-title" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography id="loadout-title" component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>
                {t('skins.equippedTitle')}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 1.25 }}>
                {slots.map((slot) => {
                  const skin = inventory.find((s) => s.slot === slot && s.equipped) ?? null;
                  const label =
                    slot === 'knife'
                      ? t('skins.slot.knife')
                      : slot === 'gloves'
                        ? t('skins.slot.gloves')
                        : inventory.find((s) => s.slot === slot)?.weaponName ?? slot;
                  return <SlotTile key={slot} label={label} skin={skin} />;
                })}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {(['all', 'rifles', 'pistols', 'smgs', 'heavy', 'knives', 'gloves'] as Filter[]).map(chip)}
              </Box>
              <Select size="small" value={sort} onChange={(e) => setSort(e.target.value as 'rarity' | 'newest')} sx={{ borderRadius: radii.pill, minWidth: 180 }} inputProps={{ 'aria-label': t('skins.sortLabel') }}>
                <MenuItem value="rarity">{t('skins.sort.rarity')}</MenuItem>
                <MenuItem value="newest">{t('skins.sort.newest')}</MenuItem>
              </Select>
            </Box>

            {shown.length === 0 ? (
              <Typography sx={{ color: color.ink2 }}>{inventory.length ? t('skins.noneInFilter') : own ? t('skins.emptyOwn') : t('skins.emptyTheirs')}</Typography>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1.75 }}>
                {shown.map((skin) => (
                  <SkinCard
                    key={skin.id}
                    skin={skin}
                    showNew={own}
                    onEquip={own ? (s) => void mine.equip(s) : undefined}
                    onInspect={(s) => setInspect(s.id)}
                  />
                ))}
              </Box>
            )}

            <ButtonBase onClick={() => setHelpOpen(true)} sx={{ alignSelf: 'flex-start', display: 'inline-flex', gap: 1.25, fontSize: '0.875rem', color: color.ink2 }}>
              <Box component="span" sx={{ width: 28, height: 28, borderRadius: '50%', border: `1px solid ${color.rule}`, display: 'grid', placeItems: 'center' }}>
                <QuestionIcon size={14} />
              </Box>
              {t('skins.howToGet')}
            </ButtonBase>
          </>
        )}
      </Container>

      <InspectSkinDialog skinId={inspect} onClose={() => setInspect(null)} />
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' } }}>
        <Box sx={{ p: 3.5, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 440 }}>
          <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 600 }}>
            {t('skins.howToGet')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <PlayCircleIcon size={22} color={color.accent} aria-hidden />
            <Typography>{t('skins.howMatchmaking')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TrophyIcon size={22} color={color.medalGold} aria-hidden />
            <Typography>{t('skins.howTournament')}</Typography>
          </Box>
          <VirtualNotice compact />
        </Box>
      </Dialog>
    </Box>
  );
}
