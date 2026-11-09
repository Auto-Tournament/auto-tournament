/**
 * Saved setups (Servers › Setups): what a free server runs when an admin starts one on it, a
 * Ready Up plugin set and a map pool (the first map loads, the map vote picks from the rest).
 * No console lines or launch options: csm and Ready Up own those. Starting and stopping a setup
 * on a server is a separate step.
 */
import { db } from '../../config/database';
import type { Untrusted } from '../../utils/untrusted';
import { validatePluginSet, type PluginSet } from './fleet/push/pluginSets';

export interface ServerSetup {
  id: string;
  name: string;
  plugins: PluginSet;
  /** Map names or "workshop/<id>[/<name>]"; the first one loads when the setup starts. */
  maps: string[];
  updatedAt: number;
}

/** At most this many setups, and maps in one (Ready Up's mapvote.set takes 64). */
export const MAX_SETUPS = 20;
export const MAX_SETUP_MAPS = 64;

/**
 * A map entry as Ready Up's map vote and essentials take it (pure: tested on its own): a map
 * name, or "workshop/<id>[/<name>]" from a Workshop id, a "ws:<id>" entry or a Workshop link.
 * Null when it is none of them.
 */
export function mapEntryOf(raw: Untrusted): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const link =
    /^https?:\/\/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/\?(?:.*&)?id=(\d{6,12})(?:&|$)/i.exec(
      s
    );
  if (link) return `workshop/${link[1]}`;
  const id = /^(?:ws:)?(\d{6,12})$/.exec(s);
  if (id) return `workshop/${id[1]}`;
  if (/^workshop\/\d{6,12}(?:\/[A-Za-z0-9_.-]{1,64})?$/.test(s)) return s;
  if (/^[A-Za-z0-9_.-]{1,64}$/.test(s)) return s;
  return null;
}

/** A setup from a request (pure): name, plugin set and maps, each checked. */
export function setupOf(raw: Untrusted): {
  setup?: { name: string; plugins: PluginSet; maps: string[] };
  error?: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'A setup object' };
  const body = raw as { name?: Untrusted; plugins?: Untrusted; maps?: Untrusted };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 40 || !setupIdOf(name))
    return { error: 'A name of 1 to 40 letters or digits' };
  const plugins = validatePluginSet(body.plugins);
  if (!plugins.ok) return { error: plugins.error };
  if (!Array.isArray(body.maps) || body.maps.length === 0)
    return { error: 'maps: at least one map name or Workshop map' };
  if (body.maps.length > MAX_SETUP_MAPS) return { error: `maps: at most ${MAX_SETUP_MAPS}` };
  const maps: string[] = [];
  for (const m of body.maps) {
    const entry = mapEntryOf(m);
    if (!entry)
      return { error: `maps: "${String(m).slice(0, 80)}" is not a map name or Workshop map` };
    if (!maps.includes(entry)) maps.push(entry);
  }
  return { setup: { name, plugins: plugins.value, maps } };
}

/** A setup's id from its name: lower case, dashes ("Aim deathmatch" -> "aim-deathmatch"). */
export function setupIdOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

interface Row {
  id: string;
  name: string;
  plugins: string;
  maps: string;
  updated_at: number;
}

export async function listSetups(): Promise<ServerSetup[]> {
  const rows = await db.queryAsync<Row>(
    'SELECT id, name, plugins, maps, updated_at FROM cs2_server_setups ORDER BY name'
  );
  const out: ServerSetup[] = [];
  for (const r of rows) {
    try {
      const { setup } = setupOf({
        name: r.name,
        plugins: JSON.parse(r.plugins),
        maps: JSON.parse(r.maps),
      });
      if (setup) out.push({ id: r.id, ...setup, updatedAt: Number(r.updated_at) });
    } catch {
      // A row that no longer parses is left out rather than breaking the list.
    }
  }
  return out;
}

/** Saves (or replaces, same name) a setup; null when the list is full. */
export async function saveSetup(setup: {
  name: string;
  plugins: PluginSet;
  maps: string[];
}): Promise<ServerSetup | null> {
  const id = setupIdOf(setup.name);
  const now = Math.floor(Date.now() / 1000);
  const others = await db.queryOneAsync<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM cs2_server_setups WHERE id <> ?',
    [id]
  );
  if ((others?.n ?? 0) >= MAX_SETUPS) return null;
  await db.runAsync(
    `INSERT INTO cs2_server_setups (id, name, plugins, maps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, plugins = EXCLUDED.plugins,
       maps = EXCLUDED.maps, updated_at = EXCLUDED.updated_at`,
    [id, setup.name, JSON.stringify(setup.plugins), JSON.stringify(setup.maps), now, now]
  );
  return { id, ...setup, updatedAt: now };
}

export async function deleteSetup(id: string): Promise<boolean> {
  const r = await db.runAsync('DELETE FROM cs2_server_setups WHERE id = ?', [id]);
  return r.changes > 0;
}
