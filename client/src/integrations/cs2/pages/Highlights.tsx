/**
 * CS2's part of the Highlights page. Four tabs:
 *
 * - Recorders: every recorder that asked for work, with its GPU, status
 *   (online, recording, paused after too many turned-down clips), its
 *   benchmark, how many clips it kept and how many the frame check turned
 *   down, seconds per clip, and its recent runs with their logs (api:
 *   demos/recorders.ts). An offline one can be forgotten.
 * - Clips: recent matches' clips and reels, what each was made at, and a Redo
 *   for each, or for every one made at other settings (api: demos/clipsAdmin.ts).
 * - Overlays: clean copies of the clips, and redrawing their overlays.
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
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { FilmStripIcon } from '@phosphor-icons/react';
import { api, useModuleTranslation, useSnackbar } from '../../../module-sdk';
import { HighlightOverlaySetting } from '../settings/HighlightOverlaySetting';

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
  working: { clips: number; matchSlug: string | null; mapNumber: number; since: number } | null;
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

type TabKey = 'recorders' | 'clips' | 'overlays' | 'connect';

const when = (s: number | null) =>
  s ? new Date(s * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const duration = (s: number | null) =>
  s == null ? '—' : s >= 90 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;

/**
 * CS2's tab on core's Highlights page (`highlightsAdmin`): its recorders, the
 * overlays on its clips, and how to add a recorder. What every game's
 * recorders follow (size, frame rate, music) is core's Settings tab.
 */
