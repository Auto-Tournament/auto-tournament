/**
 * Ready Up plugin sets: which plugins a server runs, picked from presets
 * (Tournament, Practice, Fun) or ticked one by one, and applied with
 * `cmd plugins.set` (./controls.ts). Ready Up keeps the choice across
 * restarts (plugins.json).
 *
 * - The fleet default set (the 'plugins_default' row of `cs2_fleet_lists`,
 *   null = none) goes to every server csm creates: by an admin, by the
 *   scaler, or for a failover. A create can carry its own set instead. The
 *   set is stored with the `server.create` (`meta.plugins`) and pushed once
 *   the new server says hello (`pluginsOnHello`).
 * - A server whose hello `plugins_state` (Ready Up 0.x+, installed .so files
 *   and plugins.json) does not match the set it was given gets it again, as
 *   the other push lists do.
 * - `fleet` is always on: the fleet link runs in it. `match` is optional
 *   on a server whose fleet.so runs the platform commands itself
 *   (capability `fleet.cmds.v1`): the Practice set leaves it off, so the
 *   server starts in practice mode. Older Ready Up refuses to disable match:
 *   it stays on there (`sendPluginsSet`). A server whose set has match off
 *   is never handed a match (`matchPluginDisabled`, ../driver.ts).
 * - csm's default Ready Up bundle (essentials) has fleet, match, essentials
 *   and practice. A set with anything else makes the install after a create
 *   use the full bundle.
 */

import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import type { HelloPayload } from '../protocol/v1';
import type { Validated } from './controls';

/** The plugins an admin can pick, in display order. */
export const PLUGIN_CATALOG = [
  'fleet',
  'match',
  'essentials',
  'practice',
  'whitelist',
  'skins',
  'midas',
  'deathmatch',
  'addons',
] as const;
export type CatalogPlugin = (typeof PLUGIN_CATALOG)[number];

/** Always on: the fleet link runs in it (Ready Up refuses to disable it over the link). */
export const REQUIRED_PLUGINS: readonly CatalogPlugin[] = ['fleet'];

/** Ready Up's fleet.so runs plugins.set / practice.set {always} itself, so match can be off. */
export const FLEET_CMDS_CAPABILITY = 'fleet.cmds.v1';

/** What csm's default bundle (`essentials`) installs; anything else needs the full bundle. */
export const ESSENTIALS_BUNDLE_PLUGINS: readonly CatalogPlugin[] = [
  'fleet',
  'match',
  'essentials',
  'practice',
];

export const PLUGIN_PRESETS = {
  tournament: ['match', 'essentials', 'whitelist'],
  practice: ['practice', 'essentials'],
  fun: ['match', 'skins', 'midas', 'deathmatch', 'essentials'],
} as const satisfies Record<string, readonly CatalogPlugin[]>;

export type PluginPresetName = keyof typeof PLUGIN_PRESETS;
export type PluginPreset = PluginPresetName | 'custom';

export interface PluginSet {
  preset: PluginPreset;
  /** Every plugin that is on, required ones included, in catalog order. */
  plugins: CatalogPlugin[];
}

/** What a server was told (`cs2_fleet_server_prefs.plugins`): the cmd's lists, and the preset they came from. */
export interface StoredPlugins {
  enable: string[];
  disable: string[];
  preset?: PluginPreset;
}

/** hello.plugins_state. */
export interface PluginsState {
  installed: string[];
  disabled: string[];
}

const isCatalog = (n: string): n is CatalogPlugin =>
  (PLUGIN_CATALOG as readonly string[]).includes(n);
const isPreset = (n: unknown): n is PluginPresetName =>
  typeof n === 'string' && Object.prototype.hasOwnProperty.call(PLUGIN_PRESETS, n);

function inCatalogOrder(names: Iterable<string>): CatalogPlugin[] {
  const set = new Set(names);
  for (const r of REQUIRED_PLUGINS) set.add(r);
  return PLUGIN_CATALOG.filter((p) => set.has(p));
}

export function presetSet(preset: PluginPresetName): PluginSet {
  return { preset, plugins: inCatalogOrder(PLUGIN_PRESETS[preset]) };
}

