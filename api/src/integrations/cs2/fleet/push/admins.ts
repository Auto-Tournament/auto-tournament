/**
 * `admins.set` (FLEET.md §7.5, D5, D13): one fleet-wide list of in-game
 * admins, built from the platform's admins (`players.is_admin`) plus extra
 * in-game-only admins an operator adds on the Servers page (referees who do
 * not administer the website). Ready Up uses it for `is_admin` in fleet mode
 * and refuses `.ru admins add|remove`.
 *
 * - The list has a rev (`cs2_fleet_lists` 'admins'), bumped whenever the list
 *   it is built from changes (sha256 of the sorted list). Ready Up keeps the
 *   highest rev it has seen and ignores a lower one, so the rev only grows;
 *   a server holding a higher rev (a platform database reset) raises ours.
 * - Pushed to every enrolled server when it changes (online now, or from the
 *   outbox at its next connect), and after a hello whose `admins_rev` is not
 *   ours (unless the current rev is still waiting in that server's outbox).
 */

import crypto from 'crypto';
import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import { getStreamState } from '../registry';
import { sendReliable } from '../reliable';
import type { AdminsSetPayload } from '../protocol/v1';
import {
  bumpListIfChanged,
  enrolledServerIds,
  raiseListRev,
  readList,
  readPrefs,
  recordPush,
  writeListData,
  type PushRecord,
} from './store';

export interface FleetAdmin {
  steamid64: string;
  name: string;
}

/** admins.set.json: at most 1000 entries, names up to 128 characters. */
export const MAX_FLEET_ADMINS = 1000;
const NAME_MAX = 128;
const STEAM64 = /^\d{17}$/;

export function isSteam64(value: unknown): value is string {
  return typeof value === 'string' && STEAM64.test(value);
}

function cleanName(name: unknown, fallback: string): string {
  // Control characters (C0, DEL) out of a display name.
  const text =
    typeof name === 'string'
      ? [...name]
          .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
          .join('')
          .trim()
      : '';
  return (text || fallback).slice(0, NAME_MAX);
}

/**
 * The list Ready Up gets: platform admins first (their names win), then the
 * extra in-game admins; Steam64 ids only, one entry each, sorted by id so the
 * hash does not depend on query order. `dropped` counts entries left out
 * (not a Steam64 id, or over the 1000 cap).
 */
export function buildAdminList(
  platformAdmins: ReadonlyArray<{ id: string; name?: string | null }>,
  extras: ReadonlyArray<{ steamid64: string; name?: string | null }> = []
): { admins: FleetAdmin[]; dropped: number } {
  const byId = new Map<string, FleetAdmin>();
  let dropped = 0;
  for (const p of platformAdmins) {
    if (!isSteam64(p.id)) {
      dropped += 1;
      continue;
    }
    if (!byId.has(p.id)) byId.set(p.id, { steamid64: p.id, name: cleanName(p.name, p.id) });
  }
  for (const e of extras) {
    if (!isSteam64(e.steamid64)) {
      dropped += 1;
      continue;
    }
    if (!byId.has(e.steamid64))
      byId.set(e.steamid64, { steamid64: e.steamid64, name: cleanName(e.name, e.steamid64) });
  }
  const admins = [...byId.values()].sort((a, b) =>
    a.steamid64 < b.steamid64 ? -1 : a.steamid64 > b.steamid64 ? 1 : 0
  );
  if (admins.length > MAX_FLEET_ADMINS) {
    dropped += admins.length - MAX_FLEET_ADMINS;
    admins.length = MAX_FLEET_ADMINS;
  }
  return { admins, dropped };
}

export function adminListHash(admins: ReadonlyArray<FleetAdmin>): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(admins.map((a) => [a.steamid64, a.name])))
    .digest('hex');
}

/**
 * What to do after a server's hello (pure):
 * - `skip`: it has our rev, or our rev is still in its outbox (the replay
 *   after welcome delivers it);
 * - `push`: send the current list;
 * - `raise`: it holds a higher rev than ours (another database); raise ours
 *   above it, then push.
 */
export function adminsHelloAction(input: {
  platformRev: number;
  helloRev: number | undefined;
  /** Our last admins.set to this server, if any. */
  lastPush: PushRecord | undefined;
  /** The server's acked platform seq after the hello. */
  txAcked: number;
}): 'skip' | 'push' | 'raise' {
  const helloRev = input.helloRev ?? -1;
  if (helloRev > input.platformRev) return 'raise';
  if (helloRev === input.platformRev) return 'skip';
  const last = input.lastPush;
  if (
    last &&
    last.rev === input.platformRev &&
    typeof last.seq === 'number' &&
    last.seq > input.txAcked
  )
    return 'skip';
  return 'push';
}

