/** The Clips tab of the Highlights admin page. */
import { MatchRecordingGroup } from '../settings/RecorderFleetControls';
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
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import {
  api,
  onSocketReconnect,
  useModuleTranslation,
  useSnackbar,
  useSocket,
} from '../../../module-sdk';

import { duration, quality } from './highlightsAdminShared';
import type { AdminClip, Verdict } from './ClipReview';
import { ClipReview, ClipThumb } from './ClipReview';

export interface AdminReel {
  mapNumber: number;
  status: string;
  clips: number | null;
  madeWith: string | null;
  outdated: boolean;
  /** Claim to done: joining the reel. */
  assemblySeconds?: number | null;
  /** Its clips' render times added up (recorder time, not elapsed). */
  clipRenderSeconds?: number | null;
  /** Wall clock from its first clip's claim to the reel being done. */
  elapsedSeconds?: number | null;
}

export interface AdminMatch {
  slug: string;
  match: string;
  /** Failed clips: the reels that would take them wait until each is redone or dropped. */
  failedClips?: number;
  clips: AdminClip[];
  reels: AdminReel[];
}

/**
 * Recent matches' clips and reels, what each was made at, and a Redo for each,
 * or for every one made at other settings than the current.
 */
export function ClipsTab() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [data, setData] = useState<{
    current: string;
    outdated: number;
    queued?: number;
    matches: AdminMatch[];
  } | null>(null);
  const [onlyOutdated, setOnlyOutdated] = useState(false);
  const [busy, setBusy] = useState(false);
  // The clip being watched: its match and its place among that match's recorded clips.
  const [review, setReview] = useState<{ slug: string; index: number } | null>(null);
  // Going through the clips no one has reviewed yet.
  const [reviewing, setReviewing] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/api/game/cs2/clips${onlyOutdated ? '?outdated=1' : ''}`));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.loadError'));
    }
  }, [onlyOutdated, showError, t]);

  // Live: a clip recorded, redone or reviewed changes the recorders' work too
  // (`recorders:changed`), so that is when the list is read again.
  const socket = useSocket();
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    socket.emit('admin:subscribe');
    const changed = () => void load();
    socket.on('recorders:changed', changed);
    const off = onSocketReconnect(socket, () => {
      socket.emit('admin:subscribe');
      void load();
    });
    return () => {
      clearTimeout(first);
      socket.off('recorders:changed', changed);
      off();
    };
  }, [load, socket]);

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

  // Clips queued again keep their old video instead (api clipsAdmin.stopRedo).
  const stopRedo = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ clips: number; reels: number }>(
        '/api/game/cs2/clips/redo/stop',
        {}
      );
      showSuccess(t('highlightsAdmin.clips.stopped', { clips: res.clips, reels: res.reels }));
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('highlightsAdmin.actionError'));
    } finally {
      setBusy(false);
    }
  };

  const verdict = async (clip: AdminClip, v: Verdict, note: string) => {
    setBusy(true);
    try {
      await api.post(`/api/game/cs2/clips/${clip.id}/review`, {
        verdict: v,
        note: note || undefined,
      });
      showSuccess(t(`highlightsAdmin.review.done.${v}`));
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
  // Recorded clips no one has reviewed yet, newest match first.
  const toReview = data.matches.flatMap((m) => m.clips.filter((c) => c.video && !c.review));
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
          variant="contained"
          disabled={toReview.length === 0}
          onClick={() => setReviewing(0)}
          data-testid="clips-review-start"
        >
          {t('highlightsAdmin.review.start', { count: toReview.length })}
        </Button>
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
        {(data.queued ?? 0) > 0 && (
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={() => void stopRedo()}
            data-testid="clips-stop-redo"
          >
            {t('highlightsAdmin.clips.stopRedo', { count: data.queued })}
          </Button>
        )}
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
          <MatchRecordingGroup slug={m.slug} />
          <Button
            size="small"
            color="warning"
            disabled={busy}
            sx={{ mb: 1.5 }}
            data-testid={`clips-redo-match-${m.slug}`}
            onClick={() => void redo({ matchSlugs: [m.slug] })}
          >
            {t('highlightsAdmin.clips.redoMatch')}
          </Button>
          {(m.failedClips ?? 0) > 0 && (
            <Alert severity="warning" sx={{ mb: 1.5 }} data-testid={`clips-held-${m.slug}`}>
              {t('highlightsAdmin.clips.heldByFailed', { count: m.failedClips })}
            </Alert>
          )}
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
                    {[
                      made(r.madeWith),
                      r.elapsedSeconds != null &&
                        t('highlightsAdmin.clips.reelElapsed', {
                          time: duration(r.elapsedSeconds),
                        }),
                      r.assemblySeconds != null &&
                        t('highlightsAdmin.clips.reelAssembly', {
                          time: duration(r.assemblySeconds),
                        }),
                      r.clipRenderSeconds != null &&
                        t('highlightsAdmin.clips.reelRender', {
                          time: duration(r.clipRenderSeconds),
                        }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
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
              <ClipThumb
                clip={c}
                onOpen={() =>
                  setReview({
                    slug: m.slug,
                    index: m.clips.filter((x) => x.video).findIndex((x) => x.id === c.id),
                  })
                }
              />
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
              {c.review && (
                <Chip
                  size="small"
                  color={
                    c.review === 'approved' ? 'success' : c.review === 'redo' ? 'warning' : 'error'
                  }
                  variant="outlined"
                  label={t(`highlightsAdmin.review.state.${c.review}`)}
                  title={c.reviewNote ?? undefined}
                />
              )}
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
      {reviewing !== null && toReview.length > 0 && (
        <ClipReview
          clips={toReview}
          index={Math.min(reviewing, toReview.length - 1)}
          onIndex={setReviewing}
          onClose={() => setReviewing(null)}
          busy={busy}
          onRedo={() => undefined}
          onVerdict={(clip, v, note) => void verdict(clip, v, note)}
        />
      )}
      {review &&
        (() => {
          const match = data.matches.find((x) => x.slug === review.slug);
          const watchable = match ? match.clips.filter((x) => x.video) : [];
          return watchable.length ? (
            <ClipReview
              clips={watchable}
              index={Math.min(review.index, watchable.length - 1)}
              onIndex={(index) => setReview({ slug: review.slug, index })}
              onClose={() => setReview(null)}
              busy={busy}
              onRedo={(clip) => {
                setReview(null);
                void redo({ clipIds: [clip.id] });
              }}
            />
          ) : null;
        })()}
    </Stack>
  );
}
