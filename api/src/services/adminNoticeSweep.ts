/**
 * The admins' bell, for matches that are stuck (services/adminNoticeService):
 * every minute, a match that has waited too long for a server, a veto that
 * has not moved, a warmup that runs on. Each is raised once and closed again
 * when the match moves on.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { adminNoticeService, type AdminNoticeKind } from './adminNoticeService';

/** How long before a stuck match is worth an admin's look. */
export const STUCK_AFTER = {
  match_no_server: 10 * 60,
  veto_stalled: 10 * 60,
  warmup_long: 20 * 60,
} as const;

export interface SweepMatch {
  slug: string;
  status: string;
  serverId: string | null;
  loadedAt: number | null;
  /** The veto: not started / under way / done, and how many moves so far. */
  veto: { status: 'none' | 'in_progress' | 'completed'; actions: number } | null;
}

export type StuckKind = Extract<AdminNoticeKind, keyof typeof STUCK_AFTER>;

/**
 * What a match is stuck on right now, with the key of its current state
 * (a new veto move starts the clock again), or null.
 */
export function stuckState(m: SweepMatch): { kind: StuckKind; state: string } | null {
  if (m.status === 'loaded') return { kind: 'warmup_long', state: `loaded:${m.loadedAt ?? 0}` };
  if (m.status !== 'pending' && m.status !== 'ready') return null;
  if (m.veto?.status === 'in_progress')
    return { kind: 'veto_stalled', state: `veto:${m.veto.actions}` };
  const vetoDone = !m.veto || m.veto.status === 'completed' || m.veto.status === 'none';
  if (m.status === 'ready' && vetoDone && !m.serverId)
    return { kind: 'match_no_server', state: 'ready' };
  return null;
}

/** First time each match was seen in its current stuck state (`slug` → state, since). */
const seen = new Map<string, { state: string; since: number }>();

/** Notices this sweep raised and has not closed, by dedupe key. */
const raised = new Set<string>();

const key = (kind: StuckKind, slug: string) => `${kind}:${slug}`;

export async function sweepStuckMatches(now = Math.floor(Date.now() / 1000)): Promise<void> {
  const rows = await db.queryAsync<{
    slug: string;
    status: string;
    server_id: string | null;
    loaded_at: number | null;
    veto_state: string | null;
  }>(
    `SELECT slug, status, server_id, loaded_at, veto_state FROM matches
      WHERE status IN ('pending', 'ready', 'loaded') AND (held_until IS NULL OR held_until < ?)
        AND NOT EXISTS (SELECT 1 FROM tournament t WHERE t.id = matches.tournament_id AND t.paused_at IS NOT NULL)`,
    [now]
  );
  const stillStuck = new Set<string>();
  for (const row of rows) {
    let veto: SweepMatch['veto'] = null;
    try {
      const parsed = row.veto_state
        ? (JSON.parse(row.veto_state) as { status?: string; actions?: unknown[] })
        : null;
      veto = parsed
        ? {
            status:
              parsed.status === 'completed'
                ? 'completed'
                : parsed.status === 'in_progress'
                  ? 'in_progress'
                  : 'none',
            actions: Array.isArray(parsed.actions) ? parsed.actions.length : 0,
          }
        : null;
    } catch {
      veto = null;
    }
    const stuck = stuckState({
      slug: row.slug,
      status: row.status,
      serverId: row.server_id,
      loadedAt: row.loaded_at === null ? null : Number(row.loaded_at),
      veto,
    });
    if (!stuck) {
      seen.delete(row.slug);
      continue;
    }
    const prev = seen.get(row.slug);
    const since =
      prev && prev.state === stuck.state
        ? prev.since
        : stuck.kind === 'warmup_long' && row.loaded_at
          ? Number(row.loaded_at)
          : now;
    seen.set(row.slug, { state: stuck.state, since });
    const dedupe = key(stuck.kind, row.slug);
    if (now - since < STUCK_AFTER[stuck.kind]) continue;
    stillStuck.add(dedupe);
    if (!raised.has(dedupe)) {
      raised.add(dedupe);
      await adminNoticeService.raise(
        stuck.kind,
        { matchSlug: row.slug, minutes: Math.floor((now - since) / 60) },
        dedupe
      );
    }
  }
  // Moved on (or gone): close what this sweep raised for them.
  for (const dedupe of [...raised]) {
    if (stillStuck.has(dedupe)) continue;
    raised.delete(dedupe);
    await adminNoticeService.resolve(dedupe);
  }
  for (const slug of [...seen.keys()]) {
    if (!rows.some((r) => r.slug === slug)) seen.delete(slug);
  }
}

/**
 * Hourly: a newer release of the platform (on this build's channel), and a
 * license that needs the admin (invalid, past due, expired). Each closes
 * once it no longer applies.
 */
export async function sweepPlatform(): Promise<void> {
  const { checkPlatformUpdate } = await import('./platform/updateCheck');
  const update = await checkPlatformUpdate().catch(() => null);
  const open = await adminNoticeService.list(200);
  for (const n of open.filter((x) => x.kind === 'beta_available' && x.resolvedAt === null)) {
    if (!update?.available || n.data.version !== update.latest)
      await adminNoticeService.resolve(n.dedupeKey);
  }
  if (update?.available && update.latest) {
    const dedupe = `beta_available:${update.latest}`;
    if (!open.some((n) => n.dedupeKey === dedupe && n.resolvedAt === null)) {
      await adminNoticeService.raise(
        'beta_available',
        { version: update.latest, running: update.running, url: update.releaseUrl },
        dedupe
      );
    }
  }
  const { licenseService } = await import('./license/licenseService');
  const license = await licenseService.getStatus().catch(() => null);
  const trouble =
    license &&
    (license.status === 'invalid' ||
      ['invalid', 'past_due', 'expired'].includes(license.standing.status))
      ? license.status === 'invalid'
        ? 'invalid'
        : license.standing.status
      : null;
  if (trouble) {
    if (!open.some((n) => n.dedupeKey === `license_problem:${trouble}` && n.resolvedAt === null)) {
      await adminNoticeService.raise(
        'license_problem',
        { problem: trouble },
        `license_problem:${trouble}`
      );
    }
  }
  for (const n of open.filter((x) => x.kind === 'license_problem' && x.resolvedAt === null)) {
    if (n.dedupeKey !== `license_problem:${trouble}`) await adminNoticeService.resolve(n.dedupeKey);
  }
}

let started = false;

/** Every minute; old resolved notices are pruned once a day. */
export function startAdminNoticeSweep(): void {
  if (started) return;
  started = true;
  const run = () =>
    sweepStuckMatches().catch((error) =>
      log.debug('[ADMIN-NOTICES] stuck-match sweep failed', { error })
    );
  setTimeout(run, 30_000).unref?.();
  setInterval(run, 60_000).unref?.();
  const platform = () =>
    sweepPlatform().catch((error) => log.debug('[ADMIN-NOTICES] platform sweep failed', { error }));
  setTimeout(platform, 60_000).unref?.();
  setInterval(platform, 3600_000).unref?.();
  setInterval(
    () => void adminNoticeService.prune().catch(() => undefined),
    24 * 3600_000
  ).unref?.();
}
