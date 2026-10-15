/**
 * Surf, bhop and kz records from Ready Up's movement plugin. Every finished run
 * comes in as `movement.record` (reliable, fleet/protocol/v1); the platform
 * keeps each player's best per map, mode and course (0 = the map run, N =
 * bonus N) across all servers, and the Leaderboards page shows them
 * (routes/movement.ts, client MovementRecords).
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { Envelope, MovementRecordPayload } from '../fleet/protocol/v1';
import { registerInboundHandler, type InboundContext } from '../fleet/inbound';

/** A finished run: kept when it is the player's best on that map, mode and course. */
export async function addMovementRun(
  serverId: string | null,
  run: MovementRecordPayload
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `INSERT INTO cs2_movement_records
       (map, mode, course, steamid64, name, time_ms, teleports, finished_at, server_id, runs, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT (map, mode, course, steamid64) DO UPDATE SET
       runs = cs2_movement_records.runs + 1,
       name = EXCLUDED.name,
       updated_at = EXCLUDED.updated_at,
       teleports = CASE WHEN EXCLUDED.time_ms < cs2_movement_records.time_ms
                        THEN EXCLUDED.teleports ELSE cs2_movement_records.teleports END,
       finished_at = CASE WHEN EXCLUDED.time_ms < cs2_movement_records.time_ms
                          THEN EXCLUDED.finished_at ELSE cs2_movement_records.finished_at END,
       server_id = CASE WHEN EXCLUDED.time_ms < cs2_movement_records.time_ms
                        THEN EXCLUDED.server_id ELSE cs2_movement_records.server_id END,
       time_ms = LEAST(cs2_movement_records.time_ms, EXCLUDED.time_ms)`,
    [
      run.map.toLowerCase(),
      run.mode,
      run.course,
      run.steamid64,
      run.name ?? '',
      run.time_ms,
      run.teleports ?? 0,
      run.finished_at,
      serverId,
      now,
    ]
  );
}

async function applyRecord(ctx: InboundContext, env: Envelope): Promise<void> {
  try {
    await addMovementRun(ctx.serverId, env.payload as unknown as MovementRecordPayload);
  } catch (error) {
    log.warn(`[FLEET] ${ctx.serverId}: movement record not stored: ${(error as Error).message}`);
  }
  await db.runAsync(
    'UPDATE cs2_fleet_events SET processed_at = ? WHERE server_id = ? AND message_id = ? AND processed_at IS NULL',
    [Math.floor(Date.now() / 1000), ctx.serverId, env.id]
  );
}

let unregister: (() => void) | null = null;

export function startMovementRecords(): void {
  if (unregister) return;
  unregister = registerInboundHandler('movement.record', { persist: true, handle: applyRecord });
}

export function stopMovementRecords(): void {
  unregister?.();
  unregister = null;
}
