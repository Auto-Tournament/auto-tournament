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
    for (const { slug, steamid64 } of await connectedOn(fleetServerId)) {
      await pushSkinsOnConnect(fleetServerId, slug, steamid64);
    }
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
    for (const { steamid64 } of await connectedOn(fleetServerId)) {
      await sendReliable(fleetServerId, { type: 'skins.invalidate', payload: { steamid64 } });
    }
  } catch (error) {
    log.warn('[FLEET] skins: could not clear skins', {
      fleetServerId,
      error: (error as Error).message,
    });
  }
}

/**
 * A player changed their loadout on the site: if they are connected to a
 * match right now, their server gets the new loadout at once.
 */
export async function pushLoadoutLive(steamid64: string): Promise<void> {
  try {
    const { playerConnectionService } =
      await import('../../../../services/playerConnectionService');
    const rows = await db.queryAsync<{ slug: string; server_id: string }>(
      "SELECT slug, server_id FROM matches WHERE status IN ('loaded', 'live') AND server_id IS NOT NULL AND server_id <> ''"
    );
    for (const row of rows) {
      const here = playerConnectionService
        .getStatus(row.slug)
        ?.connectedPlayers.some((p) => p.steamId === steamid64);
      if (here) await pushSkinsOnConnect(row.server_id, row.slug, steamid64);
    }
  } catch (error) {
    log.warn('[FLEET] skins: live loadout not sent', {
      steamid64,
      error: (error as Error).message,
    });
  }
}
