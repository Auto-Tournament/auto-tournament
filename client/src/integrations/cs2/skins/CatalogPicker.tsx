import { useEffect, useState } from 'react';
import { Box, CircularProgress, Slider, TextField, Typography } from '@mui/material';
import { api, useModuleTranslation, useSnackbar, tokens, radii } from '../../../module-sdk';
import { SkinCard } from './SkinParts';
import { SidePicker } from './InventoryPage';
import { wearKey, type CatalogSkin, type OwnedSkin, type PickInput } from './useSkins';

const { color } = tokens;

const DEFAULT_FLOAT = 0.01;
const DEFAULT_SEED = 0;

const label = (skin: Pick<CatalogSkin, 'name' | 'variant'>) =>
  skin.variant ? `${skin.name} (${skin.variant})` : skin.name;

/** A catalogue skin as a card: the pick for it, when the player has one, decides its sides. */
function asCard(skin: CatalogSkin, pick: OwnedSkin | null): OwnedSkin {
  return {
    id: pick?.id ?? 0,
    weapon: skin.weapon,
    weaponName: skin.weaponName,
    name: label(skin),
    rarity: skin.rarity,
    imageUrl: skin.imageUrl,
    slot: skin.slot,
    float: pick?.float ?? DEFAULT_FLOAT,
    pattern: pick?.pattern ?? DEFAULT_SEED,
    source: 'catalog',
    sourceLabel: null,
    sourceRef: null,
    place: null,
    createdAt: 0,
    seen: true,
    equipped: Boolean(pick),
    equippedSides: pick?.equippedSides ?? [],
    side: skin.side,
    stattrak: null,
  };
}

/**
 * Every catalogue skin as a grid (search, a category, or one loadout slot when
 * an empty slot was clicked); a click opens the float and seed to equip it
 * with, and the side for a weapon both sides buy.
 */
export function CatalogPicker({
  slot,
  category,
  picks,
  onPick,
}: {
  slot: string | null;
  category: string;
  picks: OwnedSkin[];
  onPick: (input: PickInput) => Promise<void>;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [loaded, setLoaded] = useState<{ key: string; skins: CatalogSkin[] } | null>(null);
  const [chosen, setChosen] = useState<CatalogSkin | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const key = `${q}\n${slot ?? ''}\n${category}`;
  const skins = loaded?.key === key ? loaded.skins : null;

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (slot) query.set('slot', slot);
    if (category !== 'all') query.set('category', category);
    api
      .get<{ skins: CatalogSkin[] }>(`/api/skins/catalog/search?${query}`)
      .then((r) => !cancelled && setLoaded({ key, skins: r.skins ?? [] }))
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded({ key, skins: [] });
        showError(error instanceof Error ? error.message : t('skins.catalog.loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [q, slot, category, key, showError, t]);

  const current = (skin: CatalogSkin) =>
    picks.find((p) => p.weapon === skin.weapon && p.name === label(skin)) ?? null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="catalog-picker">
      <TextField
        type="search"
        size="small"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('skins.catalog.search')}
        inputProps={{ 'aria-label': t('skins.catalog.search') }}
        sx={{ maxWidth: 420, '& .MuiOutlinedInput-root': { borderRadius: radii.pill } }}
      />
      {skins === null && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label={t('skins.catalog.search')} />
        </Box>
      )}
      {skins?.length === 0 && (
        <Typography sx={{ color: color.ink2 }}>{t('skins.catalog.none')}</Typography>
      )}
      {skins && skins.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 1.75,
          }}
        >
          {skins.map((skin) => (
            <Box
              key={`${skin.weapon}:${skin.paintKit}`}
              data-testid="catalog-tile"
              sx={{ display: 'block' }}
            >
              <SkinCard
                skin={asCard(skin, current(skin))}
                onEquip={() => setChosen(skin)}
                onInspect={() => setChosen(skin)}
              />
            </Box>
          ))}
        </Box>
      )}
      {chosen && (
        <PickDialog
          key={`${chosen.weapon}:${chosen.paintKit}`}
          skin={chosen}
          start={current(chosen)}
          onClose={() => setChosen(null)}
          onPick={async (input) => {
            try {
              await onPick(input);
              setChosen(null);
            } catch (error) {
              showError(error instanceof Error ? error.message : t('skins.equipFailed'));
            }
          }}
        />
      )}
    </Box>
  );
}

/** Float and seed for a catalogue skin, then the side (or one button for a one-side weapon). */
function PickDialog({
  skin,
  start,
  onClose,
  onPick,
}: {
  skin: CatalogSkin;
  start: OwnedSkin | null;
  onClose: () => void;
  onPick: (input: PickInput) => Promise<void>;
}) {
  const { t } = useModuleTranslation('cs2');
  const [float, setFloat] = useState(String(start?.float ?? DEFAULT_FLOAT));
  const [seed, setSeed] = useState(String(start?.pattern ?? DEFAULT_SEED));
  const [busy, setBusy] = useState(false);

  const floatValue = float.trim() === '' ? NaN : Number(float);
  const seedValue = seed.trim() === '' ? NaN : Number(seed);
  const floatOk = floatValue >= 0 && floatValue <= 1;
  const seedOk = Number.isInteger(seedValue) && seedValue >= 0 && seedValue <= 1000;

  return (
    <SidePicker
      testId="catalog-pick-dialog"
      skin={{
        weaponName: skin.weaponName,
        name: label(skin),
        equippedSides: [],
        equipped: false,
      }}
      oneSide={skin.side !== null}
      again
      disabled={!floatOk || !seedOk || busy}
      onClose={onClose}
      onPick={(team) => {
        setBusy(true);
        void onPick({
          weapon: skin.weapon,
          paintKit: skin.paintKit,
          float: floatValue,
          seed: seedValue,
          team,
        }).finally(() => setBusy(false));
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600 }}>{t('skins.float')}</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
            {floatOk ? t(`skins.wear.${wearKey(floatValue)}`) : ''}
          </Typography>
        </Box>
        <Slider
          min={0}
          max={1}
          step={0.0001}
          value={floatOk ? floatValue : 0}
          onChange={(_, v) => setFloat(String(Math.round((v as number) * 10000) / 10000))}
          aria-label={t('skins.catalog.wear')}
        />
        <TextField
          size="small"
          type="number"
          value={float}
          onChange={(e) => setFloat(e.target.value)}
          error={!floatOk}
          helperText={floatOk ? undefined : t('skins.catalog.floatRange')}
          label={t('skins.float')}
          inputProps={{ min: 0, max: 1, step: 0.0001, 'data-testid': 'catalog-float' }}
        />
      </Box>
      <TextField
        size="small"
        type="number"
        value={seed}
        onChange={(e) => setSeed(e.target.value)}
        error={!seedOk}
        helperText={seedOk ? undefined : t('skins.catalog.patternRange')}
        label={t('skins.pattern')}
        inputProps={{ min: 0, max: 1000, step: 1, 'data-testid': 'catalog-seed' }}
      />
    </SidePicker>
  );
}
