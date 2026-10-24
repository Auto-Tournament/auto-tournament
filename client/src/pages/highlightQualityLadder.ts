/**
 * The highlight qualities, for the settings page: the highest as set and the
 * lower ones the recorders cut from it. Mirrors the api's qualityCuts
 * (integrations/cs2/demos/highlightQuality.ts), which the recorders follow.
 */
export const HIGHLIGHT_HEIGHTS = [480, 720, 1080, 1440, 2160] as const;
export const HIGHLIGHT_FPS = [60, 120, 240] as const;
/** Bitrate ceilings (Mbit/s; api: HIGHLIGHT_BITRATES); 0 is automatic. */
export const HIGHLIGHT_BITRATES = [0, 5, 10, 20, 40, 60] as const;

export interface Cut {
  height: number;
  fps: number;
}

/** Each lower quality's frame-rate cap. */
const CUT_FPS: Record<number, number> = { 1440: 120, 1080: 240, 720: 60, 480: 60 };

/** The highest quality, then one per height below it down to minHeight, highest first. */
export function qualityLadder(height: number, fps: number, minHeight: number): Cut[] {
  const lower = [...HIGHLIGHT_HEIGHTS]
    .filter((h) => h < height && h >= minHeight)
    .reverse()
    .map((h) => ({ height: h, fps: Math.min(CUT_FPS[h] ?? fps, fps) }));
  return [{ height, fps }, ...lower];
}

export const heightName = (h: number) => (h === 2160 ? '4K' : `${h}p`);

/** About how many Mbit/s a quality takes at the automatic bitrate (an estimate for the page). */
export function estimatedMbps({ height, fps }: Cut): number {
  const at60: Record<number, number> = { 2160: 35, 1440: 16, 1080: 6, 720: 3, 480: 1.5 };
  return Math.round((at60[height] ?? 6) * Math.pow(fps / 60, 0.6) * 10) / 10;
}

/** About how long recording takes against 1080p at 120 fps: it grows with the pixels and frames rendered. */
export function recordingFactor({ height, fps }: Cut): number {
  return Math.round(Math.max(0.2, (height / 1080) ** 2 * (fps / 120)) * 10) / 10;
}
