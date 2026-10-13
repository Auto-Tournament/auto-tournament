/**
 * The admin match page's server log: each Ready Up event the platform takes in
 * becomes one line in the match's event log (match_events, `fleet.<event>`),
 * with a level, so an admin sees disconnects, pauses, errors and results next to
 * the platform's own lines and the admins' actions. A line is a courtesy: a
 * failed write is logged and dropped, never an error for the event.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { MatchState } from './protocol/v1';

import { serverLogLine } from './serverLogLine';
export { serverLogLine } from './serverLogLine';

/** Write the event's line to the match's event log (best effort). */
export async function recordServerLog(
  matchSlug: string,
  type: string,
  data: Record<string, unknown> | undefined,
  state: MatchState | null,
  mapNumber?: number,
  round?: number
): Promise<void> {
  const line = serverLogLine(type, data, state, mapNumber, round);
  if (!line) return;
  await db
    .runAsync('INSERT INTO match_events (match_slug, event_type, event_data) VALUES (?, ?, ?)', [
      matchSlug,
      `fleet.${type.replace(/^event\./, '')}`,
      JSON.stringify({ level: line.level, text: line.text }),
    ])
    .catch((error: unknown) =>
      log.debug(`[FLEET] ${matchSlug}: server log line not written`, { error: String(error) })
    );
}
