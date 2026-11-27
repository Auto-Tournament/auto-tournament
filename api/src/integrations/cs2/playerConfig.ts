/**
 * A player's CS2 config on their profile (the Config tab): what Ready Up reads from the game
 * (`player.config` over the fleet link: the crosshair share code and a fixed list of cvars), and
 * the gear and screen the player fills in themselves (the game can't tell those).
 *
 * On by default; the player can turn it off on their own Config tab. Off hides it from everyone
 * else and the platform drops what servers send for them.
 *
 * The pure parts (CONFIG_CVARS, cleanCvars, cleanGear, autoexec) are tested on their own.
 */

import { db } from '../../config/database';
import type { Untrusted } from '../../utils/untrusted';

/**
 * The cvars Ready Up asks for, in the order the autoexec writes them. CS2 does not answer
 * queries for cl_crosshairgap, cl_crosshair_outlinethickness, cl_crosshaircolor,
 * cl_crosshairusealpha and cl_crosshairgap_useweaponvalue: the crosshair code carries those.
 */
export const CONFIG_CVARS = [
  // Mouse
  'sensitivity',
  'zoom_sensitivity_ratio',
  // Crosshair (the code carries the rest)
  'cl_crosshairstyle',
  'cl_crosshairsize',
  'cl_crosshairthickness',
  'cl_crosshairdot',
  'cl_crosshair_drawoutline',
  'cl_crosshair_t',
  'cl_crosshaircolor_r',
  'cl_crosshaircolor_g',
  'cl_crosshaircolor_b',
  'cl_crosshairalpha',
  // Viewmodel
  'viewmodel_fov',
  'viewmodel_offset_x',
  'viewmodel_offset_y',
  'viewmodel_offset_z',
  'viewmodel_presetpos',
  'cl_prefer_lefthanded',
  // HUD and radar
  'hud_scaling',
  'cl_hud_color',
  'cl_radar_scale',
  'cl_radar_always_centered',
  'cl_radar_rotate',
  'cl_hud_radar_scale',
  'cl_radar_square_with_scoreboard',
  // Video (what the game knows)
  'fps_max',
] as const;

export type ConfigCvar = (typeof CONFIG_CVARS)[number];

const CVAR_SET = new Set<string>(CONFIG_CVARS);
const VALUE_RE = /^-?[0-9]{1,6}(\.[0-9]{1,6})?$/;
const CODE_RE = /^CSGO(-[A-Za-z0-9]{5}){5}$/;

/** Only the listed cvars, each a plain number (every one of them is). */
export function cleanCvars(raw: Untrusted): Partial<Record<ConfigCvar, string>> {
  const out: Partial<Record<ConfigCvar, string>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, value] of Object.entries(raw as Record<string, Untrusted>)) {
    if (!CVAR_SET.has(name) || typeof value !== 'string') continue;
    const v = value.trim();
    if (VALUE_RE.test(v)) out[name as ConfigCvar] = v;
  }
  return out;
}

/** A crosshair share code (CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx), or null. */
export function cleanCode(raw: Untrusted): string | null {
  return typeof raw === 'string' && CODE_RE.test(raw.trim()) ? raw.trim() : null;
}

export interface Gear {
  mouse?: string;
  keyboard?: string;
  monitor?: string;
  headset?: string;
  mousepad?: string;
  dpi?: number;
  pollingHz?: number;
  resolution?: string;
  scaling?: 'native' | 'stretched' | 'black_bars';
  refreshHz?: number;
}

const GEAR_TEXT = ['mouse', 'keyboard', 'monitor', 'headset', 'mousepad'] as const;

/** What the player typed, trimmed and bounded; anything else is dropped. */
export function cleanGear(raw: Untrusted): Gear {
  const out: Gear = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, Untrusted>;
  for (const key of GEAR_TEXT) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 80);
  }
  const int = (v: Untrusted, min: number, max: number): number | undefined => {
    let n = NaN;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string') n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
  const dpi = int(r.dpi, 50, 64000);
  if (dpi !== undefined) out.dpi = dpi;
  const polling = int(r.pollingHz, 125, 8000);
  if (polling !== undefined) out.pollingHz = polling;
  const refresh = int(r.refreshHz, 30, 1000);
  if (refresh !== undefined) out.refreshHz = refresh;
  if (typeof r.resolution === 'string' && /^\d{3,5}\s*[x×]\s*\d{3,5}$/.test(r.resolution.trim())) {
    out.resolution = r.resolution.trim().replace(/\s*[x×]\s*/, '×');
  }
  if (r.scaling === 'native' || r.scaling === 'stretched' || r.scaling === 'black_bars') {
    out.scaling = r.scaling;
  }
  return out;
}

