/**
 * Ready Up's `admin_called` event (a player typed `.admin [message]`), mapped
 * onto the core's admin calls. CS2-specific only in the reading: the payload
 * (`adminCalledPayload.ts`) and which server sent it (cs2_servers). Storage,
 * the admin API and the live toast are core's (services/adminCallService.ts).
 */

import { db } from '../../../config/database';
import type { AdminCallInput } from '../../../types/adminCall.types';
import type { DbMatchRow } from '../../../types/database.types';
import type { AdminCalledEvent } from './plugin-events.types';
import { readAdminCalled } from './adminCalledPayload';

/**
 * The CS2 server a call came from, and its name. Candidates are what the
 * pipeline already attributes the request to, most trusted first. The first
 * one that is a known server wins; with none known, the first candidate is
 * kept as is (with no name).
 */
async function resolveServer(
  candidates: Array<string | null | undefined>
): Promise<{ id: string | null; name: string | null }> {
  const cleaned = candidates
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c !== '' && c !== 'unknown');
  for (const candidate of cleaned) {
    // A webhook URL ending in `?server_id=<id>` gets `/<match>` appended by a
    // plugin that adds the match to the path; the id is the part before it.
    for (const id of new Set([candidate, candidate.split('/')[0]])) {
      const row = await db.queryOneAsync<{ id: string; name: string | null }>(
        'SELECT id, name FROM cs2_servers WHERE id = ?',
        [id]
      );
      if (row) return { id: row.id, name: row.name };
    }
  }
  return { id: cleaned[0] ?? null, name: null };
}

export interface AdminCalledContext {
  match: DbMatchRow | null;
  /** Server ids the request is attributed to, most trusted first. */
  serverCandidates: Array<string | null | undefined>;
}

export async function adminCallFromEvent(
  event: AdminCalledEvent,
  ctx: AdminCalledContext
): Promise<AdminCallInput> {
  const fields = readAdminCalled(event, Math.floor(Date.now() / 1000));
  const server = await resolveServer(ctx.serverCandidates);
  return {
    ...fields,
    serverId: server.id,
    serverName: server.name,
    matchId: ctx.match ? Number(ctx.match.id) : null,
    matchSlug: ctx.match?.slug ?? null,
  };
}
