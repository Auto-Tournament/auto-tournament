import { settingsService } from '../../../services/settingsService';
import { HIGHLIGHT_BITRATES, HIGHLIGHT_FPS, HIGHLIGHT_HEIGHTS } from '../settings';

/** The size (height, 16:9) and frame rate the recorder makes highlight videos at. */
export interface HighlightQuality {
  height: number;
  fps: number;
  /** The bitrate ceiling (Mbit/s) an admin set; absent: the recorder works it out. */
  mbps?: number;
}

/** What the settings say, falling back to 720p at 240 fps (still 60 fps at 0.25x). */
export async function readHighlightQuality(): Promise<HighlightQuality> {
  const height = Number(await settingsService.getSetting('highlights_resolution'));
  const fps = Number(await settingsService.getSetting('highlights_fps'));
  const mbps = Number(await settingsService.getSetting('highlights_bitrate'));
  return {
    height: (HIGHLIGHT_HEIGHTS as readonly number[]).includes(height) ? height : 720,
    fps: (HIGHLIGHT_FPS as readonly number[]).includes(fps) ? fps : 240,
    ...(mbps > 0 && (HIGHLIGHT_BITRATES as readonly number[]).includes(mbps) ? { mbps } : {}),
  };
}

/** How a clip or reel records what it was made at: "1440p120", or "1440p120 40M" with a set bitrate. */
export function qualityLabel(q: HighlightQuality): string {
  return `${q.height}p${q.fps}${q.mbps ? ` ${q.mbps}M` : ''}`;
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