export default function Cs2HighlightsAdmin() {
  const { t } = useModuleTranslation('cs2');
  const [tab, setTab] = useState<TabKey>('recorders');

  return (
    <Box data-testid="cs2-highlights-admin">
      <Tabs value={tab} onChange={(_e, v: TabKey) => setTab(v)} sx={{ mb: 3 }} variant="scrollable">
        <Tab
          value="recorders"
          label={t('highlightsAdmin.tabs.recorders')}
          data-testid="highlights-tab-recorders"
        />
        <Tab
          value="clips"
          label={t('highlightsAdmin.tabs.clips')}
          data-testid="highlights-tab-clips"
        />
        <Tab
          value="overlays"
          label={t('highlightsAdmin.tabs.overlays')}
          data-testid="highlights-tab-overlays"
        />
        <Tab
          value="connect"
          label={t('highlightsAdmin.tabs.connect')}
          data-testid="highlights-tab-connect"
        />
      </Tabs>
      {tab === 'recorders' && <RecordersTab />}
      {tab === 'clips' && <ClipsTab />}
      {tab === 'overlays' && <OverlaysTab />}
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
              ) : r.working ? (
                <Chip size="small" color="success" label={t('highlightsAdmin.recording')} />
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
            {r.working && (
              <Typography variant="body2" data-testid={`recorder-working-${r.name}`}>
                {t('highlightsAdmin.workingOn', {
                  count: r.working.clips,
                  map: r.working.mapNumber + 1,
                  match: r.working.matchSlug ?? '—',
                  time: when(r.working.since),
                })}
              </Typography>
            )}
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
              {!r.online && (
                <Button
                  size="small"
                  color="error"
                  data-testid={`recorder-forget-${r.name}`}
                  onClick={async () => {
                    try {
                      await api.delete(`/api/game/cs2/recorders/${enc}`);
                      showSuccess(t('highlightsAdmin.forgotten'));
                      await load();
                    } catch (err) {
                      showError(
                        err instanceof Error ? err.message : t('highlightsAdmin.actionError')
                      );
                    }
                  }}
                >
                  {t('highlightsAdmin.forget')}
                </Button>
              )}
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

/** Clean copies of the clips and redrawing their overlays (CS2's clips and reels). */
function OverlaysTab() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [keepClean, setKeepClean] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .get<{ settings?: Record<string, unknown> }>('/api/settings')
      .then((res) => setKeepClean(res.settings?.highlightsKeepClean !== false))
      .catch((err: Error) => showError(err.message));
  }, [showError]);

  if (keepClean === null) return <CircularProgress />;
  return (
    <Box sx={{ maxWidth: 720 }} data-testid="cs2-highlights-overlays">
      <HighlightOverlaySetting
        keepClean={keepClean}
        onKeepClean={async (value) => {
          setKeepClean(value);
          try {
            await api.put('/api/settings', { highlightsKeepClean: value });
            showSuccess(t('settings.saved'));
          } catch (err) {
            showError(err instanceof Error ? err.message : t('settings.saveFailed'));
          }
        }}
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

interface AdminClip {
  id: number;
  mapNumber: number;
  playerName: string;
  title: string;
  kind: string;
  status: string;
  madeWith: string | null;
  outdated: boolean;
}

interface AdminReel {
  mapNumber: number;
  status: string;
  clips: number | null;
  madeWith: string | null;
  outdated: boolean;
}

interface AdminMatch {
  slug: string;
  match: string;
  clips: AdminClip[];
  reels: AdminReel[];
}

/** "1440p120" as "1440p · 120 fps". */
const quality = (q: string) => q.replace(/^(\d+)p(\d+)$/, '$1p · $2 fps');

/**
 * Recent matches' clips and reels, what each was made at, and a Redo for each,
 * or for every one made at other settings than the current.
 */
function ClipsTab() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [data, setData] = useState<{
    current: string;
    outdated: number;
    matches: AdminMatch[];
  } | null>(null);
  const [onlyOutdated, setOnlyOutdated] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/api/game/cs2/clips${onlyOutdated ? '?outdated=1' : ''}`));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.loadError'));
    }
  }, [onlyOutdated, showError, t]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const redo = async (body: object) => {
    setBusy(true);
    try {
      const res = await api.post<{ clips: number; reels: number }>(
        '/api/game/cs2/clips/redo',
        body
      );
      showSuccess(t('highlightsAdmin.clips.redone', { clips: res.clips, reels: res.reels }));
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.actionError'));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  const made = (m: string | null) =>
    m
      ? t('highlightsAdmin.clips.madeWith', { quality: quality(m) })
      : t('highlightsAdmin.clips.madeUnknown');
  const mapName = (n: number) =>
    n < 0 ? t('highlightsAdmin.clips.series') : t('highlightsAdmin.clips.mapN', { n: n + 1 });
  const row = {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    flexWrap: 'wrap',
    py: 0.75,
    borderTop: 1,
    borderColor: 'divider',
  } as const;
  return (
    <Stack spacing={2} data-testid="clips-admin">
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2">
          {t('highlightsAdmin.clips.current', { quality: quality(data.current) })}
        </Typography>
        {data.outdated > 0 && (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={t('highlightsAdmin.clips.outdated', { count: data.outdated })}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant={onlyOutdated ? 'contained' : 'outlined'}
          onClick={() => setOnlyOutdated((v) => !v)}
          data-testid="clips-only-outdated"
        >
          {t('highlightsAdmin.clips.onlyOutdated')}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={busy || data.outdated === 0}
          onClick={() => void redo({ outdated: true })}
          data-testid="clips-redo-outdated"
        >
          {t('highlightsAdmin.clips.redoOutdated')}
        </Button>
      </Stack>
      {data.matches.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {onlyOutdated
            ? t('highlightsAdmin.clips.emptyOutdated')
            : t('highlightsAdmin.clips.empty')}
        </Typography>
      )}
      {data.matches.map((m) => (
        <Box
          key={m.slug}
          data-testid={`clips-match-${m.slug}`}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}
        >
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, overflowWrap: 'anywhere' }}>
            {m.match}
          </Typography>
          {m.reels.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                {t('highlightsAdmin.clips.reels')}
              </Typography>
              {m.reels.map((r) => (
                <Box key={r.mapNumber} sx={row} data-testid={`clips-reel-${m.slug}-${r.mapNumber}`}>
                  <Typography variant="body2" fontWeight={600} sx={{ minWidth: 110 }}>
                    {t('highlightsAdmin.clips.reelOf', { map: mapName(r.mapNumber) })}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t(`highlightsAdmin.clips.status.${r.status}`)}
                  />
                  {r.outdated && (
                    <Chip
                      size="small"
                      color="warning"
                      label={t('highlightsAdmin.clips.outdated_flag')}
                    />
                  )}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ flex: 1, minWidth: 140 }}
                  >
                    {made(r.madeWith)}
                  </Typography>
                  <Button
                    size="small"
                    disabled={busy || r.status === 'recording'}
                    onClick={() => void redo({ reels: [{ slug: m.slug, mapNumber: r.mapNumber }] })}
                  >
                    {t('highlightsAdmin.clips.redo')}
                  </Button>
                </Box>
              ))}
            </Box>
          )}
          {m.clips.map((c) => (
            <Box key={c.id} sx={row} data-testid={`clips-clip-${c.id}`}>
              <Typography variant="body2" sx={{ minWidth: 60, color: 'text.secondary' }}>
                {mapName(c.mapNumber)}
              </Typography>
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {c.playerName}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 160 }}>
                {c.title}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                label={t(`highlightsAdmin.clips.status.${c.status}`)}
              />
              {c.outdated && (
                <Chip
                  size="small"
                  color="warning"
                  label={t('highlightsAdmin.clips.outdated_flag')}
                />
              )}
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 150 }}>
                {made(c.madeWith)}
              </Typography>
              <Button
                size="small"
                disabled={busy || !(c.status === 'done' || c.status === 'failed')}
                onClick={() => void redo({ clipIds: [c.id] })}
              >
                {t('highlightsAdmin.clips.redo')}
              </Button>
            </Box>
          ))}
        </Box>
      ))}
    </Stack>
  );
}
