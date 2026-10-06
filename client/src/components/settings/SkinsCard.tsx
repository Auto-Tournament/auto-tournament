import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { LockSimpleIcon, PlayCircleIcon, TrophyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { tokens, rarityColor } from '../../theme/tokens';

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
  const { t } = useTranslation();
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

/**
 * Admin: virtual skins (board 5). One switch for all of it, then the two
 * ways to get a skin: matchmaking (drop chance and rarity odds) and
 * tournaments (a reward per place). The notice players see is fixed.
 */
export function SkinsCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ config: Config }>('/api/skins/admin/config')
      .then((r) => setConfig(r.config))
      .catch(() => setConfig(null));
  }, []);

  if (!config) return null;
  const totalWeight = RARITIES.reduce((sum, r) => sum + (config.rarityWeights[r] ?? 0), 0) || 1;
  const set = (patch: Partial<Config>) => setConfig({ ...config, ...patch });
  const rewardFor = (place: 1 | 2 | 3): Reward => config.rewards.find((r) => r.place === place) ?? { place, mode: 'random', rarity: 'rare' };
  const setReward = (reward: Reward) => set({ rewards: [...config.rewards.filter((r) => r.place !== reward.place), reward].sort((a, b) => a.place - b.place) });

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<{ config: Config }>('/api/skins/admin/config', config);
      setConfig(r.config);
      showSuccess(t('skins.admin.saved'));
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2.5} data-testid="skins-settings">
      <Card sx={{ borderColor: color.accent }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">{t('skins.admin.title')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('skins.admin.mainHint')}
            </Typography>
          </Box>
          <Switch checked={config.enabled} onChange={(e) => set({ enabled: e.target.checked })} inputProps={{ 'aria-label': t('skins.admin.title') }} data-testid="skins-enabled" />
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <PlayCircleIcon size={20} color={color.accent} aria-hidden />
            <Typography variant="h6" sx={{ flex: 1 }}>
              {t('skins.admin.matchmaking')}
            </Typography>
            <Switch checked={config.matchmakingDrops} onChange={(e) => set({ matchmakingDrops: e.target.checked })} inputProps={{ 'aria-label': t('skins.admin.matchmaking') }} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <Typography>{t('skins.admin.dropChance')}</Typography>
            <TextField size="small" type="number" value={config.dropChance} onChange={(e) => set({ dropChance: Number(e.target.value) })} inputProps={{ min: 0, max: 100, 'aria-label': t('skins.admin.dropChance') }} sx={{ width: 110 }} InputProps={{ endAdornment: '%' }} />
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('skins.admin.whichRarity')}
            </Typography>
            <Box sx={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden' }} aria-hidden>
              {RARITIES.map((r) => (
                <Box key={r} sx={{ width: `${((config.rarityWeights[r] ?? 0) / totalWeight) * 100}%`, bgcolor: rarityColor[r] }} />
              ))}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1, mt: 1.5 }}>
              {RARITIES.map((r) => (
                <TextField
                  key={r}
                  size="small"
                  type="number"
                  label={t(`skins.rarity.${r}`)}
                  value={config.rarityWeights[r] ?? 0}
                  onChange={(e) => set({ rarityWeights: { ...config.rarityWeights, [r]: Number(e.target.value) } })}
                  InputProps={{ startAdornment: <Box component="span" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: rarityColor[r], mr: 1, flex: 'none' }} /> }}
                />
              ))}
            </Box>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <TrophyIcon size={20} color={color.medalGold} aria-hidden />
            <Typography variant="h6" sx={{ flex: 1 }}>
              {t('skins.admin.tournaments')}
            </Typography>
            <Switch checked={config.tournamentRewards} onChange={(e) => set({ tournamentRewards: e.target.checked })} inputProps={{ 'aria-label': t('skins.admin.tournaments') }} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {t('skins.admin.tournamentHint')}
          </Typography>
          {([1, 2, 3] as const).map((place) => (
            <RewardRow key={place} reward={rewardFor(place)} onChange={setReward} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ display: 'flex', gap: 1.75 }}>
          <LockSimpleIcon size={20} color={color.muted} aria-hidden />
          <Box>
            <Typography variant="h6">{t('skins.admin.notice')}</Typography>
            <Typography sx={{ color: color.ink2 }}>{t('skins.notice')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('skins.admin.noticeFixed')}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={() => void save()} disabled={saving} data-testid="skins-save">
          {t('skins.save')}
        </Button>
      </Box>
    </Stack>
  );
}
