/**
 * `skins.loadout` (FLEET.md §7, D6): the platform's virtual skins on a Ready
 * Up server. Sent when a player connects, never while a map is being played:
 * a loadout only reaches the server in warmup, between maps and around the
 * match, so nobody's weapons change mid-round.
 *
 * Only to a server that
 * - has the skins plugin (`skins.v1` in its hello capabilities),
 * - runs without a Valve game server token (`hello.host.steam_token`): Valve
 *   bans the token, and the account behind it, of a server that hands out
 *   items players do not own; the plugin stays inert there too,
 * - an admin turned skins on for (`cs2_servers.skins`),
 * and only while skins are on for the platform (`skins_config.enabled`).
 */

import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import { skinService } from '../../../../services/skinService';
import { sendReliable } from '../reliable';
import { getLiveState } from '../state';
import type { SkinsLoadoutPayload } from '../protocol/v1';

/** Phases a loadout may arrive in: before, between and after maps. */
const OPEN_PHASES = new Set(['loading', 'warmup', 'map_end', 'series_end', 'restoring']);

/** Whether this fleet server takes skins, and why not when it does not. */
export async function skinsTarget(fleetServerId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await db.queryOneAsync<{ capabilities: string | null; host: string | null; skins: number | null }>(
    `SELECT f.capabilities, f.host, s.skins
       FROM cs2_fleet_servers f LEFT JOIN cs2_servers s ON s.fleet_server_id = f.id
      WHERE f.id = ?`,
    [fleetServerId]
  );
  if (!row) return { ok: false, reason: 'unknown server' };
  if (row.skins !== 1) return { ok: false, reason: 'skins off for this server' };
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
  if (host.steam_token === true) return { ok: false, reason: 'the server uses a Steam server token' };
  return { ok: true };
}

/** A player connected to a match on a fleet server: send their loadout if the map is not being played. */
export async function pushSkinsOnConnect(fleetServerId: string, matchSlug: string, steamid64: string): Promise<void> {
  try {
    const target = await skinsTarget(fleetServerId);
    if (!target.ok) return;
    const phase = (await getLiveState(matchSlug))?.state?.phase ?? 'warmup';
    if (!OPEN_PHASES.has(phase)) {
      log.debug(`[FLEET] skins: not sending ${steamid64}'s loadout during ${phase}`);
      return;
    }
    const items = await skinService.loadoutItems(steamid64);
    if (!items) return;
    const payload: SkinsLoadoutPayload = { steamid64, rev: Math.floor(Date.now() / 1000), items };
    await sendReliable(fleetServerId, { type: 'skins.loadout', payload });
  } catch (error) {
    log.warn('[FLEET] skins: loadout not sent', { fleetServerId, matchSlug, error: (error as Error).message });
  }
}
