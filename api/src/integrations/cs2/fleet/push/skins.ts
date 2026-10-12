/**
 * `skins.loadout` (FLEET.md §7, D6): the platform's virtual skins on a Ready
 * Up server. Sent when a player connects, never while a map is being played:
 * a loadout only reaches the server in warmup, between maps and around the
 * match, so nobody's weapons change mid-round.
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

/** Phases a loadout may arrive in: before, between and after maps. */
const OPEN_PHASES = new Set(['loading', 'warmup', 'map_end', 'series_end', 'restoring']);

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
    log.warn('[FLEET] skins: loadout not sent', {
      fleetServerId,
      matchSlug,
      error: (error as Error).message,
    });
  }
}
