import { RecorderControls, type RecorderGroup } from '../settings/RecorderFleetControls';
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
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { CaretDownIcon } from '@phosphor-icons/react';
import { api, useModuleTranslation, useSnackbar } from '../../../module-sdk';
import { RecorderProgressBar } from '../settings/RecorderProgressBar';

import type { Recorder } from './highlightsAdminShared';
import { duration, shortImage, Stat, when } from './highlightsAdminShared';

/** One recorder in the Recorders tab (Highlights.tsx). */
export function RecorderItem({
  r,
  groups,
  load,
  act,
  onRuns,
  onRename,
}: {
  r: Recorder;
  groups: RecorderGroup[];
  load: () => Promise<void>;
  act: (path: string, done: string) => Promise<void>;
  onRuns: (name: string) => void;
  onRename: (value: { name: string; label: string }) => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const enc = encodeURIComponent(r.name);
  return (
    <Box
      key={r.name}
      data-testid={`recorder-${r.name}`}
      sx={{ position: 'relative', borderTop: 1, borderColor: 'divider' }}
    >
      <Box sx={{ position: 'absolute', right: 0, top: 6, zIndex: 1 }}>
        <RecorderControls
          name={r.name}
          enabled={r.enabled}
          groupId={r.groupId}
          groups={groups}
          onChanged={load}
          showGroup={false}
        />
      </Box>
      <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<CaretDownIcon />} sx={{ pr: 18 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography
              variant="subtitle1"
              fontWeight={700}
              color={r.lastRunFailed || r.updateError ? 'error.main' : 'text.primary'}
              sx={{ overflowWrap: 'anywhere' }}
            >
              {r.label || r.hostname || r.name}
            </Typography>
            {r.label && (
              <Typography variant="caption" color="text.secondary">
                {r.name}
              </Typography>
            )}
            <Chip
              size="small"
              variant="outlined"
              color={r.online ? 'success' : 'default'}
              label={t(r.online ? 'highlightsAdmin.fleet.connected' : 'highlightsAdmin.offline')}
            />
            {['queued', 'updating'].includes(r.updateStatus) && (
              <Chip
                size="small"
                color="warning"
                label={
                  r.progress?.step === 'updating' && r.progress.detail
                    ? t(`recorderProgress.update.${r.progress.detail}`, {
                        defaultValue: r.progress.detail,
                      })
                    : t(
                        r.updateStatus === 'queued'
                          ? 'highlightsAdmin.fleet.updatePending'
                          : 'recorderProgress.step.updating'
                      )
                }
              />
            )}
            {r.progress && r.progress.step !== 'updating' && (
              <Chip
                size="small"
                color="info"
                data-testid={`recorder-step-${r.name}`}
                label={[
                  t(`recorderProgress.step.${r.progress.step}`, {
                    defaultValue: r.progress.step,
                  }),
                  typeof r.progress.done === 'number' && r.progress.total
                    ? `${Math.min(r.progress.done + 1, r.progress.total)}/${r.progress.total}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            )}
            {!r.effectiveEnabled ? (
              <Chip
                size="small"
                color={r.working ? 'warning' : 'default'}
                label={t(
                  r.working ? 'highlightsAdmin.fleet.draining' : 'highlightsAdmin.fleet.disabled'
                )}
              />
            ) : r.paused ? (
              <Chip size="small" color="warning" label={t('highlightsAdmin.paused')} />
            ) : r.working ? (
              <Chip size="small" color="success" label={t('highlightsAdmin.recording')} />
            ) : r.online ? (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={t('highlightsAdmin.fleet.idle')}
              />
            ) : null}
            {r.version != null && r.version < 7 && (
              <Chip
                size="small"
                variant="outlined"
                label={t('highlightsAdmin.oldVersion', { version: r.version })}
              />
            )}
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Button
            size="small"
            onClick={() => onRename({ name: r.name, label: r.label ?? '' })}
            data-testid={`recorder-rename-${r.name}`}
          >
            {t('highlightsAdmin.rename')}
          </Button>
          <Typography variant="body2" color="text.secondary">
            {[
              r.gpu || t('highlightsAdmin.unknownGpu'),
              r.platform,
              t('highlightsAdmin.lastSeen', { time: when(r.lastSeen) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {r.groupName ?? t('highlightsAdmin.fleet.ungrouped')}
          </Typography>
          <RecorderControls
            name={r.name}
            enabled={r.enabled}
            groupId={r.groupId}
            groups={groups}
            onChanged={load}
            showEnabled={false}
          />
          {!r.effectiveEnabled && (
            <Typography variant="caption" color="text.secondary">
              {t('highlightsAdmin.fleet.drainHelp')}
            </Typography>
          )}
          {r.progress && <RecorderProgressBar name={r.name} progress={r.progress} />}
          {r.working && !r.progress && (
            <Typography variant="body2" data-testid={`recorder-working-${r.name}`}>
              {t('highlightsAdmin.workingOn', {
                count: r.working.clips,
                map: r.working.mapNumber + 1,
                match: r.working.matchSlug ?? '—',
                time: when(r.working.since),
              })}
              {r.working.playerName ? ` · ${r.working.playerName}` : null}
            </Typography>
          )}
          <Box
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}
            data-testid={`recorder-version-${r.name}`}
          >
            <Chip
              size="small"
              color={r.updateAvailable ? 'warning' : 'success'}
              variant="outlined"
              label={
                r.updateAvailable
                  ? t('highlightsAdmin.fleet.updateAvailable')
                  : t('highlightsAdmin.fleet.upToDate')
              }
            />
            <Typography variant="caption" color="text.secondary">
              {[
                r.agentVersion
                  ? `at-recorder ${r.agentVersion}${
                      r.latestAgentVersion && r.latestAgentVersion !== r.agentVersion
                        ? ` → ${r.latestAgentVersion}`
                        : ''
                    }`
                  : null,
                r.recorderImage
                  ? `${t('highlightsAdmin.fleet.image')} ${shortImage(r.recorderImage)}${
                      r.latestImage && r.latestImage !== r.recorderImage
                        ? ` → ${shortImage(r.latestImage)}`
                        : ''
                    }`
                  : null,
                r.recorderRevision
                  ? t('highlightsAdmin.fleet.build', {
                      revision: r.recorderRevision.slice(0, 12),
                    })
                  : null,
                r.updatedAt
                  ? t('highlightsAdmin.fleet.updatedAt', { time: when(r.updatedAt) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          </Box>
          {r.updateError && <Alert severity="error">{r.updateError}</Alert>}
          {r.paused && r.pauseReason && (
            <Alert severity="warning" sx={{ py: 0 }}>
              {t('highlightsAdmin.pausedUntil', {
                time: when(r.pausedUntil),
                reason: r.pauseReason,
              })}
            </Alert>
          )}
          {r.frameByFrame && r.frameByFrame.status !== 'actions' && (
            <Alert severity="warning" sx={{ py: 0 }} data-testid={`recorder-fbf-${r.name}`}>
              {t(
                r.frameByFrame.status === 'off'
                  ? 'highlightsAdmin.fbfOff'
                  : 'highlightsAdmin.fbfMovie',
                { cs2: r.frameByFrame.cs2 ?? '' }
              )}
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
                  '& td, & th': {
                    px: 1,
                    py: 0.25,
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                  },
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <thead>
                  <tr>
                    <th>{t('highlightsAdmin.bench.hz')}</th>
                    <th>{t('highlightsAdmin.bench.time')}</th>
                    <th>{t('highlightsAdmin.bench.fps')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.benchmark.tries.map((b) => (
                    <tr key={b.gamescopeHz}>
                      <td>
                        {b.gamescopeHz} Hz
                        {b.gamescopeHz === r.benchmark?.pick ? ' ✓' : ''}
                      </td>
                      <td>{b.ok ? duration(b.seconds) : (b.error ?? '—')}</td>
                      <td>{b.captureFps != null ? Math.round(b.captureFps) : '—'}</td>
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
            <Button size="small" variant="outlined" onClick={() => onRuns(r.name)}>
              {t('highlightsAdmin.runs', { count: r.runs })}
            </Button>
            <Button
              size="small"
              disabled={
                !r.updateSupported ||
                !r.updateAvailable ||
                r.updateStatus === 'queued' ||
                r.updateStatus === 'updating'
              }
              data-testid={`recorder-update-${r.name}`}
              onClick={() =>
                void act(
                  `/api/game/cs2/recorders/${enc}/update`,
                  t('highlightsAdmin.fleet.updateQueued')
                )
              }
            >
              {t(
                r.updateStatus === 'queued' || r.updateStatus === 'updating'
                  ? 'highlightsAdmin.fleet.updatePending'
                  : 'highlightsAdmin.fleet.update'
              )}
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
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
