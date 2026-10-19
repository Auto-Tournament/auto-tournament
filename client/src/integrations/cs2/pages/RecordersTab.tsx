/** The Recorders tab of the Highlights admin page. */
import {
  RecorderGroups,
  RecorderGroupToggle,
  type RecorderGroup,
} from '../settings/RecorderFleetControls';
/**
 * CS2's part of the Highlights page. Four tabs:
 *
 * - Recorders: every recorder that asked for work, with its GPU, status
 *   (online, recording, paused when its CS2 would not start), its
 *   benchmark, how many clips it kept, seconds per clip, and its recent runs
 *   with their logs (api:
 *   demos/recorders.ts). An offline one can be forgotten.
 * - Clips: recent matches' clips and reels, what each was made at, and a Redo
 *   for each, or for every one made at other settings (api: demos/clipsAdmin.ts).
 * - Overlays: clean copies of the clips, and redrawing their overlays.
 * Adding a recorder is on the Recorders tab: a recorder key and the one
 *   `docker run` that starts it (api: demos/recorderKeys.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { FilmStripIcon } from '@phosphor-icons/react';
import {
  api,
  onSocketReconnect,
  useModuleTranslation,
  useSnackbar,
  useSocket,
} from '../../../module-sdk';
import { type RecorderProgress } from '../settings/RecorderProgressBar';
import { updateBatch } from './recorderUpdateBatch';

import type { Recorder, Run } from './highlightsAdminShared';
import { duration, shortImage, when } from './highlightsAdminShared';
import { RecorderItem } from './RecorderItem';
import { AddRecorder } from './AddRecorder';

export function RecordersTab() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [recorders, setRecorders] = useState<Recorder[] | null>(null);
  const [groups, setGroups] = useState<RecorderGroup[]>([]);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; label: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, fleet] = await Promise.all([
        api.get<{ recorders: Recorder[] }>('/api/game/cs2/recorders'),
        api.get<{ groups: RecorderGroup[] }>('/api/game/cs2/recorder-groups'),
      ]);
      setRecorders(res.recorders);
      setGroups(fleet.groups);
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.loadError'));
      setRecorders([]);
    }
  }, [showError, t]);

  // Live: the platform says when recorders change (a job, an update, a
  // toggle) and streams what each is doing; no polling.
  const socket = useSocket();
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const join = () => socket.emit('admin:subscribe');
    join();
    const changed = () => void load();
    const progress = ({ name, progress }: { name: string; progress: RecorderProgress | null }) =>
      setRecorders((list) => list?.map((r) => (r.name === name ? { ...r, progress } : r)) ?? list);
    socket.on('recorders:changed', changed);
    socket.on('recorders:progress', progress);
    const off = onSocketReconnect(socket, () => {
      join();
      void load();
    });
    return () => {
      clearTimeout(first);
      socket.off('recorders:changed', changed);
      socket.off('recorders:progress', progress);
      off();
    };
  }, [load, socket]);

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
  const sortedRecorders = [...recorders].sort((a, b) =>
    (a.hostname ?? a.name).localeCompare(b.hostname ?? b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
  const cards: { group: RecorderGroup | null; members: Recorder[] }[] = [...groups]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((group) => ({ group, members: sortedRecorders.filter((r) => r.groupId === group.id) }));
  const ungrouped = sortedRecorders.filter(
    (r) => r.groupId === null || !groups.some((g) => g.id === r.groupId)
  );
  if (ungrouped.length) cards.push({ group: null, members: ungrouped });
  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        useFlexGap
      >
        <AddRecorder onKeys={() => void load()} />
        <Button
          variant="outlined"
          data-testid="recorder-update-all"
          disabled={
            updatingAll ||
            recorders.some((r) => ['queued', 'updating'].includes(r.updateStatus)) ||
            !recorders.some((r) => r.updateSupported && r.updateAvailable)
          }
          onClick={async () => {
            setUpdatingAll(true);
            try {
              await act(
                '/api/game/cs2/recorders/update-all',
                t('highlightsAdmin.fleet.updateQueued')
              );
            } finally {
              setUpdatingAll(false);
            }
          }}
        >
          {t('highlightsAdmin.fleet.updateAll')}
        </Button>
      </Stack>
      {(() => {
        // Update all's progress: the recorders asked together, how many are on the new version.
        const batch = updateBatch(recorders, Date.now() / 1000);
        if (!batch) return null;
        const finished = batch.done + batch.failed;
        return (
          <Box data-testid="recorders-update-batch">
            <Typography variant="body2" color="text.secondary">
              {t(
                batch.running > 0
                  ? 'highlightsAdmin.fleet.updateProgress'
                  : 'highlightsAdmin.fleet.updateDone',
                { done: batch.done, total: batch.total }
              )}
              {batch.failed > 0 &&
                ` · ${t('highlightsAdmin.fleet.updateFailed', { count: batch.failed })}`}
            </Typography>
            {batch.running > 0 && (
              <LinearProgress
                variant="determinate"
                value={(finished / batch.total) * 100}
                aria-label={t('highlightsAdmin.fleet.updateProgress', {
                  done: batch.done,
                  total: batch.total,
                })}
                sx={{ mt: 0.5, maxWidth: 360 }}
              />
            )}
          </Box>
        );
      })()}
      {(() => {
        // What "Update all" installs: the newest image and agent any recorder was told about.
        const latestImage = recorders.find((r) => r.latestImage)?.latestImage ?? null;
        const latestAgent = recorders.find((r) => r.latestAgentVersion)?.latestAgentVersion ?? null;
        const behind = recorders.filter((r) => r.updateAvailable).length;
        if (!recorders.length || (!latestImage && !latestAgent)) return null;
        return (
          <Typography variant="body2" color="text.secondary" data-testid="recorders-latest">
            {t('highlightsAdmin.fleet.latest', {
              image: latestImage ? shortImage(latestImage) : '—',
              agent: latestAgent ?? '—',
            })}
            {' · '}
            {behind
              ? t('highlightsAdmin.fleet.behind', { count: behind })
              : t('highlightsAdmin.fleet.allCurrent')}
          </Typography>
        );
      })()}
      <RecorderGroups groups={groups} onChanged={load} showToggles={false} />
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
      {cards.map(({ group, members }) => (
        <Box
          key={group?.id ?? 'ungrouped'}
          data-testid={`recorder-card-${group?.id ?? 'ungrouped'}`}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}
          >
            <Typography variant="h6" sx={{ flex: 1 }}>
              {group?.name ?? t('highlightsAdmin.fleet.ungrouped')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('highlightsAdmin.fleet.connectedCount', {
                count: members.filter((r) => r.online).length,
                total: members.length,
              })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('highlightsAdmin.fleet.enabledCount', {
                count: members.filter((r) => r.effectiveEnabled).length,
                total: members.length,
              })}
            </Typography>
            {group && <RecorderGroupToggle group={group} onChanged={load} />}
          </Stack>
          {members.map((r) => (
            <RecorderItem
              key={r.name}
              r={r}
              groups={groups}
              load={load}
              act={act}
              onRuns={setOpen}
              onRename={setRenaming}
            />
          ))}
        </Box>
      ))}
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

export function RunsDialog({ name, onClose }: { name: string | null; onClose: () => void }) {
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
                      run.failed ? t('highlightsAdmin.runFailed', { count: run.failed }) : null,
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
