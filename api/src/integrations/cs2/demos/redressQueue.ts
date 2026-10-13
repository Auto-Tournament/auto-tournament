/**
 * Writes to the overlay redraw queue (cs2_redress_queue) go through here, so
 * the Overlays tab follows a redraw as it happens (the `highlights-admin`
 * topic) instead of polling.
 */
import { db } from '../../../config/database';
import { emitTopic } from '../../../services/socketService';

export async function runRedressQueue(
  sql: string,
  params: unknown[] = []
): ReturnType<typeof db.runAsync> {
  const result = await db.runAsync(sql, params);
  emitTopic('highlights-admin', { admin: true });
  return result;
}