/**
 * `{preset}` (a preset's plugins) or `{preset: 'custom', plugins}` from the
 * API. Required plugins are added; unknown names are an error.
 */
export function validatePluginSet(input: unknown): Validated<PluginSet> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { ok: false, error: 'plugins must be {preset, plugins?}' };
  const raw = input as { preset?: unknown; plugins?: unknown };
  const preset = raw.preset ?? 'custom';
  if (isPreset(preset)) return { ok: true, value: presetSet(preset) };
  if (preset !== 'custom')
    return {
      ok: false,
      error: `preset must be one of ${[...Object.keys(PLUGIN_PRESETS), 'custom'].join(', ')}`,
    };
  if (!Array.isArray(raw.plugins))
    return { ok: false, error: 'plugins must be an array of plugin names' };
  const names = raw.plugins.map((n) => (typeof n === 'string' ? n.trim().toLowerCase() : ''));
  const bad = names.find((n) => !isCatalog(n));
  if (bad !== undefined)
    return {
      ok: false,
      error: `"${bad}" is not a Ready Up plugin (${PLUGIN_CATALOG.join(', ')})`,
    };
  return { ok: true, value: { preset: 'custom', plugins: inCatalogOrder(names) } };
}

/** The plugins.set lists for a set: everything picked on, the rest of the catalog off. */
export function pluginSetCommand(set: PluginSet): StoredPlugins {
  const on = new Set<string>(inCatalogOrder(set.plugins));
  return {
    // fleet is the link itself: it is running, nothing to enable.
    enable: [...on].filter((n) => n !== 'fleet'),
    disable: PLUGIN_CATALOG.filter((n) => !on.has(n)),
    preset: set.preset,
  };
}

/** The set a stored plugins.set stands for (its enable list, required ones added). */
export function pluginSetFromStored(stored: StoredPlugins | null | undefined): PluginSet | null {
  if (!stored) return null;
  const plugins = inCatalogOrder(stored.enable.filter(isCatalog));
  const preset: PluginPreset =
    stored.preset && (stored.preset === 'custom' || isPreset(stored.preset))
      ? stored.preset
      : 'custom';
  return { preset, plugins };
}

/** csm's bundle for `host.update_plugins`: `skins` (full) when the set has a plugin essentials lacks. */
export function bundleFor(set: PluginSet | null | undefined): 'default' | 'skins' {
  if (!set) return 'default';
  return set.plugins.some((p) => !ESSENTIALS_BUNDLE_PLUGINS.includes(p)) ? 'skins' : 'default';
}

/** Picked plugins the server does not have (empty when its state is unknown). */
export function missingPlugins(
  plugins: readonly string[],
  state: PluginsState | null | undefined
): string[] {
  if (!state) return [];
  return plugins.filter((p) => !state.installed.includes(p));
}

/** Whether a server's hello state disagrees with what it was told (so it is told again). */
export function pluginsStateDiffers(stored: StoredPlugins, state: PluginsState): boolean {
  if (stored.enable.some((n) => state.disabled.includes(n))) return true;
  return stored.disable.some((n) => !state.disabled.includes(n));
}

/** hello.plugins_state when it is well formed, else null (older Ready Up has none). */
export function pluginsStateOf(hello: Pick<HelloPayload, 'plugins_state'>): PluginsState | null {
  const s = hello.plugins_state;
  if (!s || !Array.isArray(s.installed) || !Array.isArray(s.disabled)) return null;
  const names = (a: unknown[]) => a.filter((n): n is string => typeof n === 'string');
  return { installed: names(s.installed), disabled: names(s.disabled) };
}

/** Whether a fleet server announced `fleet.cmds.v1` in its last hello. */
export async function runsFleetCmds(fleetServerId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ capabilities: string | null }>(
    'SELECT capabilities FROM cs2_fleet_servers WHERE id = ?',
    [fleetServerId]
  );
  try {
    const caps = row?.capabilities ? (JSON.parse(row.capabilities) as unknown) : [];
    return Array.isArray(caps) && caps.includes(FLEET_CMDS_CAPABILITY);
  } catch {
    return false;
  }
}

