/**
 * Per-server switches sent as `cmd` (FLEET.md §7.4), each answered by one
 * `cmd.result`:
 *
 * - `whitelist.set {enabled, steamids?}`: the whitelist plugin's list and
 *   on/off (`unsupported` without whitelist.so; at most 1000 ids);
 * - `practice.set {on?, always?}`: practice mode (`unsupported` without
 *   practice.so, `bad_phase` while a match is loaded); `always` makes it a
 *   practice server (practice on at every map; Ready Up with `fleet.cmds.v1`);
 * - `plugins.set {enable?, disable?}`: load / unload plugins, remembered
 *   across restarts (not `fleet`; `match` only with `fleet.cmds.v1`; at most
 *   16 per list).
 *
 * The choice is stored per server (the Servers page shows it) and the
 * command's id is remembered so its answer can be shown.
 */

import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import { sendReliable } from '../reliable';
import type { CmdPayload, HelloPayload } from '../protocol/v1';
import { isSteam64 } from './admins';
import {
  createdPluginSet,
  FLEET_CMDS_CAPABILITY,
  pluginSetCommand,
  pluginsSetFor,
  pluginsStateDiffers,
  pluginsStateOf,
  runsFleetCmds,
  type StoredPlugins,
} from './pluginSets';
import { readPrefs, recordPush, writePref } from './store';

export const MAX_WHITELIST = 1000;
export const MAX_PLUGINS_PER_LIST = 16;
const PLUGIN_NAME = /^[a-z0-9_-]{1,32}$/;
const PROTECTED_PLUGINS = new Set(['fleet']);
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

/** `practice.set {always}` alone: a practice server or not (no stored choice changes). */
async function sendPracticeAlways(
  serverId: string,
  always: boolean,
  issuedBy: IssuedBy
): Promise<void> {
  await sendCmd(serverId, {
    name: 'practice.set',
    args: { always },
    issued_by: issuedBy,
    expires_at: Date.now() + PRACTICE_TTL_MS,
  });
}

export async function setPlugins(
  serverId: string,
  value: StoredPlugins,
  issuedBy: IssuedBy,
  updatedBy: string | null
): Promise<{ id: string; seq: number; delivered: boolean }> {
  await writePref(serverId, 'plugins', value, updatedBy);
  const fleetCmds = await runsFleetCmds(serverId);
  const sent = await sendPluginsSet(serverId, value, issuedBy, fleetCmds);
  // Sent after plugins.set, so practice.so is loaded. The Practice set is a
  // practice server: practice on, and always=1 so it stays on at every map
  // (Ready Up without fleet.cmds.v1 keeps match loaded and takes `on` only).
  // Any other set with practice in it is not one: always off again.
  if (value.preset === 'practice') {
    await writePref(serverId, 'practice', true, updatedBy);
    const practice = await sendCmd(serverId, {
      name: 'practice.set',
      args: fleetCmds ? { on: true, always: true } : { on: true },
      issued_by: issuedBy,
      expires_at: Date.now() + PRACTICE_TTL_MS,
    });
    await recordPush(serverId, 'practice', { id: practice.id, seq: practice.seq });
  } else if (fleetCmds && value.enable.includes('practice')) {
    await sendPracticeAlways(serverId, false, issuedBy);
  }
  return sent;
}

/** Send a server its plugins.set lists (what is stored is not changed). */
async function sendPluginsSet(
  serverId: string,
  stored: StoredPlugins,
  issuedBy: IssuedBy,
  fleetCmds: boolean
): Promise<{ id: string; seq: number; delivered: boolean }> {
  const value = pluginsSetFor(stored, fleetCmds);
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
 * A server csm created (an admin's Create server, not only the scaler's or a
 * failover's) joins the match pool on its first hello, unless its plugin set
 * turns match off (a practice server). Once: a cs2_servers row for it means
 * it was linked before, and an admin's unlink keeps that row, so it sticks.
 */
async function linkCreatedOnce(serverId: string): Promise<void> {
  // The scaler and failover link what they create themselves (with their own records).
  const cmd = await db.queryOneAsync<{ issued_by: string | null }>(
    `SELECT c.issued_by FROM cs2_fleet_servers s
       JOIN cs2_fleet_enrollment_keys k ON k.id = s.enrollment_key_id
       JOIN cs2_fleet_host_commands c ON c.message_id = k.command_id
      WHERE s.id = ? AND c.type = 'server.create'`,
    [serverId]
  );
  if (!cmd || cmd.issued_by === 'autoscale' || (cmd.issued_by ?? '').startsWith('platform:')) return;
  const created = await createdPluginSet(serverId);
  if (!created.created) return;
  if (created.set && !created.set.plugins.includes('match')) return;
  const seen = await db.queryOneAsync<{ id: string }>(
    'SELECT id FROM cs2_servers WHERE id = ? OR fleet_server_id = ?',
    [serverId, serverId]
  );
  if (seen) return;
  const { linkFleetServer } = await import('../link');
  const outcome = await linkFleetServer(serverId);
  if (outcome.ok) log.info(`[FLEET] ${serverId}: created through csm; joined the match pool`);
  else log.warn(`[FLEET] ${serverId}: created through csm but not linked: ${outcome.error}`);
}

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
  hello: Pick<HelloPayload, 'plugins_state' | 'stream'> &
    Partial<Pick<HelloPayload, 'capabilities'>>
): Promise<'initial' | 'resync' | null> {
  await linkCreatedOnce(serverId);
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
  // This hello's capabilities: the stored ones may still be the previous Ready Up's.
  const fleetCmds = Array.isArray(hello.capabilities)
    ? hello.capabilities.includes(FLEET_CMDS_CAPABILITY)
    : await runsFleetCmds(serverId);
  if (!pluginsStateDiffers(pluginsSetFor(prefs.plugins, fleetCmds), state)) return null;
  await sendPluginsSet(serverId, prefs.plugins, PLATFORM_ISSUER, fleetCmds);
  log.info(`[FLEET] ${serverId}: its plugins differ from its plugin set; plugins.set sent again`);
  // A practice server that now runs without match (e.g. after a Ready Up
  // update to fleet.cmds.v1) needs practice on and always=1 again.
  if (fleetCmds && prefs.plugins.preset === 'practice') {
    await sendCmd(serverId, {
      name: 'practice.set',
      args: { on: true, always: true },
      issued_by: PLATFORM_ISSUER,
      expires_at: Date.now() + PRACTICE_TTL_MS,
    });
  }
  return 'resync';
}
