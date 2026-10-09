import { settingsService } from '../../../services/settingsService';
import { HIGHLIGHT_FPS, HIGHLIGHT_HEIGHTS } from '../settings';

/** The size (height, 16:9) and frame rate the recorder makes highlight videos at. */
export interface HighlightQuality {
  height: number;
  fps: number;
}

/** What the settings say, falling back to 1080p at 60 fps. */
export async function readHighlightQuality(): Promise<HighlightQuality> {
  const height = Number(await settingsService.getSetting('highlights_resolution'));
  const fps = Number(await settingsService.getSetting('highlights_fps'));
  return {
    height: (HIGHLIGHT_HEIGHTS as readonly number[]).includes(height) ? height : 1080,
    fps: (HIGHLIGHT_FPS as readonly number[]).includes(fps) ? fps : 60,
  };
}

/** How a clip or reel records what it was made at: "1440p120". */
export function qualityLabel(q: HighlightQuality): string {
  return `${q.height}p${q.fps}`;
}

/** The settings page's fields. */
export async function highlightQuality(): Promise<{
  highlightsResolution: number;
  highlightsFps: number;
}> {
  const q = await readHighlightQuality();
  return { highlightsResolution: q.height, highlightsFps: q.fps };
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
