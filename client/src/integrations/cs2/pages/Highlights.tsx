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
 * Adding a recorder is on the Recorders tab: a recorder key and the one
 *   `docker run` that starts it (api: demos/recorderKeys.ts).
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
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
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
  label: string | null;
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

type TabKey = 'recorders' | 'clips' | 'overlays';

const when = (s: number | null) =>
  s ? new Date(s * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const duration = (s: number | null) =>
  s == null ? '—' : s >= 90 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;

/**
 * CS2's tab on core's Highlights page (`highlightsAdmin`): its recorders, the
 * overlays on its clips and the clips themselves. What every game's
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
      </Tabs>
      {tab === 'recorders' && <RecordersTab />}
      {tab === 'clips' && <ClipsTab />}
      {tab === 'overlays' && <OverlaysTab />}
    </Box>
  );
}

function RecordersTab() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [recorders, setRecorders] = useState<Recorder[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; label: string } | null>(null);

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
  return (
    <Stack spacing={2}>
      <AddRecorder onKeys={() => void load()} />
      {recorders.length === 0 && (
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
      )}
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
                {r.label || r.name}
              </Typography>
              {r.label && (
                <Typography variant="caption" color="text.secondary">
                  {r.name}
                </Typography>
              )}
              <Button
                size="small"
                onClick={() => setRenaming({ name: r.name, label: r.label ?? '' })}
                data-testid={`recorder-rename-${r.name}`}
              >
                {t('highlightsAdmin.rename')}
              </Button>
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
      <Dialog open={!!renaming} onClose={() => setRenaming(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('highlightsAdmin.renameTitle')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            sx={{ mt: 1 }}
            label={t('highlightsAdmin.renameLabel')}
            helperText={renaming ? t('highlightsAdmin.renameHelp', { name: renaming.name }) : ''}
            value={renaming?.label ?? ''}
            onChange={(e) => setRenaming((cur) => (cur ? { ...cur, label: e.target.value } : cur))}
            inputProps={{ maxLength: 80, 'data-testid': 'recorder-rename-input' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>{t('highlightsAdmin.close')}</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!renaming) return;
              try {
                await api.put(`/api/game/cs2/recorders/${encodeURIComponent(renaming.name)}`, {
                  label: renaming.label.trim(),
                });
                setRenaming(null);
                await load();
              } catch (err) {
                showError(err instanceof Error ? err.message : t('highlightsAdmin.actionError'));
              }
            }}
          >
            {t('highlightsAdmin.renameSave')}
          </Button>
        </DialogActions>
      </Dialog>
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

interface RecorderKey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
}

/**
 * What a PC runs to become a recorder: the recorder image with the PC's GPU,
 * display, sound, Steam and CS2, and this platform's address and a recorder
 * key. It finds CS2 in the PC's Steam libraries itself.
 */
export function recorderCommand(
  origin: string,
  token: string,
  name: string,
  nvidia: boolean
): string {
  return [
    'docker run -d --name at-recorder --restart unless-stopped \\',
    '  --user "$(id -u):$(id -g)" --group-add "$(getent group video | cut -d: -f3)" \\',
    '  --group-add "$(getent group render | cut -d: -f3)" --device /dev/dri' +
      (nvidia ? ' --gpus all' : '') +
      ' \\',
    '  --ipc=host --net=host --shm-size 4g --security-opt seccomp=unconfined --cap-add SYS_NICE \\',
    '  -v "$HOME:$HOME" -v /mnt:/mnt -v /media:/media -v /tmp:/tmp \\',
    '  -v /run/user:/run/user:rslave -e HOME="$HOME" -e XDG_RUNTIME_DIR="/run/user/$(id -u)" \\',
    '  -e WAYLAND_DISPLAY="$WAYLAND_DISPLAY" -e DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" \\',
    `  -e AT_URL=${origin} -e AT_WORKER_TOKEN=${token} -e AT_WORKER_NAME=${name} \\`,
    '  sivertio/auto-tournament-recorder:next',
  ].join('\n');
}

/**
 * "Add a recorder": a recorder key and the one command that starts a recorder
 * with it, to paste on a Linux PC with Steam and CS2. The recorder shows up
 * in the list when it first asks for work. The keys made so far, to revoke.
 */
function AddRecorder({ onKeys }: { onKeys: () => void }) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [nvidia, setNvidia] = useState(false);
  const [made, setMade] = useState<{ token: string; name: string } | null>(null);
  const [keys, setKeys] = useState<RecorderKey[]>([]);
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const loadKeys = useCallback(async () => {
    try {
      setKeys((await api.get<{ keys: RecorderKey[] }>('/api/game/cs2/recorder-keys')).keys);
    } catch {
      setKeys([]);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void loadKeys(), 0);
    return () => clearTimeout(first);
  }, [loadKeys]);

  const make = async () => {
    const clean = name
      .trim()
      .replace(/[^A-Za-z0-9_.-]+/g, '-')
      .slice(0, 60);
    if (!clean) return;
    setBusy(true);
    try {
      const res = await api.post<{ token: string }>('/api/game/cs2/recorder-keys', { name: clean });
      setMade({ token: res.token, name: clean });
      await loadKeys();
      onKeys();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.actionError'));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    try {
      await api.delete(`/api/game/cs2/recorder-keys/${encodeURIComponent(id)}`);
      showSuccess(t('highlightsAdmin.add.revoked'));
      await loadKeys();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.actionError'));
    }
  };
  const command = made ? recorderCommand(origin, made.token, made.name, nvidia) : '';
  const close = () => {
    setOpen(false);
    setMade(null);
    setName('');
  };
  const live = keys.filter((k) => !k.revoked);

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button variant="contained" onClick={() => setOpen(true)} data-testid="recorder-add">
          {t('highlightsAdmin.add.button')}
        </Button>
        <Typography variant="body2" color="text.secondary">
          {t('highlightsAdmin.add.hint')}
        </Typography>
      </Stack>
      {live.length > 0 && (
        <Box sx={{ mt: 1.5 }} data-testid="recorder-keys">
          <Typography variant="caption" color="text.secondary">
            {t('highlightsAdmin.add.keys')}
          </Typography>
          {live.map((k) => (
            <Stack
              key={k.id}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ py: 0.5, borderTop: 1, borderColor: 'divider' }}
            >
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {k.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                {k.lastUsedAt
                  ? t('highlightsAdmin.add.used', { time: when(k.lastUsedAt) })
                  : t('highlightsAdmin.add.unused')}
              </Typography>
              <Button size="small" color="error" onClick={() => void revoke(k.id)}>
                {t('highlightsAdmin.add.revoke')}
              </Button>
            </Stack>
          ))}
        </Box>
      )}
      <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
        <DialogTitle>{t('highlightsAdmin.add.title')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2">{t('highlightsAdmin.add.needs')}</Typography>
          {!made ? (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              alignItems={{ sm: 'center' }}
            >
              <TextField
                autoFocus
                size="small"
                label={t('highlightsAdmin.add.name')}
                placeholder="lan-seat-12"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void make()}
                inputProps={{ maxLength: 60, 'data-testid': 'recorder-add-name' }}
              />
              <FormControlLabel
                control={<Switch checked={nvidia} onChange={(e) => setNvidia(e.target.checked)} />}
                label={t('highlightsAdmin.add.nvidia')}
              />
            </Stack>
          ) : (
            <>
              <Alert severity="warning">{t('highlightsAdmin.add.once')}</Alert>
              <Box
                component="pre"
                data-testid="recorder-command"
                sx={{
                  m: 0,
                  p: 1.5,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  overflowX: 'auto',
                  fontSize: 12.5,
                }}
              >
                {command}
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('highlightsAdmin.add.after')}
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          {made ? (
            <>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(command);
                    showSuccess(t('highlightsAdmin.add.copied'));
                  } catch {
                    showError(t('highlightsAdmin.add.copyFailed'));
                  }
                }}
                variant="contained"
              >
                {t('highlightsAdmin.add.copy')}
              </Button>
              <Button onClick={close}>{t('highlightsAdmin.close')}</Button>
            </>
          ) : (
            <>
              <Button onClick={close}>{t('highlightsAdmin.close')}</Button>
              <Button
                variant="contained"
                disabled={busy || !name.trim()}
                onClick={() => void make()}
                data-testid="recorder-add-make"
              >
                {t('highlightsAdmin.add.make')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
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
  recorder: string | null;
  recordSeconds: number | null;
  doneAt: number | null;
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
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 140 }}>
                {[c.recorder, c.recordSeconds != null ? duration(c.recordSeconds) : null]
                  .filter(Boolean)
                  .join(' · ') || '—'}
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
