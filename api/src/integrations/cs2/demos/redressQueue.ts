/**
 * Writes to the overlay redraw queue (cs2_redress_queue) go through here, so
 * the Overlays tab follows a redraw as it happens (the `highlights-admin`
 * topic) instead of polling.
 */
import { db } from '../../../config/database';
import { emitTopic } from '../../../services/socketService';
import type { SqlValue } from '../../../config/database';

export async function runRedressQueue(
  sql: string,
  params: SqlValue[] = []
): ReturnType<typeof db.runAsync> {
  const result = await db.runAsync(sql, params);
  emitTopic('highlights-admin', { admin: true });
  return result;
}
