/**
 * Server-level notices a Ready Up server sends over the fleet link (FLEET.md
 * §8.1, §14.3; schemas `protocol/v1/messages/server.*.json`):
 *
 * - `server.cs2_update_required {required_build}`: Steam says the server's
 *   CS2 build is behind. Stored on its cs2_servers row (`cs2_required_version`,
 *   as the RCON update check does), so the Servers page shows "CS2 out of date"
 *   and the allocator skips it; cleared when a hello reports that build
 *   (`clearCs2UpdateIfCurrent`).
 * - `server.selftest {pass, passed, total, failures}`: the core's selftest
 *   outcome changed. Stored on the fleet server (`selftest`, the column hello
 *   fills), failures logged.
 *
 * Both are reliable: stored before the ack (`persist`), so Ready Up's spool
 * drains even when applying fails.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { redactFleetSecrets } from './credentials';
import { cs2ServerIdOf } from './link';
import { registerInboundHandler, type InboundContext } from './inbound';
import type {
  Envelope,
  ServerCs2UpdateRequiredPayload,
  ServerSelftestPayload,
} from './protocol/v1';

async function markProcessed(ctx: InboundContext, env: Envelope): Promise<void> {
  await db.runAsync(
    'UPDATE cs2_fleet_events SET processed_at = ? WHERE server_id = ? AND message_id = ? AND processed_at IS NULL',
    [Math.floor(Date.now() / 1000), ctx.serverId, env.id]
  );
}

export async function applyCs2UpdateRequired(ctx: InboundContext, env: Envelope): Promise<void> {
  const { required_build } = env.payload as unknown as ServerCs2UpdateRequiredPayload;
  log.warn(`[FLEET] ${ctx.serverId}: CS2 update required (Steam wants build ${required_build})`, {
    server_id: ctx.serverId,
    required_build,
  });
  const cs2ServerId = await cs2ServerIdOf(ctx.serverId);
  if (cs2ServerId && Number.isInteger(required_build) && required_build > 0) {
    const now = Math.floor(Date.now() / 1000);
    await db.runAsync(
      `UPDATE cs2_servers SET cs2_required_version = ?, cs2_update_phase = 'available',
              cs2_update_required_at = ?, cs2_update_checked_at = ?, updated_at = ? WHERE id = ?`,
      [required_build, now, now, now, cs2ServerId]
    );
  }
  await markProcessed(ctx, env);
}

/** "1.41.8.8" -> 14188, the form Steam's required_version (and required_build) uses. */
export function patchNumber(patch: unknown): number | null {
  if (typeof patch !== 'string' || !/^\d+(\.\d+)+$/.test(patch)) return null;
  const n = Number(patch.replace(/\./g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * A hello reports the server's CS2 patch (`versions.cs2_patch`): once it is at
 * or past the required build, the out-of-date mark on its cs2_servers row goes.
 */
export async function clearCs2UpdateIfCurrent(
  fleetServerId: string,
  versions: unknown
): Promise<void> {
  const patch = patchNumber((versions as { cs2_patch?: unknown } | null)?.cs2_patch);
  if (patch === null) return;
  const cs2ServerId = await cs2ServerIdOf(fleetServerId);
  if (!cs2ServerId) return;
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `UPDATE cs2_servers SET cs2_required_version = NULL, cs2_update_phase = NULL, cs2_update_required_at = NULL,
            cs2_update_checked_at = ?, updated_at = ?
      WHERE id = ? AND cs2_required_version IS NOT NULL AND cs2_required_version <= ?`,
    [now, now, cs2ServerId, patch]
  );
}

export async function applySelftest(ctx: InboundContext, env: Envelope): Promise<void> {
  const selftest = env.payload as unknown as ServerSelftestPayload;
  await db.runAsync('UPDATE cs2_fleet_servers SET selftest = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(selftest),
    Math.floor(Date.now() / 1000),
    ctx.serverId,
  ]);
  if (selftest.pass) {
    log.info(`[FLEET] ${ctx.serverId}: selftest passed (${selftest.passed}/${selftest.total})`);
  } else {
    const failures = selftest.failures.slice(0, 10).map((f) => redactFleetSecrets(f));
    log.warn(
      `[FLEET] ${ctx.serverId}: selftest failed (${selftest.passed}/${selftest.total} passed)`,
      {
        server_id: ctx.serverId,
        failures,
      }
    );
  }
  await markProcessed(ctx, env);
}

let unregister: Array<() => void> = [];

export function startServerNotices(): void {
  if (unregister.length) return;
  unregister = [
    registerInboundHandler('server.cs2_update_required', {
      persist: true,
      handle: applyCs2UpdateRequired,
    }),
    registerInboundHandler('server.selftest', { persist: true, handle: applySelftest }),
  ];
}

export function stopServerNotices(): void {
  for (const off of unregister) off();
  unregister = [];
}