/** The autoexec.cfg a visitor downloads: the cvars read from the game, then the crosshair code. */
export function autoexec(
  name: string,
  cvars: Partial<Record<ConfigCvar, string>>,
  code: string | null
): string {
  const lines = [`// ${name.replace(/[\r\n]/g, ' ')}'s CS2 config, from Auto Tournament`];
  for (const cvar of CONFIG_CVARS) {
    const v = cvars[cvar];
    if (v !== undefined) lines.push(`${cvar} "${v}"`);
  }
  if (code) lines.push(`apply_crosshair_code ${code}`);
  lines.push('host_writeconfig', '');
  return lines.join('\n');
}

export interface PlayerConfig {
  show: boolean;
  crosshairCode: string | null;
  cvars: Partial<Record<ConfigCvar, string>>;
  gear: Gear;
  /** Unix seconds when Ready Up last read it; null when it never has. */
  readAt: number | null;
}

interface Row {
  visible: boolean;
  crosshair_code: string | null;
  cvars: string | null;
  gear: string | null;
  read_at: number | null;
}

const parse = (s: string | null): Untrusted => {
  try {
    return JSON.parse(s ?? '{}');
  } catch {
    return {};
  }
};

export const playerConfigService = {
  async get(playerId: string): Promise<PlayerConfig> {
    const row = await db.queryOneAsync<Row>(
      'SELECT visible, crosshair_code, cvars, gear, read_at FROM cs2_player_config WHERE player_id = ?',
      [playerId]
    );
    return {
      show: row ? row.visible !== false : true,
      crosshairCode: row?.crosshair_code ?? null,
      cvars: cleanCvars(parse(row?.cvars ?? null)),
      gear: cleanGear(parse(row?.gear ?? null)),
      readAt: row?.read_at ?? null,
    };
  },

  async setShow(playerId: string, show: boolean): Promise<void> {
    await db.runAsync(
      `INSERT INTO cs2_player_config (player_id, visible, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (player_id) DO UPDATE SET visible = EXCLUDED.visible, updated_at = EXCLUDED.updated_at`,
      [playerId, show, Math.floor(Date.now() / 1000)]
    );
  },

  async setGear(playerId: string, gear: Gear): Promise<void> {
    await db.runAsync(
      `INSERT INTO cs2_player_config (player_id, gear, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (player_id) DO UPDATE SET gear = EXCLUDED.gear, updated_at = EXCLUDED.updated_at`,
      [playerId, JSON.stringify(gear), Math.floor(Date.now() / 1000)]
    );
  },

  /**
   * What a server read from the game. Dropped when the player turned their config off, or has
   * no account here. Returns whether it was stored.
   */
  async ingest(
    steamid64: string,
    code: string | null,
    cvars: Partial<Record<ConfigCvar, string>>
  ): Promise<boolean> {
    const player = await db.queryOneAsync<{ id: string }>('SELECT id FROM players WHERE id = ?', [
      steamid64,
    ]);
    if (!player) return false;
    const current = await this.get(steamid64);
    if (!current.show) return false;
    if (!code && Object.keys(cvars).length === 0) return false;
    const now = Math.floor(Date.now() / 1000);
    await db.runAsync(
      `INSERT INTO cs2_player_config (player_id, crosshair_code, cvars, read_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (player_id) DO UPDATE SET
         crosshair_code = COALESCE(EXCLUDED.crosshair_code, cs2_player_config.crosshair_code),
         cvars = EXCLUDED.cvars, read_at = EXCLUDED.read_at, updated_at = EXCLUDED.updated_at`,
      [steamid64, code, JSON.stringify({ ...current.cvars, ...cvars }), now, now]
    );
    return true;
  },
};
