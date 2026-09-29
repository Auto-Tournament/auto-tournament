/**
 * The failover settings (FLEET.md §11): auto-failover (on unless an admin
 * turns it off) and the reserve, the idle fleet servers normal allocation
 * leaves for failover. Stored as the 'failover' row of `cs2_fleet_lists`
 * (`data` = {"auto": boolean, "csm": boolean, "reserve": number | null});
 * `csm` (default on) lets auto-failover restart and create servers through
 * csm; `reserve` null = automatic (1 once two Ready Up servers are online,
 * else 0).
 *
 * Reserve servers are servers like any other for the license count (every
 * enabled server row counts): the setting only changes what allocation hands
 * out. Nothing here ever blocks or delays a failover.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { fleetBus } from './service';
import { effectiveReserve } from './failoverPlan';

export const MAX_RESERVE = 16;

export interface FailoverSettings {
  auto: boolean;
  /** Auto-failover may restart the dead server and create servers through csm (./failoverRecovery.ts). */
  csm: boolean;
  /** null = automatic. */
  reserve: number | null;
  updatedBy: string | null;
  updatedAt: number | null;
}

const nowS = () => Math.floor(Date.now() / 1000);

export async function getFailoverSettings(): Promise<FailoverSettings> {
  const row = await db.queryOneAsync<{ data: string | null; updated_by: string | null; updated_at: number | null }>(
    `SELECT data, updated_by, updated_at FROM cs2_fleet_lists WHERE name = 'failover'`
  );
  let data: { auto?: unknown; reserve?: unknown; csm?: unknown } | null = null;
  try {
    data = row?.data ? (JSON.parse(row.data) as { auto?: unknown; reserve?: unknown; csm?: unknown }) : null;
  } catch {
    data = null;
  }
  const reserve =
    typeof data?.reserve === 'number' && Number.isInteger(data.reserve) && data.reserve >= 0 ? data.reserve : null;
  return {
    auto: data?.auto !== false,
    csm: data?.csm !== false,
    reserve,
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at === null || row?.updated_at === undefined ? null : Number(row.updated_at),
  };
}

export async function setFailoverSettings(
  patch: { auto?: boolean; reserve?: number | null; csm?: boolean },
  actor: string | null
): Promise<FailoverSettings> {
  const current = await getFailoverSettings();
  const next = {
    auto: patch.auto ?? current.auto,
    csm: patch.csm ?? current.csm,
    reserve: patch.reserve === undefined ? current.reserve : patch.reserve,
  };
  await db.runAsync(
    `INSERT INTO cs2_fleet_lists (name, rev, data, updated_by, updated_at) VALUES ('failover', 1, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET rev = cs2_fleet_lists.rev + 1, data = EXCLUDED.data,
         updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [JSON.stringify(next), actor, nowS()]
  );
  log.info(
    `[FAILOVER] settings: auto-failover ${next.auto ? 'on' : 'off'}, csm recovery ${next.csm ? 'on' : 'off'}, reserve ${next.reserve ?? 'automatic'} (by ${actor ?? 'unknown'})`
  );
  return getFailoverSettings();
}

/** Ready Up servers in the pool: linked, enabled and online. */
export async function fleetPoolSize(): Promise<number> {
  const rows = await db.queryAsync<{ fleet_server_id: string | null }>(
    `SELECT fleet_server_id FROM cs2_servers WHERE transport = 'fleet' AND enabled = 1 AND fleet_server_id IS NOT NULL`
  );
  const bus = fleetBus();
  return rows.filter((r) => r.fleet_server_id && bus.isConnected(r.fleet_server_id)).length;
}

/** How many idle fleet servers allocation holds back now. */
export async function reserveCount(): Promise<{ configured: number | null; effective: number; poolSize: number }> {
  const [settings, poolSize] = await Promise.all([getFailoverSettings(), fleetPoolSize()]);
  return { configured: settings.reserve, effective: effectiveReserve(settings.reserve, poolSize), poolSize };
}
