/**
 * `skins.loadout` (FLEET.md §7, D6): the platform's skins on a Ready Up
 * server. Sent when a player connects, and to everyone connected the moment
 * skins are switched on (an admin's "oops, forgot skins" works mid-round);
 * switching them off clears them (`skins.invalidate`) at once.
 *
 * Every server follows the platform: while skins are on there
 * (`skins_config.enabled`) each server's skins plugin is on
 * (./controls.ts syncSkinsPluginEverywhere) and gets the players' loadouts.
 * Only to a server that has the plugin running (`skins.v1` in its hello
 * capabilities) and no Steam server token (`hello.host.steam_token`; the
 * plugin itself stays inert with one). A tournament in esports mode plays
 * Ready Up's `valve` ruleset, where the plugin is inert for that match.
 */

import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import { skinService } from '../../skins/skinService';
import { sendReliable } from '../reliable';
import { getLiveState } from '../state';
import type { SkinsLoadoutPayload } from '../protocol/v1';

/** Whether this fleet server takes skins, and why not when it does not. */
export async function skinsTarget(
  fleetServerId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await db.queryOneAsync<{ capabilities: string | null; host: string | null }>(
    `SELECT f.capabilities, f.host FROM cs2_fleet_servers f WHERE f.id = ?`,
    [fleetServerId]
  );
  if (!row) return { ok: false, reason: 'unknown server' };
  const caps = (() => {
    try {
      return JSON.parse(row.capabilities ?? '[]') as string[];
    } catch {
      return [];
    }
  })();
  if (!caps.includes('skins.v1')) return { ok: false, reason: 'no skins plugin' };
  const host = (() => {
    try {
      return JSON.parse(row.host ?? '{}') as { steam_token?: boolean };
    } catch {
      return {};
    }
  })();
  if (host.steam_token === true)
    return { ok: false, reason: 'the server uses a Steam server token' };
  return { ok: true };
}

/** A player connected to a match on a fleet server: send their loadout if the map is not being played. */
export async function pushSkinsOnConnect(
  fleetServerId: string,
  matchSlug: string,
  steamid64: string
): Promise<void> {
  try {
    const target = await skinsTarget(fleetServerId);
    if (!target.ok) return;
    const items = await skinService.loadoutItems(steamid64);
    if (!items) {
      // Nothing equipped (or the last item just came off): the server drops what it had.
      await sendReliable(fleetServerId, { type: 'skins.invalidate', payload: { steamid64 } });
      return;
    }
    const payload: SkinsLoadoutPayload = { steamid64, rev: Math.floor(Date.now() / 1000), items };
    await sendReliable(fleetServerId, { type: 'skins.loadout', payload });
  } catch (error) {
    log.warn('[FLEET] skins: loadout not sent', {
      fleetServerId,
      matchSlug,
      error: (error as Error).message,
    });
  }
}

/**
 * A match was (re)assigned to a server: the players already on it get their loadout now. They
 * joined before the match, so no player_connect event will bring it (a reload after a restart
 * left a roster player with a vanilla knife, 2026-10-15).
 */
export async function pushSkinsForPresent(fleetServerId: string, matchSlug: string): Promise<void> {
  for (const id of presentOn.get(fleetServerId) ?? []) {
    await pushSkinsOnConnect(fleetServerId, matchSlug, id);
  }
}

/**
 * Who each server says is on it (ping.health.steamids). A server with no
 * match (skin tryout, practice) sends no player_connect event, so this is how
 * its players get their skins: a newcomer gets their loadout, and a change on
 * the site reaches them at once (pushLoadoutLive).
 */
const presentOn = new Map<string, Set<string>>();

/** A ping named the players on a server (null: its link closed). */
export async function playersSeen(fleetServerId: string, steamids: string[] | null): Promise<void> {
  if (steamids === null) {
    presentOn.delete(fleetServerId);
    return;
  }
  const before = presentOn.get(fleetServerId) ?? new Set<string>();
  const now = new Set(steamids.filter((id) => /^\d{17}$/.test(id)));
  presentOn.set(fleetServerId, now);
  const arrived = [...now].filter((id) => !before.has(id));
  if (arrived.length === 0) return;
  // A match's players get theirs from its player_connect events.
  if (await hasMatch(fleetServerId)) return;
  for (const id of arrived) await pushSkinsOnConnect(fleetServerId, '', id);
}

async function hasMatch(fleetServerId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ slug: string }>(
    "SELECT slug FROM matches WHERE server_id = ? AND status IN ('loaded', 'live') LIMIT 1",
    [fleetServerId]
  );
  return !!row;
}

/** The matches on a fleet server right now, with their connected players. */
async function connectedOn(
  fleetServerId: string
): Promise<Array<{ slug: string; steamid64: string }>> {
  const { playerConnectionService } = await import('../../../../services/playerConnectionService');
  const rows = await db.queryAsync<{ slug: string }>(
    "SELECT slug FROM matches WHERE server_id = ? AND status IN ('loaded', 'live')",
    [fleetServerId]
  );
  return rows.flatMap((row) =>
    (playerConnectionService.getStatus(row.slug)?.connectedPlayers ?? []).map((p) => ({
      slug: row.slug,
      steamid64: p.steamId,
    }))
  );
}

/**
 * The server just turned its skins plugin on (a plugins.set it answered ok):
 * it runs skins now, without waiting for its next hello to say so, and
 * everyone connected gets their loadout at once.
 */
