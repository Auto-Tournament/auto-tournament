/**
 * Which game server a request from Auto Tournament CS2 came from.
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
 * start a second copy of a match — refuse it. Auto Tournament CS2 then fails the load and
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
 * demo may still be waiting to upload. The `Auto-Tournament-MatchId` header is stamped
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

/** Match statuses that mean a server is running the match right now. */
export const ACTIVE_MATCH_STATUSES: readonly string[] = ['loaded', 'live'];

export function isActiveMatchStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && ACTIVE_MATCH_STATUSES.includes(status);
}

/**
 * Does a match report come from a server with no match loaded?
 *
 * The plugin reports phase `idle` whenever no match is set up, and keeps
 * posting reports in that state (warmup_start after a reset or restart).
 * Auto Tournament CS2 up to 1.4.28 also kept the last match id in
 * `at_tournament_match`, so such a report can still name the previous match.
 */
export function isIdleServerReport(
  report: { match?: { phase?: string | null } } | null | undefined
): boolean {
  const phase = report?.match?.phase;
  return typeof phase === 'string' && phase.trim().toLowerCase() === 'idle';
}

type ReportMatchRow = { slug: string; server_id?: string | null; status?: string | null };

export type ReportTarget<M extends ReportMatchRow> =
  | { kind: 'apply'; match: M; via: 'identifier' | 'server' }
  | { kind: 'ignore'; reason: 'idle-server' | 'wrong-server' | 'no-match'; match?: M };

/**
 * Which match a report posted by a server applies to.
 *
 * - A report from a server with no match loaded applies to nothing.
 * - A report naming a match applies to it, unless another server runs it. A
 *   finished match is still accepted here: the plugin reports its final state
 *   in postgame, after MAT has marked the series completed.
 * - Otherwise only the match currently running on that server (loaded/live)
 *   is used. Looking up any match by server id picked completed matches the
 *   server had played earlier.
 */
export async function resolveReportTarget<M extends ReportMatchRow>(
  input: { serverId: string; matchSlug: unknown; report: { match?: { phase?: string | null } } },
  lookups: {
    findByIdentifier: (identifier: string | number) => Promise<M | null>;
    findActiveForServer: (serverId: string) => Promise<M | null>;
  }
): Promise<ReportTarget<M>> {
  if (isIdleServerReport(input.report)) {
    return { kind: 'ignore', reason: 'idle-server' };
  }

  const { matchSlug, serverId } = input;
  if ((typeof matchSlug === 'string' && matchSlug.trim() !== '') || typeof matchSlug === 'number') {
    const named = await lookups.findByIdentifier(matchSlug);
    if (named) {
      if (!isFromAssignedServer(named.server_id, serverId)) {
        return { kind: 'ignore', reason: 'wrong-server', match: named };
      }
      return { kind: 'apply', match: named, via: 'identifier' };
    }
  }

  const active = await lookups.findActiveForServer(serverId);
  if (active && active.server_id === serverId && isActiveMatchStatus(active.status)) {
    return { kind: 'apply', match: active, via: 'server' };
  }
  return { kind: 'ignore', reason: 'no-match' };
}
