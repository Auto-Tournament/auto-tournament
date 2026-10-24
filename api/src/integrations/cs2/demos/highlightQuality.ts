import { settingsService } from '../../../services/settingsService';
import { HIGHLIGHT_BITRATES, HIGHLIGHT_FPS, HIGHLIGHT_HEIGHTS } from '../settings';

/** A size (height, 16:9) and frame rate. */
export interface HighlightCut {
  height: number;
  fps: number;
}

/** What the recorder makes highlight videos at: the highest quality, and the lower ones cut from it. */
export interface HighlightQuality extends HighlightCut {
  /** The bitrate ceiling (Mbit/s) an admin set; absent: the recorder works it out. */
  mbps?: number;
  /** The lower qualities, highest first; none: the highest alone. */
  cuts?: HighlightCut[];
}

/** Each lower quality's frame-rate cap: bandwidth grows with size and frame rate both. */
const CUT_FPS: Record<number, number> = { 1440: 120, 1080: 240, 720: 60, 480: 60 };

/**
 * The qualities below the highest (height × fps), down to minHeight: one per
 * offered height, each at no more than its cap and the highest's frame rate,
 * so each can be cut from the highest. Mirrored for the settings page in
 * client/src/pages/highlightQualityLadder.ts.
 */
export function qualityCuts(height: number, fps: number, minHeight: number): HighlightCut[] {
  return [...HIGHLIGHT_HEIGHTS]
    .filter((h) => h < height && h >= minHeight)
    .reverse()
    .map((h) => ({ height: h, fps: Math.min(CUT_FPS[h] ?? fps, fps) }));
}

/** A stored frame rate as one the recorder offers: rounded up (30, 90 and 180 were offered once). */
function offeredFps(n: number): number {
  return HIGHLIGHT_FPS.find((f) => f >= n && n > 0) ?? 240;
}

/** What the settings say, falling back to 720p at 240 fps (still 60 fps at 0.25x). */
export async function readHighlightQuality(): Promise<HighlightQuality> {
  const raw = Number(await settingsService.getSetting('highlights_resolution'));
  const height = (HIGHLIGHT_HEIGHTS as readonly number[]).includes(raw) ? raw : 720;
  const fps = offeredFps(Number(await settingsService.getSetting('highlights_fps')));
  const min = Number(await settingsService.getSetting('highlights_min_resolution'));
  const mbps = Number(await settingsService.getSetting('highlights_bitrate'));
  const cuts = qualityCuts(
    height,
    fps,
    (HIGHLIGHT_HEIGHTS as readonly number[]).includes(min) ? min : height
  );
  return {
    height,
    fps,
    ...(mbps > 0 && (HIGHLIGHT_BITRATES as readonly number[]).includes(mbps) ? { mbps } : {}),
    ...(cuts.length ? { cuts } : {}),
  };
}

/**
 * How a clip or reel records what it was made at: "1440p120", "1440p120 40M"
 * with a set bitrate, "1440p120 to 720p" with lower qualities. A change to any
 * of them makes the videos outdated.
 */
export function qualityLabel(q: HighlightQuality): string {
  const low = q.cuts?.at(-1);
  return `${q.height}p${q.fps}${q.mbps ? ` ${q.mbps}M` : ''}${low ? ` to ${low.height}p` : ''}`;
}

/** The settings page's fields. */
export async function highlightQuality(): Promise<{
  highlightsResolution: number;
  highlightsFps: number;
  highlightsBitrate: number;
}> {
  const q = await readHighlightQuality();
  return { highlightsResolution: q.height, highlightsFps: q.fps, highlightsBitrate: q.mbps ?? 0 };
}

/**
 * How big each reel gets (core's REEL_LIMITS in services/highlights/settings.ts,
 * read here through the settings service: the module reaches core only through
 * the host bridge). Each falls back to its default when unset or out of range.
 */
const REEL_LIMITS = {
  funnyPerPlayer: ['highlights_funny_per_player', 0, 4, 2],
  mapReelPerPlayer: ['highlights_map_reel_per_player', 1, 3, 1],
  seriesReelMax: ['highlights_series_reel_max', 2, 40, 16],
  seriesReelPerPlayer: ['highlights_series_reel_per_player', 1, 6, 2],
  teamReelPerPlayer: ['highlights_team_reel_per_player', 1, 6, 3],
  tournamentReelMax: ['highlights_tournament_reel_max', 4, 40, 16],
  tournamentReelPerPlayer: ['highlights_tournament_reel_per_player', 1, 6, 2],
} as const;
export type ReelLimits = Record<keyof typeof REEL_LIMITS, number>;

export async function readReelLimits(): Promise<ReelLimits> {
  const out = {} as ReelLimits;
  for (const [name, [key, min, max, fallback]] of Object.entries(REEL_LIMITS)) {
    const raw = await settingsService.getSetting(
      key as Parameters<typeof settingsService.getSetting>[0]
    );
    const n = raw === null || raw === undefined || raw.trim() === '' ? NaN : Number(raw);
    out[name as keyof ReelLimits] = Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  }
  return out;
}