export async function skinsTurnedOn(fleetServerId: string): Promise<void> {
  try {
    if (!(await skinService.config()).enabled) return;
    const row = await db.queryOneAsync<{
      capabilities: string | null;
      plugins_state: string | null;
    }>('SELECT capabilities, plugins_state FROM cs2_fleet_servers WHERE id = ?', [fleetServerId]);
    if (!row) return;
    const caps = (() => {
      try {
        return JSON.parse(row.capabilities ?? '[]') as string[];
      } catch {
        return [] as string[];
      }
    })();
    const state = (() => {
      try {
        return JSON.parse(row.plugins_state ?? 'null') as {
          installed?: string[];
          disabled?: string[];
        } | null;
      } catch {
        return null;
      }
    })();
    if (state && Array.isArray(state.installed) && !state.installed.includes('skins')) return;
    if (!caps.includes('skins.v1')) caps.push('skins.v1');
    const nextState = state
      ? { ...state, disabled: (state.disabled ?? []).filter((n) => n !== 'skins') }
      : null;
    await db.runAsync(
      'UPDATE cs2_fleet_servers SET capabilities = ?, plugins_state = COALESCE(?, plugins_state) WHERE id = ?',
      [JSON.stringify(caps), nextState ? JSON.stringify(nextState) : null, fleetServerId]
    );
    const connected = await connectedOn(fleetServerId);
    for (const { slug, steamid64 } of connected) {
      await pushSkinsOnConnect(fleetServerId, slug, steamid64);
    }
    if (connected.length)
      void (await import('../gameMessages')).sayInGame(fleetServerId, 'skinsOn');
  } catch (error) {
    log.warn('[FLEET] skins: could not apply the switched-on plugin', {
      fleetServerId,
      error: (error as Error).message,
    });
  }
}

/** Skins were switched off: everyone connected loses them now. */
export async function skinsTurnedOff(fleetServerId: string): Promise<void> {
  try {
    const connected = await connectedOn(fleetServerId);
    for (const { steamid64 } of connected) {
      await sendReliable(fleetServerId, { type: 'skins.invalidate', payload: { steamid64 } });
    }
    if (connected.length)
      void (await import('../gameMessages')).sayInGame(fleetServerId, 'skinsOff');
  } catch (error) {
    log.warn('[FLEET] skins: could not clear skins', {
      fleetServerId,
      error: (error as Error).message,
    });
  }
}

/**
 * Loadout changes waiting for the round to end, per server: the latest per
 * player, sent once at round end (flushRoundLoadouts). Spamming equip and
 * unequip mid-round costs the server one message per player per round.
 */
const pendingByServer = new Map<string, Map<string, string>>();
/**
 * Outside a live map (warmup, between maps) the change goes after this:
 * long enough to fold a burst of clicks into one message, short enough that
 * trying skins on in warmup feels live.
 */
const OUTSIDE_LIVE_DELAY_MS = 500;
const outsideLiveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Whether a loadout change waits for the round to end: only while a round is
 * being played (the match live and its map's phase `live`; an unknown phase
 * counts as live). Warmup, knife, between maps or before the match: at once.
 */
export function waitsForRoundEnd(
  matchStatus: string,
  mapPhase: string | null | undefined
): boolean {
  return (
    matchStatus === 'live' && (mapPhase === 'live' || mapPhase === null || mapPhase === undefined)
  );
}

/** The round ended on a fleet server: its waiting loadout changes go out. */
export async function flushRoundLoadouts(fleetServerId: string): Promise<void> {
  const pending = pendingByServer.get(fleetServerId);
  if (!pending || pending.size === 0) return;
  pendingByServer.delete(fleetServerId);
  const { sayInGame } = await import('../gameMessages');
  for (const [steamid64, slug] of pending) {
    await pushSkinsOnConnect(fleetServerId, slug, steamid64);
    void sayInGame(fleetServerId, 'loadoutUpdated', {}, { to: steamid64 });
  }
}

/**
 * A player changed their loadout on the site: if they are in a match right
 * now, their server gets it at the end of the round being played, or half a
 * second later in warmup, knife and between maps (the map's phase, not the
 * match's status), the latest change only.
 */
export async function pushLoadoutLive(steamid64: string): Promise<void> {
  try {
    const { playerConnectionService } =
      await import('../../../../services/playerConnectionService');
    const rows = await db.queryAsync<{ slug: string; server_id: string; status: string }>(
      "SELECT slug, server_id, status FROM matches WHERE status IN ('loaded', 'live') AND server_id IS NOT NULL AND server_id <> ''"
    );
    for (const row of rows) {
      const here = playerConnectionService
        .getStatus(row.slug)
        ?.connectedPlayers.some((p) => p.steamId === steamid64);
      if (!here) continue;
      const pending = pendingByServer.get(row.server_id) ?? new Map<string, string>();
      pending.set(steamid64, row.slug);
      pendingByServer.set(row.server_id, pending);
      // Only a round being played waits for its end. A match is `live` from its
      // first map to its last, so warmup, knife and between maps go by the
      // map's own phase: there no round ends to carry the change.
      const phase =
        row.status === 'live'
          ? (await getLiveState(row.slug).catch(() => null))?.state?.phase
          : null;
      if (!waitsForRoundEnd(row.status, phase) && !outsideLiveTimers.has(row.server_id)) {
        outsideLiveTimers.set(
          row.server_id,
          setTimeout(() => {
            outsideLiveTimers.delete(row.server_id);
            void flushRoundLoadouts(row.server_id);
          }, OUTSIDE_LIVE_DELAY_MS)
        );
      }
    }
    // Servers with no match where a ping saw them: no round to wait for.
    for (const [serverId, ids] of presentOn) {
      if (ids.has(steamid64) && !(await hasMatch(serverId)))
        await pushSkinsOnConnect(serverId, '', steamid64);
    }
  } catch (error) {
    log.warn('[FLEET] skins: live loadout not sent', {
      steamid64,
      error: (error as Error).message,
    });
  }
}
