/**
 * The highlight settings every game's recorder follows (core since the music
 * library and the Highlights page moved here; CS2 had them first, under the
 * same keys, so nothing stored changes):
 *
 * - highlights_resolution / highlights_fps: the highest size and frame rate
 *   the recorders make (720p240 unless set: smooth at 0.25x, and small);
 * - highlights_min_resolution: the lowest size; the qualities between are cut
 *   from the highest (the highest alone unless set);
 * - highlights_per_player: clips per player per map (6 unless set);
 * - highlights_watermark: the Auto Tournament logo (on unless "0");
 * - highlights_music: '' (every track), 'off', or the picked track ids;
 * - highlights_keep_clean: keep each clip's clean twin and overlay recipe
 *   (on unless "0");
 * - highlights_keep_masters: how long a video keeps its highest quality when
 *   lower ones were cut from it: '' always, 'reels' until its match's reels
 *   are made, or a number of days (cs2 demos/masterSweep.ts);
 * - highlights_mm / _mm_clips / _mm_min_kills / _mm_clutch: matchmaking's
 *   budget: on unless "0", clips per match (3; 0 every one), the fewest
 *   kills a play needs (3), and whether a clutch always counts (on);
 * - the reels' sizes (REEL_LIMITS): funny clips per player per map, clips per
 *   player in a map reel, a series reel's total and per player, a team reel's
 *   per player and a tournament reel's total and per player.
 */
import type { SettingDefinition } from '../../integrations/types';
import {
  booleanRequest,
  normalizeFlag,
  normalizeInteger,
  numberRequest,
  stringRequest,
} from '../../utils/settingFields';
import type { JsonValue } from '../../utils/json';

/** Highlight video heights (16:9) and frame rates the recorders offer. */
export const HIGHLIGHT_HEIGHTS = [480, 720, 1080, 1440, 2160] as const;
export const HIGHLIGHT_FPS = [60, 120, 240] as const;
/** Bitrate ceilings (Mbit/s) an admin can pick; 0 is automatic (from the size and frame rate). */
export const HIGHLIGHT_BITRATES = [0, 5, 10, 20, 40, 60] as const;
/** How long a video keeps its highest quality ('' always, 'reels', days). */
export const KEEP_MASTERS = ['', 'reels', '7', '30'] as const;
/** Matchmaking's clips per match an admin can pick (0: every one), and the fewest kills (5: an ace). */
export const MM_CLIPS = [0, 1, 2, 3, 5, 10] as const;
export const MM_MIN_KILLS = [2, 3, 4, 5] as const;

export type HighlightSettingKey =
  | 'highlights_watermark'
  | 'highlights_per_player'
  | 'highlights_resolution'
  | 'highlights_min_resolution'
  | 'highlights_fps'
  | 'highlights_bitrate'
  | 'highlights_music'
  | 'highlights_keep_clean'
  | 'highlights_keep_masters'
  | 'highlights_mm'
  | 'highlights_mm_clips'
  | 'highlights_mm_min_kills'
  | 'highlights_mm_clutch'
  | ReelLimitKey;

/**
 * How big each reel gets, and the funny clips: [key, settings field, min,
 * max, default]. Every game's reels read them (readReelLimits).
 */
export const REEL_LIMITS = [
  ['highlights_funny_per_player', 'highlightsFunnyPerPlayer', 0, 4, 2],
  ['highlights_map_reel_per_player', 'highlightsMapReelPerPlayer', 1, 3, 1],
  ['highlights_series_reel_max', 'highlightsSeriesReelMax', 2, 40, 16],
  ['highlights_series_reel_per_player', 'highlightsSeriesReelPerPlayer', 1, 6, 2],
  ['highlights_team_reel_per_player', 'highlightsTeamReelPerPlayer', 1, 6, 3],
  ['highlights_tournament_reel_max', 'highlightsTournamentReelMax', 4, 40, 16],
  ['highlights_tournament_reel_per_player', 'highlightsTournamentReelPerPlayer', 1, 6, 2],
] as const;
type ReelLimitKey = (typeof REEL_LIMITS)[number][0];
export type ReelLimits = Record<(typeof REEL_LIMITS)[number][1], number>;

/** The reels' sizes as set, each its default when unset or out of range. */
export async function readReelLimits(
  get: (key: string) => Promise<string | null | undefined>
): Promise<ReelLimits> {
  const out = {} as ReelLimits;
  for (const [key, field, min, max, fallback] of REEL_LIMITS) {
    const raw = await get(key);
    const n = raw === null || raw === undefined || raw.trim() === '' ? NaN : Number(raw);
    out[field] = Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  }
  return out;
}

/** A stored frame rate as one the recorders offer: rounded up (30, 90 and 180 were offered once); 240 unset. */
export function highlightFps(n: number): number {
  return HIGHLIGHT_FPS.find((f) => f >= n && n > 0) ?? 240;
}

