/** Types and helpers the Highlights admin page files share. */
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
import { Box, Typography } from '@mui/material';
import { fmtDateTime } from '../../../module-sdk';
import { type RecorderProgress } from '../settings/RecorderProgressBar';

/** An image reference for people: its digest's first 12 characters, or its tag. */
export function shortImage(image: string): string {
  const digest = image.match(/sha256:([0-9a-f]{12})/i);
  if (digest) return digest[1];
  const tag = image.split('/').pop() ?? image;
  return tag.length > 24 ? `${tag.slice(0, 24)}…` : tag;
}

export interface BenchmarkTry {
  gamescopeHz: number;
  seconds: number | null;
  captureFps: number | null;
  ok: boolean;
  error?: string;
}

export interface Recorder {
  enabled: boolean;
  effectiveEnabled: boolean;
  groupId: number | null;
  groupName: string | null;
  name: string;
  hostname?: string;
  agentVersion?: string | null;
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
  benchmark: {
    tries: BenchmarkTry[];
    pick: number | null;
    backend?: 'native' | 'stream';
    ok?: boolean;
    error?: string | null;
  } | null;
  benchmarkAt: number | null;
  benchmarkWanted: boolean;
  gamescopeHz: number | null;
  runs: number;
  avgClipSeconds: number | null;
  lastError: string | null;
  lastRunFailed: boolean;
  updateSupported: boolean;
  updateAvailable: boolean;
  recorderRevision: string | null;
  recorderImage?: string | null;
  latestImage?: string | null;
  latestAgentVersion?: string | null;
  updatedAt?: number | null;
  updateStatus: string;
  updateRequestedAt?: number | null;
  updateError: string | null;
  working: {
    playerName: string | null;
    clips: number;
    matchSlug: string | null;
    mapNumber: number;
    since: number;
  } | null;
  /** A live link to the platform (it is pushed work and reports progress). */
  linked?: boolean;
  /** What it is doing right now, over its link. */
  progress?: RecorderProgress | null;
}

export interface Run {
  id: number;
  kind: string;
  matchSlug: string | null;
  mapNumber: number | null;
  startedAt: number;
  seconds: number | null;
  ok: boolean;
  clips: number;
  rejected: number;
  /** Clips of the run that could not be recorded. */
  failed?: number;
  error: string | null;
}

export type TabKey = 'recorders' | 'clips' | 'overlays';

export const when = (s: number | null) => (s ? fmtDateTime(s) : '—');
export const duration = (s: number | null) =>
  s == null ? '—' : s >= 90 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;

export function Stat({ label, value }: { label: string; value: string }) {
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

/** "1440p120" as "1440p · 120 fps". */
export const quality = (q: string) => q.replace(/^(\d+)p(\d+)$/, '$1p · $2 fps');
