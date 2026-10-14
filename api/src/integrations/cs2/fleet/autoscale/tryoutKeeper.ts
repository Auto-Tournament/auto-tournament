/**
 * Keeps one Skin tryout server (#188): with skins on, "Keep a Skin tryout
 * server" on (Skins settings) and the scaler on (the admin's go for servers
 * made on their own), a machine with room is asked to
 * create one when no server is on the Skin tryout set. csm creates it, Ready
 * Up enrolls and gets the set from the create's `meta.plugins` (practice +
 * skins, its hub map). It is not linked to the match pool (a different
 * `issued_by` from the scaler's creates). Asked again after RETRY_S at most.
 */
import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import * as hostRegistry from '../hosts/registry';
import { sendHostCommand } from '../hosts/service';
import { presetSet } from '../push/pluginSets';

/** `issued_by` on the tryout server's create. */
export const TRYOUT_ACTOR = 'tryout';
/** A create is asked again after this long (the first may still be installing). */
const RETRY_S = 30 * 60;
/** Free memory a machine needs for it. */
const MIN_FREE_MB = 2048;

/** Skins are on, and the admin wants a tryout server kept (Skins settings). */
async function wanted(): Promise<boolean> {
  const { skinService } = await import('../../skins/skinService');
  const config = await skinService.config();
  return config.enabled === true && config.tryoutServer === true;
}

/** A server (not revoked) is on the Skin tryout set. */
async function haveTryoutServer(): Promise<boolean> {
  const rows = await db.queryAsync<{ plugins: string | null }>(
    `SELECT p.plugins FROM cs2_fleet_server_prefs p JOIN cs2_fleet_servers s ON s.id = p.server_id
      WHERE s.status <> 'revoked' AND p.plugins IS NOT NULL`,
    []
  );
  return rows.some((r) => {
    try {
      return (JSON.parse(r.plugins as string) as { preset?: string }).preset === 'tryout';
    } catch {
      return false;
    }
  });
}

/** The machine a tryout create went to, or null when none was needed or possible. */
export async function keepTryoutServer(now: number): Promise<string | null> {
  if (!(await wanted()) || (await haveTryoutServer())) return null;
  const recent = await db.queryOneAsync<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM cs2_fleet_host_commands
      WHERE type = 'server.create' AND issued_by = ? AND created_at > ?`,
    [TRYOUT_ACTOR, now - RETRY_S]
  );
  if (Number(recent?.n ?? 0) > 0) return null;
  const hosts = (await hostRegistry.listHosts())
    .filter(
      (h) =>
        h.online &&
        h.status === 'enrolled' &&
        !!h.inventory &&
        h.inventory.resources.ram_free_mb >= MIN_FREE_MB
    )
    .sort((a, b) => b.inventory!.resources.ram_free_mb - a.inventory!.resources.ram_free_mb);
  for (const host of hosts) {
    try {
      await sendHostCommand(
        host.id,
        'server.create',
        { count: 1, enroll: true },
        {
          issuedBy: TRYOUT_ACTOR,
          meta: {
            plugins: presetSet('tryout'),
            reason: 'Skins are on and there is no Skin tryout server',
          },
        }
      );
      log.info(`[AUTOSCALE] no Skin tryout server: asked ${host.name ?? host.id} to create one`);
      return host.name ?? host.id;
    } catch (error) {
      log.warn(
        `[AUTOSCALE] Skin tryout server create on ${host.id} not sent: ${(error as Error).message}`
      );
    }
  }
  return null;
}