/** A stored choice as a number, its fallback when unset (Number('') and Number(null) are 0, a real choice here). */
export const oneOf = (
  raw: string | null | undefined,
  options: readonly number[],
  fallback: number
) => {
  const n = raw === null || raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return options.includes(n) ? n : fallback;
};

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
      max: 20,
      message: 'highlights_per_player must be 1-20',
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
  choice(
    'highlights_min_resolution',
    'highlightsMinResolution',
    395,
    HIGHLIGHT_HEIGHTS,
    'Lowest highlight resolution'
  ),
  choice('highlights_fps', 'highlightsFps', 400, HIGHLIGHT_FPS, 'Highlight frame rate'),
  choice('highlights_bitrate', 'highlightsBitrate', 405, HIGHLIGHT_BITRATES, 'Highlight bitrate'),
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
  {
    key: 'highlights_keep_masters',
    field: 'highlightsKeepMasters',
    order: 425,
    normalize(trimmed) {
      const value = trimmed === 'always' ? '' : trimmed;
      if (!KEEP_MASTERS.includes(value as (typeof KEEP_MASTERS)[number])) {
        throw new Error(
          `highlights_keep_masters must be one of always, ${KEEP_MASTERS.slice(1).join(', ')}`
        );
      }
      return { value, message: 'How long highlights keep their highest quality updated' };
    },
    applyRequest: stringRequest('highlightsKeepMasters'),
  },
  {
    key: 'highlights_mm',
    field: 'highlightsMatchmaking',
    order: 426,
    normalize: normalizeFlag('Matchmaking highlights'),
    applyRequest: booleanRequest('highlightsMatchmaking'),
  },
  choice(
    'highlights_mm_clips',
    'highlightsMatchmakingClips',
    427,
    MM_CLIPS,
    'Clips per matchmaking match'
  ),
  choice(
    'highlights_mm_min_kills',
    'highlightsMatchmakingMinKills',
    428,
    MM_MIN_KILLS,
    'Fewest kills in a matchmaking clip'
  ),
  {
    key: 'highlights_mm_clutch',
    field: 'highlightsMatchmakingClutch',
    order: 429,
    normalize: normalizeFlag('Clutches always count in matchmaking'),
    applyRequest: booleanRequest('highlightsMatchmakingClutch'),
  },
  ...REEL_LIMITS.map(([key, field, min, max], i) => ({
    key,
    field,
    order: 430 + i * 10,
    normalize: normalizeInteger(key, { min, max, message: `${key} must be ${min}-${max}` }),
    applyRequest: numberRequest(field),
  })),
];

/** The settings page's highlight fields, as GET /api/settings answers them. */
export async function readHighlightSettings(
  get: (key: HighlightSettingKey) => Promise<string | null | undefined>
): Promise<Record<string, JsonValue>> {
  const raw = Number(await get('highlights_resolution'));
  const height = (HIGHLIGHT_HEIGHTS as readonly number[]).includes(raw) ? raw : 720;
  const min = Number(await get('highlights_min_resolution'));
  const fps = highlightFps(Number(await get('highlights_fps')));
  const mbps = Number(await get('highlights_bitrate'));
  return {
    highlightsWatermark: (await get('highlights_watermark'))?.trim() !== '0',
    highlightsPerPlayer: Number(await get('highlights_per_player')) || 6,
    highlightsResolution: height,
    highlightsMinResolution:
      (HIGHLIGHT_HEIGHTS as readonly number[]).includes(min) && min <= height ? min : height,
    highlightsFps: fps,
    highlightsBitrate: (HIGHLIGHT_BITRATES as readonly number[]).includes(mbps) ? mbps : 0,
    highlightsMusic: (await get('highlights_music'))?.trim() ?? '',
    highlightsKeepClean: (await get('highlights_keep_clean'))?.trim() !== '0',
    highlightsKeepMasters: (await get('highlights_keep_masters'))?.trim() ?? '',
    highlightsMatchmaking: (await get('highlights_mm'))?.trim() !== '0',
    highlightsMatchmakingClips: oneOf(await get('highlights_mm_clips'), MM_CLIPS, 3),
    highlightsMatchmakingMinKills: oneOf(await get('highlights_mm_min_kills'), MM_MIN_KILLS, 3),
    highlightsMatchmakingClutch: (await get('highlights_mm_clutch'))?.trim() !== '0',
    ...(await readReelLimits((key) => get(key as HighlightSettingKey))),
  };
}

/**
 * The logo on highlight videos. Free and unlicensed use always shows it; only
 * a paid (commercial) licence can turn it off with highlights_watermark "0".
 */
export async function highlightsWatermark(): Promise<boolean> {
  const { settingsService } = await import('../settingsService');
  if ((await settingsService.getSetting('highlights_watermark'))?.trim() !== '0') return true;
  const { licenseService } = await import('../license/licenseService');
  return (await licenseService.getPublicBadge()).use !== 'commercial';
}
