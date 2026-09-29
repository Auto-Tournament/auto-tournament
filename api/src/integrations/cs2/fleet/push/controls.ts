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

import { sendReliable } from '../reliable';
import type { CmdPayload } from '../protocol/v1';
import { isSteam64 } from './admins';
import { recordPush, writePref } from './store';

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
  value: { enable: string[]; disable: string[] },
  issuedBy: IssuedBy,
  updatedBy: string | null
): Promise<{ id: string; seq: number; delivered: boolean }> {
  await writePref(serverId, 'plugins', value, updatedBy);
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
