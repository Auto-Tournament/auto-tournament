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

/** The settings page's fields. */
export async function highlightQuality(): Promise<{ highlightsResolution: number; highlightsFps: number }> {
  const q = await readHighlightQuality();
  return { highlightsResolution: q.height, highlightsFps: q.fps };
}
