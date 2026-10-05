/**
 * Per-server switches sent as `cmd` (FLEET.md §7.4), each answered by one
 * `cmd.result`:
 *
 * - `whitelist.set {enabled, steamids?}`: the whitelist plugin's list and
 *   on/off (`unsupported` without whitelist.so; at most 1000 ids);
 * - `practice.set {on}`: practice mode (`unsupported` without practice.so,
 *   `bad_phase` while a match is loaded);
 * - `plugins.set {enable?, disable?}`: load / unload plugins, remembered
 *   across restarts (not `match` / `fleet`; at most 16 per list).
 *
 * The choice is stored per server (the Servers page shows it) and the
 * command's id is remembered so its answer can be shown.
 */

import { log } from '../../../../utils/logger';
import { sendReliable } from '../reliable';
import type { CmdPayload, HelloPayload } from '../protocol/v1';
import { isSteam64 } from './admins';
import {
  createdPluginSet,
  pluginSetCommand,
  pluginsStateDiffers,
  pluginsStateOf,
  type StoredPlugins,
} from './pluginSets';
import { readPrefs, recordPush, writePref } from './store';

export const MAX_WHITELIST = 1000;
export const MAX_PLUGINS_PER_LIST = 16;
const PLUGIN_NAME = /^[a-z0-9_-]{1,32}$/;
const PROTECTED_PLUGINS = new Set(['match', 'fleet']);
/** A practice switch that could not be delivered in 10 minutes is dropped (answered `expired`). */
const PRACTICE_TTL_MS = 10 * 60 * 1000;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateWhitelist(
  input: unknown
): Validated<{ enabled: boolean; steamids: string[] }> {
  if (!input || typeof input !== 'object')
    return { ok: false, error: 'body must be {enabled, steamids?}' };
  const { enabled, steamids } = input as { enabled?: unknown; steamids?: unknown };
  if (typeof enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false' };
  if (steamids === undefined || steamids === null)
    return { ok: true, value: { enabled, steamids: [] } };
  if (!Array.isArray(steamids))
    return { ok: false, error: 'steamids must be an array of SteamID64 strings' };
  const ids = [...new Set(steamids.map((s) => (typeof s === 'string' ? s.trim() : s)))];
  const bad = ids.filter((s) => !isSteam64(s));
  if (bad.length > 0)
    return { ok: false, error: `not a SteamID64: ${bad.slice(0, 3).map(String).join(', ')}` };
  if (ids.length > MAX_WHITELIST)
    return { ok: false, error: `at most ${MAX_WHITELIST} SteamID64s` };
  return { ok: true, value: { enabled, steamids: ids as string[] } };
}

export function validatePlugins(
  input: unknown
): Validated<{ enable: string[]; disable: string[] }> {
  if (!input || typeof input !== 'object')
    return { ok: false, error: 'body must be {enable?, disable?}' };
  const raw = input as { enable?: unknown; disable?: unknown };
  const out: { enable: string[]; disable: string[] } = { enable: [], disable: [] };
  for (const key of ['enable', 'disable'] as const) {
    const list = raw[key];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list))
      return { ok: false, error: `${key} must be an array of plugin names` };
    const names = [
      ...new Set(list.map((n) => (typeof n === 'string' ? n.trim().toLowerCase() : ''))),
    ];
    const bad = names.find((n) => !PLUGIN_NAME.test(n));
    if (bad !== undefined)
      return { ok: false, error: `${key}: "${bad}" is not a plugin name ([a-z0-9_-], 1-32)` };
    if (names.length > MAX_PLUGINS_PER_LIST)
      return { ok: false, error: `${key}: at most ${MAX_PLUGINS_PER_LIST} plugins` };
    out[key] = names;
  }
  const locked = out.disable.find((n) => PROTECTED_PLUGINS.has(n));
  if (locked) return { ok: false, error: `${locked} cannot be disabled over the fleet link` };
  const both = out.enable.find((n) => out.disable.includes(n));
  if (both) return { ok: false, error: `${both} is in both enable and disable` };
  if (out.enable.length === 0 && out.disable.length === 0)
    return { ok: false, error: 'nothing to enable or disable' };
  return { ok: true, value: out };
}

export type IssuedBy = CmdPayload['issued_by'];

async function sendCmd(
  serverId: string,
  payload: CmdPayload
): Promise<{ id: string; seq: number; delivered: boolean }> {
  const sent = await sendReliable(serverId, { type: 'cmd', payload });
  return { id: sent.id, seq: sent.seq, delivered: sent.delivered };
}