/** A plugins.set for a server: older Ready Up refuses to disable match, so match stays on there. */
export function pluginsSetFor(value: StoredPlugins, fleetCmds: boolean): StoredPlugins {
  if (fleetCmds || !value.disable.includes('match')) return value;
  return { ...value, disable: value.disable.filter((n) => n !== 'match') };
}

/** The server's stored plugin set turns match off: it is not for matches (a practice server). */
export async function matchPluginDisabled(fleetServerId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ plugins: string | null }>(
    'SELECT plugins FROM cs2_fleet_server_prefs WHERE server_id = ?',
    [fleetServerId]
  );
  if (!row?.plugins) return false;
  try {
    const stored = JSON.parse(row.plugins) as Partial<StoredPlugins>;
    return Array.isArray(stored.disable) && stored.disable.includes('match');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The fleet default set
// ---------------------------------------------------------------------------

const nowS = () => Math.floor(Date.now() / 1000);

function parseSet(raw: string | null | undefined): PluginSet | null {
  if (!raw) return null;
  try {
    const check = validatePluginSet(JSON.parse(raw));
    return check.ok ? check.value : null;
  } catch {
    return null;
  }
}

export interface StoredDefaultPluginSet {
  set: PluginSet | null;
  updatedBy: string | null;
  updatedAt: number | null;
}

export async function getDefaultPluginSet(): Promise<StoredDefaultPluginSet> {
  const row = await db.queryOneAsync<{
    data: string | null;
    updated_by: string | null;
    updated_at: number | null;
  }>(`SELECT data, updated_by, updated_at FROM cs2_fleet_lists WHERE name = 'plugins_default'`);
  return {
    set: parseSet(row?.data),
    updatedBy: row?.updated_by ?? null,
    updatedAt:
      row?.updated_at === null || row?.updated_at === undefined ? null : Number(row.updated_at),
  };
}

/** Save the default set (null: new servers keep the plugins their bundle loads). */
export async function setDefaultPluginSet(
  set: PluginSet | null,
  actor: string | null
): Promise<StoredDefaultPluginSet> {
  await db.runAsync(
    `INSERT INTO cs2_fleet_lists (name, rev, data, updated_by, updated_at) VALUES ('plugins_default', 1, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET rev = cs2_fleet_lists.rev + 1, data = EXCLUDED.data,
         updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [set ? JSON.stringify(set) : null, actor, nowS()]
  );
  log.info(
    `[FLEET] default plugin set: ${set ? `${set.preset} (${set.plugins.join(', ')})` : 'none'} (by ${actor ?? 'unknown'})`
  );
  return getDefaultPluginSet();
}

/**
 * The set a new server is created with: the create's own, else the fleet
 * default (null = none). Kept with the `server.create` as `meta.plugins`.
 */
export async function pluginSetForCreate(
  explicit: PluginSet | null | undefined
): Promise<PluginSet | null> {
  if (explicit) return explicit;
  return (await getDefaultPluginSet()).set;
}

/** `meta.plugins` of the `server.create` whose enrollment key this server used, if any. */
export async function createdPluginSet(
  serverId: string
): Promise<{ created: boolean; set: PluginSet | null }> {
  const row = await db.queryOneAsync<{ meta: string | null }>(
    `SELECT c.meta FROM cs2_fleet_servers s
       JOIN cs2_fleet_enrollment_keys k ON k.id = s.enrollment_key_id
       JOIN cs2_fleet_host_commands c ON c.message_id = k.command_id
      WHERE s.id = ? AND c.type = 'server.create'`,
    [serverId]
  );
  if (!row) return { created: false, set: null };
  let meta: { plugins?: unknown } | null = null;
  try {
    meta = row.meta ? (JSON.parse(row.meta) as { plugins?: unknown }) : null;
  } catch {
    meta = null;
  }
  if (!meta?.plugins) return { created: true, set: null };
  const check = validatePluginSet(meta.plugins);
  return { created: true, set: check.ok ? check.value : null };
}
