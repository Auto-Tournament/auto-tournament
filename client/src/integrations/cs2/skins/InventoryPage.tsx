import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import { skinPaths } from './paths';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Container,
  Dialog,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { PlayCircleIcon, QuestionIcon, TrophyIcon } from '@phosphor-icons/react';
import {
  api,
  pageTitle,
  useModuleTranslation,
  useSnackbar,
  tokens,
  fontDisplay,
  radii,
} from '../../../module-sdk';
import { InspectSkinDialog, SkinCard, SlotTile, VirtualNotice } from './SkinParts';
import { loadoutSlots, useMySkins, useSkinsEnabled, type OwnedSkin, type Rarity } from './useSkins';
import { equippedFor, type LoadoutTeam } from './loadoutSides';
import { canPick, togglePick } from './tradeUp';
import { TradeUpPanel } from './TradeUpPanel';
import { TryoutLink } from './TryoutLink';

const { color } = tokens;
const RARITY_ORDER: Rarity[] = [
  'immortal',
  'ancient',
  'legendary',
  'mythical',
  'rare',
  'uncommon',
  'common',
];

type Filter = 'all' | 'rifles' | 'pistols' | 'smgs' | 'heavy' | 'knives' | 'gloves';
const PISTOLS = [
  'glock',
  'hkp2000',
  'usp_silencer',
  'p250',
  'fiveseven',
  'tec9',
  'cz75a',
  'deagle',
  'revolver',
  'elite',
];
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
  const { showError } = useSnackbar();
  const equipFailed = (error: unknown) =>
    showError(error instanceof Error ? error.message : t('skins.equipFailed'));
  const { steamId } = useParams<{ steamId?: string }>();
  // /inventory is your own; /player/:steamId/inventory is anyone's, read only.
  const own = !steamId;
  const enabled = useSkinsEnabled();
  const mine = useMySkins();
  const [theirs, setTheirs] = useState<OwnedSkin[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'rarity' | 'newest'>('rarity');
  // `#skin-<id>` (a new-skin notification, a shared link) opens that skin.
  const { hash } = useLocation();
  const [inspect, setInspect] = useState<number | null>(() => skinFromHash(hash));
  const [seenHash, setSeenHash] = useState(hash);
  if (hash !== seenHash) {
    setSeenHash(hash);
    const id = skinFromHash(hash);
    if (id !== null) setInspect(id);
  }
  const [helpOpen, setHelpOpen] = useState(false);
  // The skin being dragged onto a loadout slot, and the one whose sides are being picked.
  const [dragging, setDragging] = useState<OwnedSkin | null>(null);
  const [picking, setPicking] = useState<OwnedSkin | null>(null);
  // Trade-ups (when the site has them): picking skins of one grade for one of the next.
  const [tradeUpCount, setTradeUpCount] = useState<number | null>(null);
  const [trading, setTrading] = useState(false);
  const [picked, setPicked] = useState<OwnedSkin[]>([]);

  useEffect(() => {
    if (!own) return;
    let cancelled = false;
    api
      .get<{ tradeUp: { count: number } | null }>('/api/skins/status')
      .then((r) => !cancelled && setTradeUpCount(r.tradeUp?.count ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [own]);

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

  const inventory = useMemo(
    () => (own ? mine.inventory : (theirs ?? [])),
    [own, mine.inventory, theirs]
  );
  const loading = enabled === null || (own ? mine.loading : theirs === null);
  const shown = useMemo(() => {
    const list = inventory.filter((s) => filter === 'all' || category(s) === filter);
    return [...list].sort((a, b) =>
      sort === 'newest'
        ? b.createdAt - a.createdAt
        : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
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
      <Container
        maxWidth="lg"
        sx={{ py: { xs: 4, md: 6 }, display: 'flex', flexDirection: 'column', gap: 3.5 }}
      >
        {enabled === false ? (
          <Typography sx={{ color: color.ink2 }}>{t('skins.off')}</Typography>
        ) : loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
            <CircularProgress aria-label={t('skins.inventory')} />
          </Box>
        ) : (
          <>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Box>
                <Typography
                  component="h1"
                  sx={{
                    fontFamily: fontDisplay,
                    fontSize: '2.5rem',
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {t('skins.inventory')}
                </Typography>
                <Typography sx={{ color: color.ink2 }}>
                  {t('skins.count', { count: inventory.length })} ·{' '}
                  <Box
                    component={RouterLink}
                    to={skinPaths.dropRates}
                    data-testid="inventory-drop-rates"
                    sx={{
                      color: color.accent,
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {t('skins.drops.link')}
                  </Box>
                </Typography>
              </Box>
              <VirtualNotice />
            </Box>

            {own && <TryoutLink />}

            <Box
              component="section"
              aria-labelledby="loadout-title"
              sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
            >
              <Typography
                id="loadout-title"
                component="h2"
                sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
              >
                {t('skins.equippedTitle')}
              </Typography>
              {([3, 2] as const).map((team) => {
                const on = equippedFor(inventory, team);
                // This side's slots: knife, gloves, and the weapons it buys that have a skin.
                const sideSlots = slots.filter(
                  (slot) =>
                    inventory.some(
                      (s) => s.slot === slot && (s.side === null || s.side === team)
                    ) ||
                    slot === 'knife' ||
                    slot === 'gloves'
                );
                return (
                  <Box
                    key={team}
                    sx={{ display: 'grid', gap: 1 }}
                    data-testid={`loadout-side-${team === 3 ? 'ct' : 't'}`}
                  >
                    <Typography
                      sx={{
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: team === 3 ? color.sideCt : color.sideT,
                      }}
                    >
                      {team === 3 ? t('skins.side.ct') : t('skins.side.t')}
                    </Typography>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
                        gap: 1.25,
                      }}
                    >
                      {sideSlots.map((slot) => {
                        const skin = on.get(slot) ?? null;
                        const label =
                          slot === 'knife'
                            ? t('skins.slot.knife')
                            : slot === 'gloves'
                              ? t('skins.slot.gloves')
                              : (inventory.find((s) => s.slot === slot)?.weaponName ?? slot);
                        // An equipped slot opens its skin; an empty one shows the skins that fit it.
                        return (
                          <SlotTile
                            key={slot}
                            label={label}
                            skin={skin}
                            onDrop={
                              own &&
                              dragging &&
                              dragging.slot === slot &&
                              (dragging.side === null || dragging.side === team)
                                ? () => {
                                    const dropped = dragging;
                                    setDragging(null);
                                    void mine.equipOn(dropped, team).catch(equipFailed);
                                  }
                                : undefined
                            }
                            onClick={() => {
                              if (skin) {
                                setInspect(skin.id);
                                return;
                              }
                              const owned = inventory.find((s) => s.slot === slot);
                              setFilter(
                                owned
                                  ? category(owned)
                                  : slot === 'knife'
                                    ? 'knives'
                                    : slot === 'gloves'
                                      ? 'gloves'
                                      : 'all'
                              );
                            }}
                          />
                        );
                      })}
                    </Box>
                  </Box>
                );
              })}
            </Box>

            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {(
                  ['all', 'rifles', 'pistols', 'smgs', 'heavy', 'knives', 'gloves'] as Filter[]
                ).map(chip)}
              </Box>
              {own && tradeUpCount !== null && !trading && (
                <Button
                  variant="outlined"
                  onClick={() => {
                    setPicked([]);
                    setTrading(true);
                  }}
                  data-testid="trade-up-start"
                  sx={{ borderRadius: radii.pill }}
                >
                  {t('skins.tradeUp.start')}
                </Button>
              )}
              <Select
                size="small"
                value={sort}
                onChange={(e) => setSort(e.target.value as 'rarity' | 'newest')}
                sx={{ borderRadius: radii.pill, minWidth: 180 }}
                inputProps={{ 'aria-label': t('skins.sortLabel') }}
              >
                <MenuItem value="rarity">{t('skins.sort.rarity')}</MenuItem>
                <MenuItem value="newest">{t('skins.sort.newest')}</MenuItem>
              </Select>
            </Box>

            {trading && tradeUpCount !== null && (
              <TradeUpPanel
                count={tradeUpCount}
                picked={picked}
                onCancel={() => {
                  setTrading(false);
                  setPicked([]);
                }}
                onDone={(skinId) => {
                  setTrading(false);
                  setPicked([]);
                  void mine.reload();
                  setInspect(skinId);
                }}
              />
            )}

            {shown.length === 0 ? (
              <Typography sx={{ color: color.ink2 }}>
                {inventory.length
                  ? t('skins.noneInFilter')
                  : own
                    ? t('skins.emptyOwn')
                    : t('skins.emptyTheirs')}
              </Typography>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 1.75,
                }}
              >
                {shown.map((skin) => (
                  <SkinCard
                    key={skin.id}
                    skin={skin}
                    showNew={own}
                    onEquip={
                      own
                        ? (s) =>
                            // A skin both sides can use asks which side; a one-side weapon toggles.
                            s.side === null
                              ? setPicking(s)
                              : void mine.equip(s, 0).catch(equipFailed)
                        : undefined
                    }
                    onDragSkin={own ? setDragging : undefined}
                    onInspect={(s) => setInspect(s.id)}
                    pick={
                      trading && tradeUpCount !== null
                        ? {
                            picked: picked.some((p) => p.id === skin.id),
                            disabled: !canPick(skin, picked, tradeUpCount),
                            onToggle: (s) => setPicked((list) => togglePick(s, list, tradeUpCount)),
                          }
                        : undefined
                    }
                  />
                ))}
              </Box>
            )}

            <ButtonBase
              onClick={() => setHelpOpen(true)}
              sx={{
                alignSelf: 'flex-start',
                display: 'inline-flex',
                gap: 1.25,
                fontSize: '0.875rem',
                color: color.ink2,
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: `1px solid ${color.rule}`,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <QuestionIcon size={14} />
              </Box>
              {t('skins.howToGet')}
            </ButtonBase>
          </>
        )}
      </Container>

      <InspectSkinDialog skinId={inspect} onClose={() => setInspect(null)} />
      {picking && (
        <SidePicker
          skin={inventory.find((x) => x.id === picking.id) ?? picking}
          onClose={() => setPicking(null)}
          onPick={(team) => {
            const skin = picking;
            setPicking(null);
            void mine.equipOn(skin, team).catch(equipFailed);
          }}
          onTakeOff={() => {
            const skin = inventory.find((x) => x.id === picking.id) ?? picking;
            setPicking(null);
            void (async () => {
              let current = skin;
              for (const team of [...skin.equippedSides]) {
                await mine.equip(current, team);
                current = {
                  ...current,
                  equippedSides: current.equippedSides.filter((x) => x !== team),
                };
              }
            })().catch(equipFailed);
          }}
        />
      )}
      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        PaperProps={{
          sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' },
        }}
      >
        <Box sx={{ p: 3.5, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 440 }}>
          <Typography
            component="h2"
            sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 600 }}
          >
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

/**
 * Which side a skin both sides can use goes on (a click or Enter on its card):
 * CT, T or both, or off again. Dragging it onto a side's slot does the same.
 */
function SidePicker({
  skin,
  onPick,
  onTakeOff,
  onClose,
}: {
  skin: OwnedSkin;
  onPick: (team: LoadoutTeam) => void;
  onTakeOff: () => void;
  onClose: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const on = (team: LoadoutTeam) =>
    skin.equippedSides.includes(team) || skin.equippedSides.includes(0);
  const actions: Array<{ team: LoadoutTeam; label: string; id: string; done: boolean }> = [
    { team: 3, label: t('skins.equipOnCt'), id: 'ct', done: on(3) },
    { team: 2, label: t('skins.equipOnT'), id: 't', done: on(2) },
    { team: 0, label: t('skins.equipOnBoth'), id: 'both', done: skin.equippedSides.includes(0) },
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      aria-labelledby="side-picker-title"
      PaperProps={{
        sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' },
      }}
    >
      <Box
        data-testid="side-picker"
        sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2, width: 'min(360px, 85vw)' }}
      >
        <Typography
          id="side-picker-title"
          component="h2"
          sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
        >
          {skin.weaponName} | {skin.name}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {actions.map((a) => (
            <Button
              key={a.id}
              variant={a.done ? 'outlined' : 'contained'}
              disabled={a.done}
              onClick={() => onPick(a.team)}
              data-testid={`side-picker-${a.id}`}
              sx={{ borderRadius: radii.pill, justifyContent: 'center' }}
            >
              {a.label}
            </Button>
          ))}
          {skin.equipped && (
            <Button
              onClick={onTakeOff}
              data-testid="side-picker-off"
              sx={{ borderRadius: radii.pill, color: color.ink2 }}
            >
              {t('skins.takeOff')}
            </Button>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}

/** The skin id in `#skin-<id>`, or null. */
function skinFromHash(hash: string): number | null {
  const id = /^#skin-(\d+)$/.exec(hash)?.[1];
  return id ? Number(id) : null;
}
