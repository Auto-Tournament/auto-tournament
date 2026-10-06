import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputBase,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { LockSimpleIcon } from '@phosphor-icons/react';
import { api, useSnackbar, useModuleTranslation, tokens, radii, fontDisplay, mono, withAlpha, PageHead, pageTitle } from '../../../module-sdk';
import { rarityColor } from './rarity';
import { SkinsInventoryAdmin } from './SkinsInventoryAdmin';

const { color } = tokens;
const RARITIES = ['common', 'uncommon', 'rare', 'mythical', 'legendary', 'ancient', 'immortal'] as const;
type Rarity = (typeof RARITIES)[number];

interface Reward {
  place: 1 | 2 | 3;
  mode: 'random' | 'skin';
  rarity?: Rarity;
  weapon?: string;
  name?: string;
  floatMin?: number;
  floatMax?: number;
  seeds?: number[];
}

interface Config {
  enabled: boolean;
  matchmakingDrops: boolean;
  dropChance: number;
  playDropChance: number;
  rarityWeights: Record<Rarity, number>;
  tournamentRewards: boolean;
  rewards: Reward[];
}

interface CatalogSkin {
  weapon: string;
  weaponName: string;
  name: string;
  rarity: Rarity;
  image: string;
}

const PLACE_COLOR = [color.medalGold, color.medalSilver, color.medalBronze];

