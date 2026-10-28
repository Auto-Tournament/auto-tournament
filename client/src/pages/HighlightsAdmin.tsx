/**
 * Admin: Highlights (`/manage/highlights`). The Settings tab is what every
 * game's recorders follow (size, frame rate, clips per player, the logo) and
 * the music library under reels (api: services/highlights). Each installed
 * game adds its own tab (`highlightsAdmin` slot; CS2: its recorders, the
 * overlays and how to add a recorder). `?tab=` picks the tab.
 */
import { useEffect, useState } from 'react';
import { Box, CircularProgress, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PageHead, SwitchRow } from '../components/common/ui';
import { HighlightMusicSetting } from '../components/highlights/HighlightMusicSetting';
import { HighlightQualitySetting } from './HighlightQualitySetting';
import {
  MatchmakingHighlightsSetting,
  type MatchmakingHighlightValues,
} from './MatchmakingHighlightsSetting';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useLicenseStatus } from '../hooks/useLicenseStatus';
import { useInstalledIntegrations } from '../integrations/registry';
import { api } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';

/** The reels' sizes (api: services/highlights/settings.ts REEL_LIMITS): field, min, max, default. */
const REEL_LIMITS = [
  ['highlightsFunnyPerPlayer', 0, 4, 2],
  ['highlightsMapReelPerPlayer', 1, 3, 1],
  ['highlightsSeriesReelMax', 2, 40, 16],
  ['highlightsSeriesReelPerPlayer', 1, 6, 2],
  ['highlightsTeamReelPerPlayer', 1, 6, 3],
  ['highlightsTournamentReelMax', 4, 40, 16],
  ['highlightsTournamentReelPerPlayer', 1, 6, 2],
] as const;
type ReelField = (typeof REEL_LIMITS)[number][0];
/** The settings field without its `highlights` prefix: the label's key under highlightsPage.reels. */
const reelKey = (field: ReelField) => field.charAt(10).toLowerCase() + field.slice(11);

export default function HighlightsAdmin() {
  const { t } = useTranslation();
  const modules = useInstalledIntegrations().filter((i) => i.highlightsAdmin);
  // `?tab=` (settings, or a game's id) opens a tab: the site search links straight to one.
  const [search, setSearch] = useSearchParams();
  const tab = search.get('tab') ?? 'settings';
  const setTab = (value: string) => {
    const next = new URLSearchParams(search);
    next.set('tab', value);
    next.delete('sub');
    setSearch(next, { replace: true });
  };

  useEffect(() => {
    document.title = pageTitle(t('highlightsPage.title'));
  }, [t]);

  const moduleTab = modules.find((m) => m.id === tab);
  return (
    <Box data-testid="highlights-admin-page" sx={{ width: '100%', maxWidth: 1100 }}>
      <PageHead title={t('highlightsPage.title')} subtitle={t('highlightsPage.subtitle')} />
      <Tabs
        value={moduleTab || tab === 'settings' ? tab : 'settings'}
        onChange={(_e, v: string) => setTab(v)}
        sx={{ mb: 3 }}
        variant="scrollable"
      >
        <Tab
          value="settings"
          label={t('highlightsPage.tabs.settings')}
          data-testid="highlights-tab-settings"
        />
        {modules.map((m) => (
          <Tab
            key={m.id}
            value={m.id}
            label={t(m.highlightsAdmin!.labelKey, { ns: m.id })}
            data-testid={`highlights-tab-${m.id}`}
          />
        ))}
      </Tabs>
      {moduleTab?.highlightsAdmin ? <moduleTab.highlightsAdmin.Component /> : <HighlightSettings />}
    </Box>
  );
}

interface HighlightValues extends MatchmakingHighlightValues {
  highlightsWatermark: boolean;
  highlightsPerPlayer: number | null;
  highlightsResolution: number;
  highlightsMinResolution: number;
  highlightsKeepMasters: string;
  highlightsFps: number;
  highlightsBitrate: number;
  highlightsMusic: string;
  reels: Record<ReelField, number | null>;
}

