/**
 * Server-level notices a Ready Up server sends over the fleet link (FLEET.md
 * §8.1, §14.3; schemas `protocol/v1/messages/server.*.json`):
 *
 * - `server.cs2_update_required {required_build}`: Steam says the server's
 *   CS2 build is behind. Logged as a warning; the message itself stays in
 *   `cs2_fleet_events` (the fleet server table has no column for it yet).
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
import { registerInboundHandler, type InboundContext } from './inbound';
import type { Envelope, ServerCs2UpdateRequiredPayload, ServerSelftestPayload } from './protocol/v1';

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
  await markProcessed(ctx, env);
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
    log.warn(`[FLEET] ${ctx.serverId}: selftest failed (${selftest.passed}/${selftest.total} passed)`, {
      server_id: ctx.serverId,
      failures,
    });
  }
  await markProcessed(ctx, env);
}

let unregister: Array<() => void> = [];

export function startServerNotices(): void {
  if (unregister.length) return;
  unregister = [
    registerInboundHandler('server.cs2_update_required', { persist: true, handle: applyCs2UpdateRequired }),
    registerInboundHandler('server.selftest', { persist: true, handle: applySelftest }),
  ];
}

export function stopServerNotices(): void {
  for (const off of unregister) off();
  unregister = [];
}