export async function setWhitelist(
  serverId: string,
  value: { enabled: boolean; steamids: string[] },
  issuedBy: IssuedBy,
  updatedBy: string | null
): Promise<{ id: string; seq: number; delivered: boolean }> {
  await writePref(serverId, 'whitelist', value, updatedBy);
  const sent = await sendCmd(serverId, {
    name: 'whitelist.set',
    args: { enabled: value.enabled, steamids: value.steamids },
    issued_by: issuedBy,
    expires_at: 0,
  });
  await recordPush(serverId, 'whitelist', { id: sent.id, seq: sent.seq });
  return sent;
}

export async function setPractice(
  serverId: string,
  on: boolean,
  issuedBy: IssuedBy,
  updatedBy: string | null
): Promise<{ id: string; seq: number; delivered: boolean }> {
  await writePref(serverId, 'practice', on, updatedBy);
  const sent = await sendCmd(serverId, {
    name: 'practice.set',
    args: { on },
    issued_by: issuedBy,
    expires_at: Date.now() + PRACTICE_TTL_MS,
  });
  await recordPush(serverId, 'practice', { id: sent.id, seq: sent.seq });
  return sent;
}

export async function setPlugins(
  serverId: string,
  value: StoredPlugins,
  issuedBy: IssuedBy,
  updatedBy: string | null
): Promise<{ id: string; seq: number; delivered: boolean }> {
  await writePref(serverId, 'plugins', value, updatedBy);
  const sent = await sendPluginsSet(serverId, value, issuedBy);
  // The Practice set is for a practice server: switch practice mode on, or
  // the match plugin (always loaded: the fleet link runs in it) leaves the
  // server in scrim warm-up. Sent after plugins.set, so practice.so is on.
  if (value.preset === 'practice') await setPractice(serverId, true, issuedBy, updatedBy);
  return sent;
}

/** Send a server its plugins.set lists (what is stored is not changed). */
async function sendPluginsSet(
  serverId: string,
  value: StoredPlugins,
  issuedBy: IssuedBy
): Promise<{ id: string; seq: number; delivered: boolean }> {
  const args: Record<string, unknown> = {};
  if (value.enable.length > 0) args.enable = value.enable;
  if (value.disable.length > 0) args.disable = value.disable;
  const sent = await sendCmd(serverId, {
    name: 'plugins.set',
    args,
    issued_by: issuedBy,
    expires_at: 0,
  });
  await recordPush(serverId, 'plugins', { id: sent.id, seq: sent.seq });
  return sent;
}

const PLATFORM_ISSUER: IssuedBy = { user_id: 'platform', name: 'Auto Tournament', root: false };

/**
 * After a server's welcome (./index.ts):
 *
 * - a server csm created that was never given plugins gets the set its
 *   `server.create` carried (the create's own set, or the fleet default at
 *   the time; ./pluginSets.ts);
 * - a server that was given plugins and whose hello `plugins_state` differs
 *   gets them again, unless that push has not reached it yet (its seq is
 *   past the hello's `last_rx_seq`: the outbox replay delivers it).
 */
export async function pluginsOnHello(
  serverId: string,
  hello: Pick<HelloPayload, 'plugins_state' | 'stream'>
): Promise<'initial' | 'resync' | null> {
  const prefs = await readPrefs(serverId);
  if (!prefs.plugins) {
    if (prefs.pushed.plugins) return null;
    const created = await createdPluginSet(serverId);
    if (!created.set) return null;
    await setPlugins(serverId, pluginSetCommand(created.set), PLATFORM_ISSUER, 'platform');
    log.info(
      `[FLEET] ${serverId}: plugin set ${created.set.preset} (${created.set.plugins.join(', ')}) sent after its first hello`
    );
    return 'initial';
  }
  const state = pluginsStateOf(hello);
  if (!state) return null;
  const last = prefs.pushed.plugins;
  if (last?.seq !== undefined && last.seq > hello.stream.last_rx_seq) return null;
  if (!pluginsStateDiffers(prefs.plugins, state)) return null;
  await sendPluginsSet(serverId, prefs.plugins, PLATFORM_ISSUER);
  log.info(`[FLEET] ${serverId}: its plugins differ from its plugin set; plugins.set sent again`);
  return 'resync';
}
