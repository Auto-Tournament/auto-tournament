/**
 * What an admin notice says and where it opens (api services/adminNoticeService.ts).
 * No React here: tests load it directly.
 */

export type AdminNoticeSeverity = 'error' | 'warn' | 'info';

export interface AdminNotice {
  id: number;
  kind: string;
  severity: AdminNoticeSeverity;
  data: Record<string, unknown>;
  dedupeKey: string;
  count: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export type AdminNoticeDelivery = 'off' | 'bell' | 'sound';

/** The settings page groups kinds like this. */
export const NOTICE_GROUPS: Record<string, string[]> = {
  matches: [
    'match_no_server',
    'veto_stalled',
    'warmup_long',
    'match_forfeit',
    'report_disputed',
    'failover',
    'match_silent',
    'tournament_autostart_failed',
    'shuffle_no_show',
  ],
  servers: ['server_crashed', 'plugin_update_available', 'update_failed', 'autoscale_license'],
  recorders: [
    'recorder_offline',
    'recorder_updated',
    'recorder_update_failed',
    'benchmark_failed',
    'clips_failing',
  ],
  platform: ['beta_available', 'license_problem', 'demos_failing'],
};

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** The i18n params a notice's line uses: every data field as text. */
export function noticeParams(
  notice: Pick<AdminNotice, 'data' | 'count'>
): Record<string, string | number> {
  const out: Record<string, string | number> = { count: notice.count };
  for (const [key, value] of Object.entries(notice.data)) out[key] = str(value);
  return out;
}

/** The i18n key of a notice's line (failovers that wait on an admin say so). */
export function noticeKey(notice: Pick<AdminNotice, 'kind' | 'data'>): string {
  if (notice.kind === 'failover' && notice.data.needsDecision === true)
    return 'adminNotices.kind.failoverDecision';
  return `adminNotices.kind.${notice.kind}`;
}

/** Where clicking a notice goes: the match, the servers, the recorders, the license, the update. */
export function noticeLink(
  notice: Pick<AdminNotice, 'kind' | 'data'>,
  paths: {
    match: (slug: string) => string;
    servers: string;
    recorders: string;
    license: string;
    system: string;
  }
): string | null {
  const slug = str(notice.data.matchSlug);
  if (slug) return paths.match(slug);
  if (
    ['server_crashed', 'plugin_update_available', 'update_failed', 'autoscale_license'].includes(
      notice.kind
    )
  ) {
    return paths.servers;
  }
  if (
    [
      'recorder_offline',
      'recorder_updated',
      'recorder_update_failed',
      'benchmark_failed',
      'clips_failing',
    ].includes(notice.kind)
  ) {
    return paths.recorders;
  }
  if (notice.kind === 'license_problem') return paths.license;
  if (notice.kind === 'beta_available' || notice.kind === 'demos_failing') return paths.system;
  return null;
}

/** Open first, then newest change; resolved ones keep their place below. */
export function sortNotices(list: AdminNotice[]): AdminNotice[] {
  return [...list].sort(
    (a, b) =>
      Number(a.resolvedAt !== null) - Number(b.resolvedAt !== null) ||
      b.updatedAt - a.updatedAt ||
      b.id - a.id
  );
}

/** A live notice into the list: replaces the same id (a repeat counted up), else goes in. */
export function upsertNotice(list: AdminNotice[], notice: AdminNotice): AdminNotice[] {
  return sortNotices([notice, ...list.filter((n) => n.id !== notice.id)]);
}
