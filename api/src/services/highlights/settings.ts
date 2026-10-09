/**
 * The highlight settings every game's recorder follows (core since the music
 * library and the Highlights page moved here; CS2 had them first, under the
 * same keys, so nothing stored changes):
 *
 * - highlights_resolution / highlights_fps: the size and frame rate the
 *   recorders make (1080p60 unless set);
 * - highlights_per_player: clips per player per map (6 unless set);
 * - highlights_watermark: the Auto Tournament logo (on unless "0");
 * - highlights_music: '' (every track), 'off', or the picked track ids;
 * - highlights_keep_clean: keep each clip's clean twin and overlay recipe
 *   (on unless "0").
 */
import type { SettingDefinition } from '../../integrations/types';
import {
  booleanRequest,
  normalizeFlag,
  normalizeInteger,
  numberRequest,
  stringRequest,
} from '../../utils/settingFields';

/** Highlight video heights (16:9) and frame rates the recorders offer. */
export const HIGHLIGHT_HEIGHTS = [720, 1080, 1440, 2160] as const;
export const HIGHLIGHT_FPS = [30, 60, 90, 120, 180, 240] as const;

export type HighlightSettingKey =
  | 'highlights_watermark'
  | 'highlights_per_player'
  | 'highlights_resolution'
  | 'highlights_fps'
  | 'highlights_music'
  | 'highlights_keep_clean';

function choice(
  key: HighlightSettingKey,
  field: string,
  order: number,
  options: readonly number[],
  what: string
): SettingDefinition & { key: HighlightSettingKey } {
  const list = options.join(', ');
  return {
    key,
    field,
    order,
    normalize(trimmed) {
      if (!options.map(String).includes(trimmed)) throw new Error(`${key} must be one of ${list}`);
      return { value: trimmed, message: `${what} set to ${trimmed}` };
    },
    applyRequest: numberRequest(field, `one of ${list}`),
  };
}

export const HIGHLIGHT_SETTINGS: ReadonlyArray<SettingDefinition & { key: HighlightSettingKey }> = [
  {
    key: 'highlights_watermark',
    field: 'highlightsWatermark',
    order: 370,
    normalize: normalizeFlag('Auto Tournament logo on highlight videos'),
    applyRequest: booleanRequest('highlightsWatermark'),
  },
  {
    key: 'highlights_per_player',
    field: 'highlightsPerPlayer',
    order: 380,
    normalize: normalizeInteger('highlights_per_player', {
      min: 1,
      max: 6,
      message: 'highlights_per_player must be 1-6',
    }),
    applyRequest: numberRequest('highlightsPerPlayer'),
  },
  choice(
    'highlights_resolution',
    'highlightsResolution',
    390,
    HIGHLIGHT_HEIGHTS,
    'Highlight resolution'
  ),
  choice('highlights_fps', 'highlightsFps', 400, HIGHLIGHT_FPS, 'Highlight frame rate'),
  {
    key: 'highlights_music',
    field: 'highlightsMusic',
    order: 410,
    normalize(trimmed) {
      if (!/^(all|off|\d+(,\d+)*)?$/.test(trimmed)) {
        throw new Error('highlights_music must be all, off, or track ids separated by commas');
      }
      return { value: trimmed === 'all' ? '' : trimmed, message: 'Highlight music updated' };
    },
    applyRequest: stringRequest('highlightsMusic'),
  },
  {
    key: 'highlights_keep_clean',
    field: 'highlightsKeepClean',
    order: 420,
    normalize: normalizeFlag('Clean copies of highlight clips'),
    applyRequest: booleanRequest('highlightsKeepClean'),
  },
];

/** The settings page's highlight fields, as GET /api/settings answers them. */
export async function readHighlightSettings(
  get: (key: HighlightSettingKey) => Promise<string | null | undefined>
): Promise<Record<string, unknown>> {
  const height = Number(await get('highlights_resolution'));
  const fps = Number(await get('highlights_fps'));
  return {
    highlightsWatermark: (await get('highlights_watermark'))?.trim() !== '0',
    highlightsPerPlayer: Number(await get('highlights_per_player')) || 6,
    highlightsResolution: (HIGHLIGHT_HEIGHTS as readonly number[]).includes(height) ? height : 1080,
    highlightsFps: (HIGHLIGHT_FPS as readonly number[]).includes(fps) ? fps : 60,
    highlightsMusic: (await get('highlights_music'))?.trim() ?? '',
    highlightsKeepClean: (await get('highlights_keep_clean'))?.trim() !== '0',
  };
}
