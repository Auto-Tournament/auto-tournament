/**
 * Which game server a request from MatchZy came from.
 *
 * Every server posts events to the same `/api/events` URL and match events carry
 * only `matchid`, so MAT could not tell two servers apart. When one match ended
 * up running on two servers, events from both were applied to it. MAT now puts
 * the server id in the URLs it hands the plugin (webhook, match config) as a
 * `server_id` query parameter, and — for config fetches — the numeric match id
 * as `match_id`, so a load queued before a tournament reset cannot pick up the
 * new match that reused the slug.
 *
 * Requests without these parameters come from servers configured before this
 * change; they are accepted as before.
 */

export const SERVER_ID_PARAM = 'server_id';
export const MATCH_ID_PARAM = 'match_id';

function appendQuery(url: string, params: Record<string, string | number | null | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined && entry[1] !== ''
  );
  if (entries.length === 0) return url;
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

/** Webhook URL for one server: `${baseUrl}/api/events?server_id=…`. */
export function buildServerEventsUrl(baseUrl: string, serverId?: string | null): string {
  return appendQuery(`${baseUrl}/api/events`, { [SERVER_ID_PARAM]: serverId });
}

/** Match config URL tied to the server it is loaded on and the match row it was built for. */
export function buildMatchConfigUrl(
  baseUrl: string,
  matchSlug: string,
  serverId?: string | null,
  matchId?: number | null
): string {
  return appendQuery(`${baseUrl}/api/matches/${matchSlug}.json`, {
    [SERVER_ID_PARAM]: serverId,
    [MATCH_ID_PARAM]: matchId,
  });
}

/** First string value of a query parameter, or null. */
export function readQueryString(value: unknown): string | null {
  if (Array.isArray(value)) return readQueryString(value[0]);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Should an event for a match be applied, given the server it came from?
 *
 * Only a known source that disagrees with a known assignment is rejected: a
 * legacy server (no source) and a match with no server (manual flows, a
 * completed match whose server was released) keep working as before.
 */
export function isFromAssignedServer(
  assignedServerId: string | null | undefined,
  sourceServerId: string | null | undefined
): boolean {
  if (!sourceServerId || !assignedServerId) return true;
  return assignedServerId === sourceServerId;
}

export type ConfigFetchVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Should a server get this match's config?
 *
 * A fetch that names a server or match id is the plugin acting on a load MAT
 * sent earlier. If the match has since moved to another server, or the slug now
 * belongs to a different match (tournament reset), serving the config would
 * start a second copy of a match — refuse it. MatchZy then fails the load and
 * stays idle.
 */
export function checkConfigFetch(
  match: { id: number; server_id?: string | null },
  requestedServerId: string | null,
  requestedMatchId: string | null
): ConfigFetchVerdict {
  if (requestedMatchId !== null && String(match.id) !== requestedMatchId) {
    return {
      ok: false,
      reason: `load was sent for match id ${requestedMatchId}, but this slug is now match id ${match.id}`,
    };
  }
  if (requestedServerId !== null && (match.server_id ?? null) !== requestedServerId) {
    return {
      ok: false,
      reason: match.server_id
        ? `match is assigned to ${match.server_id}, not ${requestedServerId}`
        : `match is no longer assigned to ${requestedServerId}`,
    };
  }
  return { ok: true };
}

/**
 * Resolve which match a demo upload belongs to.
 *
 * The upload URL names a slug, but it is a per-server setting that MAT
 * overwrites when it loads the next match — while the previous match's last
 * demo may still be waiting to upload. The `MatchZy-MatchId` header is stamped
 * by the plugin when the demo was recorded, so it wins when it is MAT's numeric
 * id. A matchid of 0 or a non-number falls back to the URL slug.
 */
export function demoMatchIdFromHeader(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