function HighlightSettings() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [vals, setVals] = useState<HighlightValues | null>(null);
  // Only a paid licence can take the logo off (api highlightsWatermark).
  const canHideLogo = useLicenseStatus().status?.standing?.paid === true;

  useEffect(() => {
    api
      .get<{ settings?: Record<string, unknown> }>('/api/settings')
      .then((res) => {
        const s = res.settings ?? {};
        const highest = typeof s.highlightsResolution === 'number' ? s.highlightsResolution : 720;
        setVals({
          highlightsWatermark: s.highlightsWatermark !== false,
          highlightsPerPlayer:
            typeof s.highlightsPerPlayer === 'number' ? s.highlightsPerPlayer : 6,
          highlightsResolution: highest,
          // Unset: the highest alone, as before the lowest could be set.
          highlightsMinResolution:
            typeof s.highlightsMinResolution === 'number' ? s.highlightsMinResolution : highest,
          highlightsFps: typeof s.highlightsFps === 'number' ? s.highlightsFps : 240,
          highlightsKeepMasters:
            typeof s.highlightsKeepMasters === 'string' ? s.highlightsKeepMasters : '',
          highlightsBitrate: typeof s.highlightsBitrate === 'number' ? s.highlightsBitrate : 0,
          highlightsMusic: typeof s.highlightsMusic === 'string' ? s.highlightsMusic : '',
          highlightsMatchmaking: s.highlightsMatchmaking !== false,
          highlightsMatchmakingClips:
            typeof s.highlightsMatchmakingClips === 'number' ? s.highlightsMatchmakingClips : 3,
          highlightsMatchmakingMinKills:
            typeof s.highlightsMatchmakingMinKills === 'number'
              ? s.highlightsMatchmakingMinKills
              : 3,
          highlightsMatchmakingClutch: s.highlightsMatchmakingClutch !== false,
          reels: Object.fromEntries(
            REEL_LIMITS.map(([field, , , fallback]) => [
              field,
              typeof s[field] === 'number' ? (s[field] as number) : fallback,
            ])
          ) as Record<ReelField, number>,
        });
      })
      .catch((err: Error) => showError(err.message));
  }, [showError]);

  const save = async (
    patch: Partial<Omit<HighlightValues, 'reels'>> & Partial<Record<ReelField, number>>
  ) => {
    setVals((v) => {
      if (!v) return v;
      const reels = { ...v.reels };
      for (const [field] of REEL_LIMITS) if (field in patch) reels[field] = patch[field] ?? null;
      return { ...v, ...patch, reels };
    });
    try {
      await api.put('/api/settings', patch);
      showSuccess(t('highlightsPage.saved'));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsPage.saveFailed'));
    }
  };

  if (!vals) return <CircularProgress />;
  return (
    <Box
      data-testid="highlights-settings"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 720 }}
    >
      <HighlightQualitySetting vals={vals} save={(patch) => void save(patch)} />
      <TextField
        label={t('highlightsPage.perPlayer.label')}
        type="number"
        value={vals.highlightsPerPlayer ?? ''}
        onChange={(e) => {
          const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
          setVals((cur) =>
            cur ? { ...cur, highlightsPerPlayer: Number.isNaN(v as number) ? null : v } : cur
          );
        }}
        onBlur={() =>
          vals.highlightsPerPlayer && void save({ highlightsPerPlayer: vals.highlightsPerPlayer })
        }
        helperText={t('highlightsPage.perPlayer.helper')}
        inputProps={{ min: 1, max: 20, 'data-testid': 'highlights-per-player' }}
        size="small"
        sx={{ maxWidth: 320 }}
      />
      <Box>
        <SwitchRow
          label={t('highlightsPage.watermark.label')}
          checked={vals.highlightsWatermark || !canHideLogo}
          disabled={!canHideLogo}
          onChange={(e) => void save({ highlightsWatermark: e.target.checked })}
          size="small"
          inputProps={{ 'data-testid': 'highlights-watermark' } as Record<string, string>}
          help={t(canHideLogo ? 'highlightsPage.watermark.description' : 'highlightsPage.watermark.paidOnly')}
        />
      </Box>
      <MatchmakingHighlightsSetting vals={vals} save={(patch) => void save(patch)} />
      <Box data-testid="highlights-reel-sizes">
        <Typography variant="subtitle2">{t('highlightsPage.reels.title')}</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          {t('highlightsPage.reels.description')}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2, minmax(0,1fr))' },
            gap: 2,
          }}
        >
          {REEL_LIMITS.map(([field, min, max]) => (
            <TextField
              key={field}
              label={t(`highlightsPage.reels.${reelKey(field)}`)}
              type="number"
              value={vals.reels[field] ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
                setVals((cur) =>
                  cur
                    ? {
                        ...cur,
                        reels: { ...cur.reels, [field]: Number.isNaN(v as number) ? null : v },
                      }
                    : cur
                );
              }}
              onBlur={() => {
                const v = vals.reels[field];
                if (v !== null && v >= min && v <= max) void save({ [field]: v });
              }}
              helperText={t('highlightsPage.reels.range', { min, max })}
              inputProps={{ min, max, 'data-testid': `highlights-${reelKey(field)}` }}
              size="small"
            />
          ))}
        </Box>
      </Box>
      <HighlightMusicSetting
        value={vals.highlightsMusic}
        onChange={(value) => void save({ highlightsMusic: value })}
      />
    </Box>
  );
}
