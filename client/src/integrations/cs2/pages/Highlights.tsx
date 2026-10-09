/**
 * Admin: Highlights (`/highlights` in the CS2 rail group). Three tabs:
 *
 * - Recorders: every recorder that asked for work, with its GPU, status
 *   (online, paused after too many turned-down clips), its benchmark, how
 *   many clips it kept and how many the frame check turned down, seconds per
 *   clip, and its recent runs with their logs (api: demos/recorders.ts).
 * - Settings: what the recorders make (moved here from CS2 server defaults).
 * - Connect: how to run a recorder against this platform.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { FilmStripIcon } from '@phosphor-icons/react';
import { api, PageHead, pageTitle, useModuleTranslation, useSnackbar } from '../../../module-sdk';
import { HighlightMusicSetting } from '../settings/HighlightMusicSetting';
import { HighlightOverlaySetting } from '../settings/HighlightOverlaySetting';

const HIGHLIGHT_HEIGHTS = [720, 1080, 1440, 2160] as const;
const HIGHLIGHT_FPS = [30, 60, 90, 120, 180, 240] as const;

interface BenchmarkTry {
  gamescopeHz: number;
  seconds: number | null;
  captureFps: number | null;
  repeatPct: number | null;
  ok: boolean;
  error?: string;
}

interface Recorder {
  name: string;
  version: number | null;
  gpu: string | null;
  platform: string | null;
  lastSeen: number | null;
  online: boolean;
  paused: boolean;
  pausedUntil: number | null;
  pauseReason: string | null;
  clipsOk: number;
  clipsRejected: number;
  benchmark: { tries: BenchmarkTry[]; pick: number | null } | null;
  benchmarkAt: number | null;
  benchmarkWanted: boolean;
  gamescopeHz: number | null;
  runs: number;
  avgClipSeconds: number | null;
  lastError: string | null;
}

interface Run {
  id: number;
  kind: string;
  matchSlug: string | null;
  mapNumber: number | null;
  startedAt: number;
  seconds: number | null;
  ok: boolean;
  clips: number;
  rejected: number;
  error: string | null;
}

type TabKey = 'recorders' | 'settings' | 'connect';

const when = (s: number | null) =>
  s ? new Date(s * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const duration = (s: number | null) =>
  s == null ? '—' : s >= 90 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;

export default function Highlights() {
  const { t } = useModuleTranslation('cs2');
  const [tab, setTab] = useState<TabKey>('recorders');

  useEffect(() => {
    document.title = pageTitle(t('highlightsAdmin.title'));
  }, [t]);

  return (
    <Box data-testid="highlights-admin-page" sx={{ width: '100%', maxWidth: 1100 }}>
      <PageHead title={t('highlightsAdmin.title')} subtitle={t('highlightsAdmin.subtitle')} />
      <Tabs value={tab} onChange={(_e, v: TabKey) => setTab(v)} sx={{ mb: 3 }} variant="scrollable">
        <Tab
          value="recorders"
          label={t('highlightsAdmin.tabs.recorders')}
          data-testid="highlights-tab-recorders"
        />
        <Tab
          value="settings"
          label={t('highlightsAdmin.tabs.settings')}
          data-testid="highlights-tab-settings"
        />
        <Tab
          value="connect"
          label={t('highlightsAdmin.tabs.connect')}
          data-testid="highlights-tab-connect"
        />
      </Tabs>
      {tab === 'recorders' && <RecordersTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'connect' && <ConnectTab />}
    </Box>
  );
}

function RecordersTab() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [recorders, setRecorders] = useState<Recorder[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ recorders: Recorder[] }>('/api/game/cs2/recorders');
      setRecorders(res.recorders);
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.loadError'));
      setRecorders([]);
    }
  }, [showError, t]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const act = async (path: string, done: string) => {
    try {
      await api.post(path, {});
      showSuccess(done);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.actionError'));
    }
  };

  if (recorders === null) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (recorders.length === 0) {
    return (
      <Box
        sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}
        data-testid="recorders-empty"
      >
        <FilmStripIcon size={40} />
        <Typography variant="h6" color="text.primary" sx={{ mt: 1 }}>
          {t('highlightsAdmin.empty')}
        </Typography>
        <Typography variant="body2">{t('highlightsAdmin.emptyHelp')}</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      {recorders.map((r) => {
        const total = r.clipsOk + r.clipsRejected;
        const enc = encodeURIComponent(r.name);
        return (
          <Box
            key={r.name}
            data-testid={`recorder-${r.name}`}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                {r.name}
              </Typography>
              {r.paused ? (
                <Chip size="small" color="warning" label={t('highlightsAdmin.paused')} />
              ) : r.online ? (
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label={t('highlightsAdmin.online')}
                />
              ) : (
                <Chip size="small" variant="outlined" label={t('highlightsAdmin.offline')} />
              )}
              {r.version != null && r.version < 7 && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={t('highlightsAdmin.oldVersion', { version: r.version })}
                />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {[
                r.gpu || t('highlightsAdmin.unknownGpu'),
                r.platform,
                t('highlightsAdmin.lastSeen', { time: when(r.lastSeen) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
            {r.paused && r.pauseReason && (
              <Alert severity="warning" sx={{ py: 0 }}>
                {t('highlightsAdmin.pausedUntil', {
                  time: when(r.pausedUntil),
                  reason: r.pauseReason,
                })}
              </Alert>
            )}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 11rem), 1fr))',
                gap: 1.5,
              }}
            >
              <Stat label={t('highlightsAdmin.stat.perClip')} value={duration(r.avgClipSeconds)} />
              <Stat label={t('highlightsAdmin.stat.kept')} value={String(r.clipsOk)} />
              <Stat
                label={t('highlightsAdmin.stat.rejected')}
                value={
                  total
                    ? `${r.clipsRejected} (${Math.round((100 * r.clipsRejected) / total)}%)`
                    : '0'
                }
              />
              <Stat
                label={t('highlightsAdmin.stat.benchmark')}
                value={
                  r.benchmarkWanted
                    ? t('highlightsAdmin.benchmarkPending')
                    : r.gamescopeHz
                      ? t('highlightsAdmin.benchmarkPick', { hz: r.gamescopeHz })
                      : r.benchmarkAt
                        ? t('highlightsAdmin.benchmarkNone')
                        : '—'
                }
              />
            </Box>
            {r.benchmark && r.benchmark.tries.length > 0 && (
              <Box sx={{ overflowX: 'auto' }}>
                <Box
                  component="table"
                  sx={{
                    borderCollapse: 'collapse',
                    fontSize: 13,
                    '& td, & th': { px: 1, py: 0.25, textAlign: 'left', whiteSpace: 'nowrap' },
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <thead>
                    <tr>
                      <th>{t('highlightsAdmin.bench.hz')}</th>
                      <th>{t('highlightsAdmin.bench.time')}</th>
                      <th>{t('highlightsAdmin.bench.fps')}</th>
                      <th>{t('highlightsAdmin.bench.repeats')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.benchmark.tries.map((b) => (
                      <tr key={b.gamescopeHz}>
                        <td>
                          {b.gamescopeHz} Hz{b.gamescopeHz === r.benchmark?.pick ? ' ✓' : ''}
                        </td>
                        <td>{b.ok ? duration(b.seconds) : (b.error ?? '—')}</td>
                        <td>{b.captureFps != null ? Math.round(b.captureFps) : '—'}</td>
                        <td>{b.repeatPct != null ? `${b.repeatPct}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
            )}
            {r.lastError && (
              <Typography variant="caption" color="error" sx={{ overflowWrap: 'anywhere' }}>
                {t('highlightsAdmin.lastError', { error: r.lastError })}
              </Typography>
            )}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" variant="outlined" onClick={() => setOpen(r.name)}>
                {t('highlightsAdmin.runs', { count: r.runs })}
              </Button>
              {r.paused && (
                <Button
                  size="small"
                  onClick={() =>
                    void act(`/api/game/cs2/recorders/${enc}/resume`, t('highlightsAdmin.resumed'))
                  }
                >
                  {t('highlightsAdmin.resume')}
                </Button>
              )}
              <Button
                size="small"
                onClick={() =>
                  void act(
                    `/api/game/cs2/recorders/${enc}/benchmark`,
                    t('highlightsAdmin.benchmarkAsked')
                  )
                }
              >
                {t('highlightsAdmin.rerunBenchmark')}
              </Button>
            </Stack>
          </Box>
        );
      })}
      <RunsDialog key={open ?? ''} name={open} onClose={() => setOpen(null)} />
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body1" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

function RunsDialog({ name, onClose }: { name: string | null; onClose: () => void }) {
  const { t } = useModuleTranslation('cs2');
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [logOf, setLogOf] = useState<{ id: number; text: string } | null>(null);

  // A new name remounts this (key below), so the state starts empty.
  useEffect(() => {
    if (!name) return;
    api
      .get<{ runs: Run[] }>(`/api/game/cs2/recorders/${encodeURIComponent(name)}/runs`)
      .then((res) => setRuns(res.runs))
      .catch(() => setRuns([]));
  }, [name]);

  const showLog = async (id: number) => {
    const res = await fetch(`/api/game/cs2/recorder-runs/${id}/log`, {
      credentials: 'same-origin',
    });
    setLogOf({ id, text: res.ok ? await res.text() : t('highlightsAdmin.logError') });
  };

  return (
    <Dialog open={!!name} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('highlightsAdmin.runsOf', { name: name ?? '' })}</DialogTitle>
      <DialogContent dividers>
        {runs === null ? (
          <CircularProgress size={24} />
        ) : runs.length === 0 ? (
          <Typography color="text.secondary">{t('highlightsAdmin.noRuns')}</Typography>
        ) : (
          <Stack spacing={1}>
            {runs.map((run) => (
              <Box key={run.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    color={run.ok ? 'success' : 'error'}
                    variant="outlined"
                    label={run.ok ? t('highlightsAdmin.ok') : t('highlightsAdmin.failed')}
                  />
                  <Typography variant="body2" fontWeight={600}>
                    {t(`highlightsAdmin.kind.${run.kind}`, { defaultValue: run.kind })}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {[
                      run.matchSlug &&
                        `${run.matchSlug}${run.mapNumber != null ? ` · ${t('highlightsAdmin.map', { n: run.mapNumber + 1 })}` : ''}`,
                      when(run.startedAt),
                      duration(run.seconds),
                      t('highlightsAdmin.clips', { count: run.clips }),
                      run.rejected > 0 && t('highlightsAdmin.turnedDown', { count: run.rejected }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                  <Button size="small" onClick={() => void showLog(run.id)} sx={{ ml: 'auto' }}>
                    {t('highlightsAdmin.log')}
                  </Button>
                </Stack>
                {run.error && (
                  <Typography variant="caption" color="error" sx={{ overflowWrap: 'anywhere' }}>
                    {run.error}
                  </Typography>
                )}
                {logOf?.id === run.id && (
                  <Box
                    component="pre"
                    data-testid="recorder-run-log"
                    sx={{
                      mt: 1,
                      p: 1,
                      maxHeight: 360,
                      overflow: 'auto',
                      fontSize: 12,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {logOf.text || t('highlightsAdmin.emptyLog')}
                  </Box>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('highlightsAdmin.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

interface HighlightValues {
  highlightsWatermark: boolean;
  highlightsPerPlayer: number | null;
  highlightsResolution: number;
  highlightsFps: number;
  highlightsMusic: string;
  highlightsKeepClean: boolean;
}

function SettingsTab() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [vals, setVals] = useState<HighlightValues | null>(null);

  useEffect(() => {
    api
      .get<{ settings?: Record<string, unknown> }>('/api/settings')
      .then((res) => {
        const s = res.settings ?? {};
        setVals({
          highlightsWatermark: s.highlightsWatermark !== false,
          highlightsPerPlayer:
            typeof s.highlightsPerPlayer === 'number' ? s.highlightsPerPlayer : 6,
          highlightsResolution:
            typeof s.highlightsResolution === 'number' ? s.highlightsResolution : 1080,
          highlightsFps: typeof s.highlightsFps === 'number' ? s.highlightsFps : 60,
          highlightsMusic: typeof s.highlightsMusic === 'string' ? s.highlightsMusic : '',
          highlightsKeepClean: s.highlightsKeepClean !== false,
        });
      })
      .catch((err: Error) => showError(err.message));
  }, [showError]);

  const save = async (patch: Partial<HighlightValues>) => {
    setVals((v) => (v ? { ...v, ...patch } : v));
    try {
      await api.put('/api/settings', patch);
      showSuccess(t('settings.saved'));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('settings.saveFailed'));
    }
  };

  if (!vals) return <CircularProgress />;
  return (
    <Box
      data-testid="cs2-settings-highlights"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 720 }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ maxWidth: 480 }}>
        <TextField
          select
          label={t('settings.highlights.resolution.label')}
          value={vals.highlightsResolution}
          onChange={(e) => void save({ highlightsResolution: Number(e.target.value) })}
          size="small"
          fullWidth
          inputProps={{ 'data-testid': 'cs2-highlights-resolution' }}
        >
          {HIGHLIGHT_HEIGHTS.map((h) => (
            <MenuItem key={h} value={h}>
              {h === 2160 ? '4K (2160p)' : `${h}p`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('settings.highlights.fps.label')}
          value={vals.highlightsFps}
          onChange={(e) => void save({ highlightsFps: Number(e.target.value) })}
          size="small"
          fullWidth
          inputProps={{ 'data-testid': 'cs2-highlights-fps' }}
        >
          {HIGHLIGHT_FPS.map((f) => (
            <MenuItem key={f} value={f}>
              {t('settings.highlights.fps.option', { fps: f })}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {t('settings.highlights.quality.helper')}
      </Typography>
      <TextField
        label={t('settings.highlights.perPlayer.label')}
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
        helperText={t('settings.highlights.perPlayer.helper')}
        inputProps={{ min: 1, max: 6, 'data-testid': 'cs2-highlights-per-player' }}
        size="small"
        sx={{ maxWidth: 320 }}
      />
      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={vals.highlightsWatermark}
              onChange={(e) => void save({ highlightsWatermark: e.target.checked })}
              size="small"
              inputProps={{ 'data-testid': 'cs2-highlights-watermark' } as Record<string, string>}
            />
          }
          label={t('settings.highlights.watermark.label')}
        />
        <Typography variant="caption" color="text.secondary" display="block">
          {t('settings.highlights.watermark.description')}
        </Typography>
      </Box>
      <HighlightMusicSetting
        value={vals.highlightsMusic}
        onChange={(value) => void save({ highlightsMusic: value })}
      />
      <HighlightOverlaySetting
        keepClean={vals.highlightsKeepClean}
        onKeepClean={(value) => void save({ highlightsKeepClean: value })}
      />
    </Box>
  );
}

function ConnectTab() {
  const { t } = useModuleTranslation('cs2');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const env = [
    `AT_URL=${origin}`,
    "AT_WORKER_TOKEN=<one of API_TOKENS in the platform's .env>",
    'AT_WORKER_NAME=<a name for this PC, e.g. lan-seat-12>',
    'AT_CS2_GAME=<path to …/Counter-Strike Global Offensive/game>',
  ].join('\n');
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 820 }}
      data-testid="recorder-connect"
    >
      <Typography variant="body1">{t('highlightsAdmin.connect.intro')}</Typography>
      <Box
        component="ol"
        sx={{ pl: 2.5, m: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <li>{t('highlightsAdmin.connect.step1')}</li>
        <li>{t('highlightsAdmin.connect.step2')}</li>
        <li>
          {t('highlightsAdmin.connect.step3')}
          <Box
            component="pre"
            sx={{
              mt: 1,
              p: 1.5,
              bgcolor: 'action.hover',
              borderRadius: 1,
              overflowX: 'auto',
              fontSize: 13,
            }}
          >
            {env}
          </Box>
        </li>
        <li>{t('highlightsAdmin.connect.step4')}</li>
      </Box>
      <Alert severity="info">{t('highlightsAdmin.connect.gaming')}</Alert>
    </Box>
  );
}