/** One placement's reward: random by rarity, or a picked skin with its float range and seeds. */
function RewardRow({ reward, onChange }: { reward: Reward; onChange: (r: Reward) => void }) {
  const { t } = useModuleTranslation('cs2');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<CatalogSkin[]>([]);
  const [seedInput, setSeedInput] = useState('');

  useEffect(() => {
    if (reward.mode !== 'skin') return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      api
        .get<{ skins: CatalogSkin[] }>(`/api/skins/admin/catalog?q=${encodeURIComponent(query)}`)
        .then((r) => !cancelled && setOptions(r.skins ?? []))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query, reward.mode]);

  const picked = reward.weapon && reward.name ? options.find((o) => o.weapon === reward.weapon && o.name === reward.name) : undefined;

  return (
    <Stack spacing={1.5} data-testid={`skins-reward-${reward.place}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ width: 36, fontWeight: 700, color: PLACE_COLOR[reward.place - 1] }}>{t(`skins.admin.place${reward.place}`)}</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={reward.mode}
          onChange={(_, mode) => mode && onChange({ ...reward, mode })}
        >
          <ToggleButton value="random">{t('skins.admin.random')}</ToggleButton>
          <ToggleButton value="skin">{t('skins.admin.pickSkin')}</ToggleButton>
        </ToggleButtonGroup>
        {reward.mode === 'random' ? (
          <Select size="small" value={reward.rarity ?? 'rare'} onChange={(e) => onChange({ ...reward, rarity: e.target.value as Rarity })} sx={{ minWidth: 180 }}>
            {RARITIES.map((r) => (
              <MenuItem key={r} value={r}>
                <Box component="span" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: rarityColor[r], display: 'inline-block', mr: 1 }} />
                {t('skins.admin.anyRarity', { rarity: t(`skins.rarity.${r}`) })}
              </MenuItem>
            ))}
          </Select>
        ) : (
          <Autocomplete
            size="small"
            sx={{ minWidth: 280, flex: 1 }}
            options={options}
            value={picked ?? (reward.weapon && reward.name ? ({ weapon: reward.weapon, name: reward.name, weaponName: reward.weapon, rarity: 'rare', image: '' } as CatalogSkin) : null)}
            getOptionLabel={(o) => `${o.weaponName} · ${o.name}`}
            isOptionEqualToValue={(a, b) => a.weapon === b.weapon && a.name === b.name}
            onInputChange={(_, value) => setQuery(value)}
            onChange={(_, value) => onChange({ ...reward, weapon: value?.weapon, name: value?.name })}
            renderInput={(params) => <TextField {...params} label={t('skins.admin.skin')} />}
          />
        )}
      </Box>
      {reward.mode === 'skin' && (
        <Box sx={{ ml: { md: 6 }, p: 2, borderRadius: '14px', bgcolor: color.paper3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('skins.admin.variantsNote')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ minWidth: 80 }}>
              {t('skins.float')}
            </Typography>
            <TextField size="small" type="number" label={t('skins.admin.lowest')} value={reward.floatMin ?? 0} onChange={(e) => onChange({ ...reward, floatMin: Number(e.target.value) })} inputProps={{ min: 0, max: 1, step: 0.01 }} sx={{ width: 120 }} />
            <TextField size="small" type="number" label={t('skins.admin.highest')} value={reward.floatMax ?? 1} onChange={(e) => onChange({ ...reward, floatMax: Number(e.target.value) })} inputProps={{ min: 0, max: 1, step: 0.01 }} sx={{ width: 120 }} />
          </Box>
          <Box>
            <Typography variant="body2">{t('skins.pattern')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('skins.admin.seedsHint')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center', mt: 1, p: 1, borderRadius: '12px', border: `1px solid ${color.rule}`, bgcolor: color.paper2 }}>
              {(reward.seeds ?? []).map((seed) => (
                <Chip key={seed} size="small" label={seed} onDelete={() => onChange({ ...reward, seeds: (reward.seeds ?? []).filter((s) => s !== seed) })} />
              ))}
              <Box
                component="input"
                value={seedInput}
                placeholder={t('skins.admin.addSeed')}
                aria-label={t('skins.admin.addSeed')}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSeedInput(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key !== 'Enter' && e.key !== ',') return;
                  e.preventDefault();
                  const seed = Number(seedInput);
                  if (seedInput && seed <= 1000 && !(reward.seeds ?? []).includes(seed)) {
                    onChange({ ...reward, seeds: [...(reward.seeds ?? []), seed] });
                  }
                  setSeedInput('');
                }}
                sx={{ flex: 1, minWidth: 120, border: 'none', outline: 'none', bgcolor: 'transparent', color: color.ink, font: 'inherit', p: 0.75 }}
              />
            </Box>
          </Box>
        </Box>
      )}
    </Stack>
  );
}

interface Stats {
  given: number;
  givenThisWeek: number;
  playersWithSkins: number;
  players: number;
  rarest: { weaponName: string; name: string; rarity: Rarity; imageUrl: string; owner: string | null } | null;
}

/** Weights as whole percentages summing to 100 (largest remainder), in rarity order. */
function toPercents(weights: Record<Rarity, number>): number[] {
  const raw = RARITIES.map((r) => Math.max(0, weights[r] ?? 0));
  const total = raw.reduce((a, b) => a + b, 0);
  if (total === 0) return RARITIES.map((_, i) => (i === 0 ? 100 : 0));
  const exact = raw.map((w) => (w / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

const fromPercents = (shares: number[]) => Object.fromEntries(RARITIES.map((r, i) => [r, shares[i]])) as Record<Rarity, number>;

/**
 * Which rarity drops, as one bar: each rarity's share is its width, and the
 * edge between two rarities drags (or moves with the arrow keys) to trade
 * share between them. Stored as percentages.
 */
function RarityBar({ weights, onChange }: { weights: Record<Rarity, number>; onChange: (w: Record<Rarity, number>) => void }) {
  const { t } = useModuleTranslation('cs2');
  const ref = useRef<HTMLDivElement>(null);
  const shares = toPercents(weights);
  const starts = shares.map((_, i) => shares.slice(0, i).reduce((a, b) => a + b, 0));

  /** Moves the edge after rarity `i` to `pos` (0–100), between its two neighbours' outer edges. */
  const moveEdge = (i: number, pos: number) => {
    const base = starts[i];
    const pair = shares[i] + shares[i + 1];
    const left = Math.round(Math.min(base + pair, Math.max(base, pos)) - base);
    const next = [...shares];
    next[i] = left;
    next[i + 1] = pair - left;
    onChange(fromPercents(next));
  };

  const drag = (i: number) => (event: ReactPointerEvent<HTMLElement>) => {
    const bar = ref.current;
    if (!bar) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).focus();
    const rect = bar.getBoundingClientRect();
    const at = (x: number) => ((x - rect.left) / rect.width) * 100;
    const onMove = (e: { clientX: number }) => moveEdge(i, at(e.clientX));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <Box>
      <Box ref={ref} sx={{ position: 'relative', height: 26, display: 'flex', alignItems: 'center' }} data-testid="skins-rarity-bar">
        <Box sx={{ display: 'flex', width: '100%', height: 18, borderRadius: radii.pill, overflow: 'hidden' }} aria-hidden>
          {RARITIES.map((r, i) => (
            <Box key={r} title={`${t(`skins.rarity.${r}`)} ${shares[i]}%`} sx={{ width: `${shares[i]}%`, bgcolor: rarityColor[r], transition: 'width 60ms linear' }} />
          ))}
        </Box>
        {RARITIES.slice(0, -1).map((r, i) => (
          <Box
            key={r}
            role="slider"
            tabIndex={0}
            aria-label={t('skins.admin.edge', { a: t(`skins.rarity.${r}`), b: t(`skins.rarity.${RARITIES[i + 1]}`) })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={starts[i + 1]}
            aria-valuetext={`${t(`skins.rarity.${r}`)} ${shares[i]}%, ${t(`skins.rarity.${RARITIES[i + 1]}`)} ${shares[i + 1]}%`}
            onPointerDown={drag(i)}
            onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
              const step = e.shiftKey ? 5 : 1;
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') moveEdge(i, starts[i + 1] - step);
              else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') moveEdge(i, starts[i + 1] + step);
              else return;
              e.preventDefault();
            }}
            sx={{
              position: 'absolute',
              left: `${starts[i + 1]}%`,
              top: 0,
              width: 14,
              height: 26,
              transform: 'translateX(-50%)',
              cursor: 'ew-resize',
              touchAction: 'none',
              display: 'grid',
              placeItems: 'center',
              outline: 'none',
              '&::after': { content: '""', width: 3, height: 26, borderRadius: 2, bgcolor: color.paper, opacity: 0.85 },
              '&:hover::after, &:focus-visible::after': { bgcolor: color.ink, opacity: 1 },
              '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 1, borderRadius: '4px' },
            }}
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', mt: 1.25 }}>
        {RARITIES.map((r, i) => (
          <Box key={r} component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '0.8125rem', color: color.ink2 }}>
            <Box component="span" sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: rarityColor[r] }} />
            {t(`skins.rarity.${r}`)}
            <Box component="span" sx={{ fontFamily: mono, color: color.muted }}>
              {shares[i]}%
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** A big percentage that types in place (drop chance on a win, or on a loss). */
function ChanceTile({ label, value, tone, onChange, testId }: { label: string; value: number; tone: string; onChange: (n: number) => void; testId?: string }) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Box sx={{ borderRadius: '16px', bgcolor: withAlpha(tone, 0.14), p: 2, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography sx={{ fontSize: '0.8125rem', color: tone }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline' }}>
        <InputBase
          type="number"
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
          inputProps={{ min: 0, max: 100, 'aria-label': label, 'data-testid': testId }}
          sx={{
            fontFamily: fontDisplay,
            fontSize: '1.875rem',
            fontWeight: 700,
            width: `${String(value).length}ch`,
            '& input': { p: 0, textAlign: 'right', MozAppearance: 'textfield' },
            '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', m: 0 },
          }}
        />
        <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.875rem', fontWeight: 700 }}>%</Typography>
      </Box>
      <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>{t('skins.admin.chance')}</Typography>
    </Box>
  );
}

/** A card on the Skins page: a title with its own switch. */
function SkinsCard({ id, title, checked, onToggle, children }: { id: string; title: string; checked: boolean; onToggle: (on: boolean) => void; children: ReactNode }) {
  return (
    <Box
      component="section"
      aria-labelledby={id}
      sx={{ bgcolor: color.paper2, border: `1px solid ${color.rule}`, borderRadius: radii.lg, p: { xs: 2, md: 3 }, display: 'flex', flexDirection: 'column', gap: 2.25, minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Typography id={id} component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.1875rem', fontWeight: 600 }}>
          {title}
        </Typography>
        <Switch checked={checked} onChange={(e) => onToggle(e.target.checked)} slotProps={{ input: { 'aria-label': title } as InputHTMLAttributes<HTMLInputElement> }} />
      </Box>
      <Box sx={{ opacity: checked ? 1 : 0.5, transition: 'opacity 150ms', display: 'flex', flexDirection: 'column', gap: 2.25 }}>{children}</Box>
    </Box>
  );
}

function Stat({ label, value, sub, tone, small }: { label: string; value: ReactNode; sub: ReactNode; tone?: string; small?: boolean }) {
  return (
    <Box sx={{ bgcolor: color.paper2, border: `1px solid ${color.rule}`, borderRadius: radii.lg, p: 2.75, display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{label}</Typography>
      <Typography sx={{ fontFamily: fontDisplay, fontSize: small ? '1.375rem' : '2rem', fontWeight: 700, color: tone ?? color.ink, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
      <Typography noWrap sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
        {sub}
      </Typography>
    </Box>
  );
}

const PODIUM = [
  { place: 1 as const, height: 150, tone: color.medalGold },
  { place: 2 as const, height: 118, tone: color.medalSilver },
  { place: 3 as const, height: 92, tone: color.medalBronze },
];

/**
 * Admin: virtual skins, one page (board 7). The switch for all of it in the
 * head, the numbers, then the two ways to get a skin (matchmaking drops and
 * tournament rewards) and every player's skins. A change shows at once and
 * saves itself a moment later.
 */
export function SkinsAdminPage() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsVersion, setStatsVersion] = useState(0);
  const [editing, setEditing] = useState<1 | 2 | 3 | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    document.title = pageTitle(t('skins.admin.title'));
  }, [t]);

  useEffect(() => {
    api
      .get<{ config: Config }>('/api/skins/admin/config')
      .then((r) => setConfig(r.config))
      .catch((err) => showError(err instanceof Error ? err.message : String(err)));
  }, [showError]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Stats>('/api/skins/admin/stats')
      .then((r) => !cancelled && setStats(r))
      .catch(() => !cancelled && setStats(null));
    return () => {
      cancelled = true;
    };
  }, [statsVersion]);

  // Saved shortly after the last change; the page already shows it.
  useEffect(() => {
    if (!config || !dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      api
        .put('/api/skins/admin/config', config)
        .then(() => showSuccess(t('skins.admin.saved')))
        .catch((err) => showError(err instanceof Error ? err.message : String(err)));
    }, 700);
    return () => clearTimeout(timer);
  }, [config, showError, showSuccess, t]);

  if (!config) return <PageHead title={t('skins.admin.title')} />;

  const set = (patch: Partial<Config>) => {
    dirty.current = true;
    setConfig((c) => (c ? { ...c, ...patch } : c));
  };
  const rewardFor = (place: 1 | 2 | 3): Reward => config.rewards.find((r) => r.place === place) ?? { place, mode: 'random', rarity: 'rare' };
  const setReward = (reward: Reward) =>
    set({ rewards: [...config.rewards.filter((r) => r.place !== reward.place), reward].sort((a, b) => a.place - b.place) });
  const rewardLabel = (reward: Reward) =>
    reward.mode === 'skin'
      ? { text: reward.name ? reward.name : t('skins.admin.pickSkin'), tone: color.ink }
      : { text: t('skins.admin.anyRarity', { rarity: t(`skins.rarity.${reward.rarity ?? 'rare'}`) }), tone: rarityColor[reward.rarity ?? 'rare'] };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="skins-settings">
      <PageHead
        title={t('skins.admin.title')}
        subtitle={config.enabled ? t('skins.admin.pageHint') : t('skins.admin.mainHint')}
        sx={{ mb: 0 }}
        actions={
          <Box
            component="label"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              pl: 2,
              pr: 0.75,
              py: 0.5,
              borderRadius: radii.pill,
              border: `1px solid ${config.enabled ? color.pick : color.rule}`,
              bgcolor: config.enabled ? withAlpha(color.pick, 0.14) : color.paper2,
              color: config.enabled ? color.pick : color.muted,
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            {config.enabled ? t('skins.admin.on') : t('skins.admin.off')}
            <Switch
              checked={config.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
              slotProps={{ input: { 'aria-label': t('skins.admin.title'), 'data-testid': 'skins-enabled' } as InputHTMLAttributes<HTMLInputElement> }}
            />
          </Box>
        }
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.75 }} data-testid="skins-stats">
        <Stat label={t('skins.admin.stats.given')} value={stats?.given ?? '…'} sub={t('skins.admin.stats.thisWeek', { count: stats?.givenThisWeek ?? 0 })} />
        <Stat label={t('skins.admin.stats.owners')} value={stats?.playersWithSkins ?? '…'} sub={t('skins.admin.stats.ofPlayers', { count: stats?.players ?? 0 })} />
        <Stat
          small
          label={t('skins.admin.stats.rarest')}
          value={stats?.rarest ? `${stats.rarest.weaponName} | ${stats.rarest.name}` : t('skins.admin.stats.noneYet')}
          tone={stats?.rarest ? rarityColor[stats.rarest.rarity] : color.muted}
          sub={stats?.rarest?.owner ?? ''}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.15fr) minmax(0, 1fr)' }, gap: 1.75, opacity: config.enabled ? 1 : 0.55, transition: 'opacity 150ms' }}>
        <SkinsCard id="skins-drops" title={t('skins.admin.matchmaking')} checked={config.matchmakingDrops} onToggle={(on) => set({ matchmakingDrops: on })}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
            <ChanceTile label={t('skins.admin.win')} value={config.dropChance} tone={color.pick} onChange={(n) => set({ dropChance: n })} testId="skins-drop-chance" />
            <ChanceTile label={t('skins.admin.lose')} value={config.playDropChance} tone={color.muted} onChange={(n) => set({ playDropChance: n })} testId="skins-play-drop-chance" />
          </Box>
          <Box>
            <Typography sx={{ fontSize: '0.8125rem', color: color.muted, mb: 1 }}>{t('skins.admin.whatDrops')}</Typography>
            <RarityBar weights={config.rarityWeights} onChange={(w) => set({ rarityWeights: w })} />
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{t('skins.admin.knivesByPrice')}</Typography>
        </SkinsCard>

        <SkinsCard id="skins-rewards" title={t('skins.admin.tournaments')} checked={config.tournamentRewards} onToggle={(on) => set({ tournamentRewards: on })}>
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-end', minHeight: 200 }}>
            {PODIUM.map(({ place, height, tone }) => {
              const label = rewardLabel(rewardFor(place));
              return (
                <ButtonBase
                  key={place}
                  onClick={() => setEditing(place)}
                  data-testid={`skins-podium-${place}`}
                  aria-label={`${t(`skins.admin.place${place}`)}: ${label.text}`}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    gap: 1,
                    borderRadius: '14px',
                    '&:hover .step, &:focus-visible .step': { filter: 'brightness(1.25)' },
                    '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                  }}
                >
                  <Typography sx={{ fontSize: '0.8125rem', color: label.tone, textAlign: 'center', width: '100%', overflowWrap: 'anywhere' }}>{label.text}</Typography>
                  <Box
                    className="step"
                    sx={{
                      width: '100%',
                      height,
                      borderRadius: '14px 14px 6px 6px',
                      bgcolor: withAlpha(tone, 0.16),
                      borderTop: `3px solid ${tone}`,
                      display: 'grid',
                      placeItems: 'center',
                      fontFamily: fontDisplay,
                      fontWeight: 700,
                      fontSize: '1.25rem',
                      color: tone,
                      transition: 'filter 120ms',
                    }}
                  >
                    {t(`skins.admin.place${place}`)}
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>
          <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{t('skins.admin.podiumHint')}</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{t('skins.admin.tournamentHint')}</Typography>
        </SkinsCard>
      </Box>

      <SkinsInventoryAdmin onChanged={() => setStatsVersion((v) => v + 1)} />

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', color: color.muted }}>
        <LockSimpleIcon size={14} aria-hidden style={{ marginTop: 2, flex: 'none' }} />
        <Typography sx={{ fontSize: '0.75rem' }}>{t('skins.notice')}</Typography>
      </Box>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' } }}
        data-testid="skins-reward-dialog"
      >
        {editing !== null && (
          <>
            <DialogTitle sx={{ fontFamily: fontDisplay }}>{t('skins.admin.rewardTitle', { place: t(`skins.admin.place${editing}`) })}</DialogTitle>
            <DialogContent>
              <RewardRow reward={rewardFor(editing)} onChange={setReward} />
            </DialogContent>
            <DialogActions>
              <Button variant="contained" onClick={() => setEditing(null)} sx={{ borderRadius: radii.pill }}>
                {t('skins.admin.done')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
