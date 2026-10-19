/** A clip's thumbnail and its review dialog (Highlights admin, Clips tab). */
import type { Untrusted } from '../../types';
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
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { api, HighlightPlayer, type MusicTrack, useModuleTranslation } from '../../../module-sdk';

import { duration, quality } from './highlightsAdminShared';

export interface AdminClip {
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
  /** Its video file, played from /api/game/cs2/highlights/:file; null until recorded. */
  video: string | null;
  /** An admin's verdict: 'approved', 'redo' or 'dropped'; null until reviewed. */
  review: string | null;
  reviewNote: string | null;
}

export type Verdict = 'approved' | 'redo' | 'weapon' | 'drop';

export const clipUrl = (file: string) => `/api/game/cs2/highlights/${encodeURIComponent(file)}`;

/** A finished clip's picture: a frame two seconds in (the browser draws it from the video). */
export function ClipThumb({ clip, onOpen }: { clip: AdminClip; onOpen: () => void }) {
  const { t } = useModuleTranslation('cs2');
  if (!clip.video) {
    return (
      <Box
        sx={{ width: 112, height: 63, flex: 'none', borderRadius: 1, bgcolor: 'action.hover' }}
        aria-hidden
      />
    );
  }
  return (
    <Box
      component="button"
      type="button"
      onClick={onOpen}
      aria-label={t('highlightsAdmin.clips.watch', { title: clip.title })}
      data-testid={`clips-thumb-${clip.id}`}
      sx={{
        p: 0,
        border: 0,
        width: 112,
        height: 63,
        flex: 'none',
        borderRadius: 1,
        overflow: 'hidden',
        cursor: 'pointer',
        bgcolor: 'common.black',
        '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
      }}
    >
      <Box
        component="video"
        src={`${clipUrl(clip.video)}#t=2`}
        preload="metadata"
        muted
        playsInline
        sx={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}

/**
 * One clip to watch, with the match's others a step away: to review a match's
 * clips and redo a bad one.
 */
export function ClipReview({
  clips,
  index,
  onIndex,
  onClose,
  onRedo,
  onVerdict,
  busy,
}: {
  clips: AdminClip[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onRedo: (clip: AdminClip) => void;
  /** Review mode: approve, redo or drop the clip (with a note), then the next one comes up. */
  onVerdict?: (clip: AdminClip, verdict: Verdict, note: string) => void;
  busy: boolean;
}) {
  const { t } = useModuleTranslation('cs2');
  const clip = clips[index];
  const [note, setNote] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ tracks: MusicTrack[] }>('/api/highlights/music')
      .then((r) => !cancelled && setTracks(r.tracks))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  // A new clip starts with an empty note.
  const [noteFor, setNoteFor] = useState(clip?.id);
  if (noteFor !== clip?.id) {
    setNoteFor(clip?.id);
    setNote('');
  }
  useEffect(() => {
    const onKey = (e: { key: string; target: Untrusted; defaultPrevented: boolean }) => {
      if (e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' && index < clips.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (onVerdict && clip && !busy) {
        const k = e.key.toLowerCase();
        if (k === 'a') onVerdict(clip, 'approved', note);
        if (k === 'r') onVerdict(clip, 'redo', note);
        if (k === 'w') onVerdict(clip, 'weapon', note);
        if (k === 'd') onVerdict(clip, 'drop', note);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clips.length, index, onIndex, onVerdict, clip, busy, note]);
  if (!clip?.video) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth data-testid="clips-review">
      <DialogTitle sx={{ pb: 1 }}>
        {clip.playerName} · {clip.title}
        <Typography variant="body2" color="text.secondary">
          {[
            t('highlightsAdmin.clips.mapN', { n: clip.mapNumber + 1 }),
            clip.recorder,
            clip.recordSeconds != null ? duration(clip.recordSeconds) : null,
            clip.madeWith ? quality(clip.madeWith) : null,
            t('highlightsAdmin.clips.reviewOf', { n: index + 1, count: clips.length }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <HighlightPlayer
          key={clip.id}
          src={clipUrl(clip.video)}
          label={`${clip.playerName} · ${clip.title}`}
          music={tracks.length ? { tracks, introEnd: 0 } : null}
          autoPlay
        />
      </DialogContent>
      {onVerdict && (
        <Box sx={{ px: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            size="small"
            label={t('highlightsAdmin.review.note')}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 300))}
            fullWidth
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              color="success"
              disabled={busy}
              onClick={() => onVerdict(clip, 'approved', note)}
              data-testid="review-approve"
            >
              {t('highlightsAdmin.review.approve')}
            </Button>
            <Button
              variant="outlined"
              color="warning"
              disabled={busy}
              onClick={() => onVerdict(clip, 'redo', note)}
              data-testid="review-redo"
            >
              {t('highlightsAdmin.review.redo')}
            </Button>
            <Button
              variant="outlined"
              color="warning"
              disabled={busy}
              onClick={() => onVerdict(clip, 'weapon', note)}
              data-testid="review-weapon"
            >
              {t('highlightsAdmin.review.weapon')}
            </Button>
            <Button
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => onVerdict(clip, 'drop', note)}
              data-testid="review-drop"
            >
              {t('highlightsAdmin.review.drop')}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t('highlightsAdmin.review.help')}
          </Typography>
        </Box>
      )}
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button disabled={index === 0} onClick={() => onIndex(index - 1)}>
            {t('highlightsAdmin.clips.previous')}
          </Button>
          <Button disabled={index >= clips.length - 1} onClick={() => onIndex(index + 1)}>
            {t('highlightsAdmin.clips.next')}
          </Button>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {!onVerdict && (
            <Button color="warning" disabled={busy} onClick={() => onRedo(clip)}>
              {t('highlightsAdmin.clips.redo')}
            </Button>
          )}
          <Button onClick={onClose}>{t('highlightsAdmin.clips.close')}</Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