/** Extra in-game admins (not website admins), from the Servers page. */
export async function getExtraAdmins(): Promise<FleetAdmin[]> {
  const row = await readList('admins');
  return Array.isArray(row.data)
    ? (row.data as FleetAdmin[]).filter((a) => isSteam64(a?.steamid64))
    : [];
}

async function currentList(): Promise<{ admins: FleetAdmin[]; dropped: number }> {
  const rows = await db.queryAsync<{ id: string; name: string }>(
    'SELECT id, name FROM players WHERE is_admin = 1 ORDER BY id ASC',
    []
  );
  return buildAdminList(rows, await getExtraAdmins());
}

let chain: Promise<unknown> = Promise.resolve();
/** One sync at a time in this process (the rev bump itself is a single CAS statement). */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export interface AdminsState {
  rev: number;
  admins: FleetAdmin[];
  dropped: number;
  extras: FleetAdmin[];
}

export async function getAdminsState(): Promise<AdminsState> {
  const [row, list, extras] = await Promise.all([
    readList('admins'),
    currentList(),
    getExtraAdmins(),
  ]);
  return { rev: row.rev, admins: list.admins, dropped: list.dropped, extras };
}

/**
 * Rebuild the list; when it changed, bump the rev and push it to every
 * enrolled server. Returns the rev and whether it changed.
 */
export function syncAdmins(
  reason: string
): Promise<{ rev: number; changed: boolean; pushed: number }> {
  return serialized(async () => {
    const list = await currentList();
    const bumped = await bumpListIfChanged('admins', adminListHash(list.admins));
    if (bumped === null) return { rev: (await readList('admins')).rev, changed: false, pushed: 0 };
    if (list.dropped > 0)
      log.warn(
        `[FLEET] admins.set: ${list.dropped} entr${list.dropped === 1 ? 'y' : 'ies'} left out (not a Steam64 id, or over ${MAX_FLEET_ADMINS})`
      );
    const pushed = await pushAdminsToAll(bumped, list.admins);
    log.info(
      `[FLEET] admins.set rev ${bumped} (${list.admins.length} admin(s), ${reason}) → ${pushed} server(s)`
    );
    return { rev: bumped, changed: true, pushed };
  });
}

async function pushAdminsToAll(rev: number, admins: FleetAdmin[]): Promise<number> {
  let n = 0;
  for (const serverId of await enrolledServerIds()) {
    try {
      await pushAdmins(serverId, rev, admins);
      n += 1;
    } catch (error) {
      log.warn(
        `[FLEET] ${serverId}: admins.set rev ${rev} not queued: ${(error as Error).message}`
      );
    }
  }
  return n;
}

export async function pushAdmins(
  serverId: string,
  rev: number,
  admins: FleetAdmin[]
): Promise<void> {
  const payload: AdminsSetPayload = { rev, admins };
  const sent = await sendReliable(serverId, { type: 'admins.set', payload });
  await recordPush(serverId, 'admins', { rev, seq: sent.seq });
}

/** Replace the extra in-game admins, then sync (bumps and pushes when the list changed). */
export async function setExtraAdmins(
  extras: FleetAdmin[],
  updatedBy: string | null
): Promise<{ rev: number; changed: boolean; pushed: number }> {
  await writeListData('admins', extras, updatedBy);
  return syncAdmins('extra admins edited');
}

/** After a server's hello: bring its list up to date when its `admins_rev` is not ours. */
export function adminsOnHello(
  serverId: string,
  helloRev: number | undefined
): Promise<'skip' | 'push' | 'raise'> {
  return serialized(async () => {
    const list = await currentList();
    // A list that changed while nothing noticed (a direct database edit):
    // a new rev, for every server (this one included).
    const bumped = await bumpListIfChanged('admins', adminListHash(list.admins));
    if (bumped !== null) {
      await pushAdminsToAll(bumped, list.admins);
      return 'push';
    }
    const rev = (await readList('admins')).rev;
    const [prefs, stream] = await Promise.all([readPrefs(serverId), getStreamState(serverId)]);
    const action = adminsHelloAction({
      platformRev: rev,
      helloRev,
      lastPush: prefs.pushed.admins,
      txAcked: stream.txAcked,
    });
    if (action === 'skip') return action;
    if (action === 'raise') {
      // Every server must see a rev above the one this server holds.
      const raised = await raiseListRev('admins', (helloRev ?? 0) + 1);
      log.info(
        `[FLEET] ${serverId} holds admins rev ${helloRev}; the platform's list is now rev ${raised}`
      );
      await pushAdminsToAll(raised, list.admins);
      return action;
    }
    await pushAdmins(serverId, rev, list.admins);
    return action;
  });
}
