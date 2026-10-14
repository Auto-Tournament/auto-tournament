/**
 * CS2's notices for the admins' bell (services/adminNoticeService.ts):
 * - csm reports a Ready Up server crashed, exited or hung (closed when it
 *   recovers), or a game / plugin update it ran failed (closed by the next
 *   one that works);
 * - every minute: a recorder that stopped checking in (it was around in the
 *   last week), a recorder update that finished or failed, clips or demo
 *   analyses failing again and again;
 * - every minute: a live match whose Ready Up server has sent nothing for
 *   MATCH_SILENT_SECONDS (paused matches excepted; closed when it talks again
 *   or the match ends);
 * - hourly: a Ready Up release newer than what the servers run.
 */
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { adminNoticeService } from '../../services/adminNoticeService';
import { hostEvents } from './fleet/hosts/gateway';
import { getHost } from './fleet/hosts/registry';
import type { HostHealthPayload } from './fleet/protocol/host/v1';
import type { HostCommandRecord } from './fleet/hosts/registry';

/** A recorder silent this long is offline. */
export const RECORDER_OFFLINE_SECONDS = 10 * 60;
/** A live match whose server sent nothing this long is worth a look (a round is 2-3 min). */
export const MATCH_SILENT_SECONDS = 15 * 60;
/** This many failures in the last hour make "keeps failing". */
export const FAILING_THRESHOLD = 3;

const now = () => Math.floor(Date.now() / 1000);

async function hostName(hostId: string): Promise<string> {
  return (await getHost(hostId).catch(() => undefined))?.name ?? hostId;
}

const onHealth = (hostId: string, payload: HostHealthPayload) => {
  void (async () => {
    const dedupe = `server_crashed:${hostId}:${payload.server}`;
    if (payload.event === 'recovered' || payload.event === 'restarted') {
      await adminNoticeService.resolve(dedupe);
      return;
    }
    await adminNoticeService.raise(
      'server_crashed',
      {
        host: await hostName(hostId),
        server: payload.server,
        event: payload.event,
        detail: payload.detail ?? null,
      },
      dedupe
    );
  })();
};

const UPDATE_COMMANDS = new Set(['host.update_game', 'host.update_plugins']);

const onResult = (hostId: string, record: HostCommandRecord) => {
  if (!UPDATE_COMMANDS.has(record.type)) return;
  void (async () => {
    const dedupe = `update_failed:${hostId}:${record.type}`;
    if (record.status === 'ok') {
      await adminNoticeService.resolve(dedupe);
      return;
    }
    if (record.status !== 'failed' && record.status !== 'rejected') return;
    await adminNoticeService.raise(
      'update_failed',
      {
        host: await hostName(hostId),
        what: record.type === 'host.update_game' ? 'game' : 'plugins',
        error: record.errorMessage ?? record.errorCode ?? null,
      },
      dedupe
    );
  })();
};

/** The update each recorder was last seen running, to tell "finished" apart. */
const lastUpdateStatus = new Map<string, string>();

export async function sweepRecorders(at = now()): Promise<void> {
  const recorders = await db.queryAsync<{
    name: string;
    label: string | null;
    last_seen: number | null;
    enabled: number | boolean | null;
    update_status: string | null;
    update_error: string | null;
    update_id: string | null;
    recorder_revision: string | null;
    agent_version: string | null;
  }>(
    `SELECT name, label, last_seen, enabled, update_status, update_error, update_id, recorder_revision, agent_version
       FROM cs2_recorders`
  );
  for (const r of recorders) {
    const shown = r.label || r.name;
    const lastSeen = Number(r.last_seen ?? 0);
    const enabled = r.enabled === null || r.enabled === true || Number(r.enabled) === 1;
    const offline =
      enabled && lastSeen > at - 7 * 86400 && lastSeen < at - RECORDER_OFFLINE_SECONDS;
    if (offline) {
      await adminNoticeService.raise(
        'recorder_offline',
        { recorder: shown, lastSeen },
        `recorder_offline:${r.name}`,
        undefined,
        { ongoing: true }
      );
    } else if (lastSeen >= at - RECORDER_OFFLINE_SECONDS) {
      await adminNoticeService.resolve(`recorder_offline:${r.name}`);
    }
    const status = r.update_status ?? 'current';
    const before = lastUpdateStatus.get(r.name);
    lastUpdateStatus.set(r.name, status);
    if (status === 'failed' && before !== 'failed') {
      await adminNoticeService.raise(
        'recorder_update_failed',
        { recorder: shown, error: r.update_error },
        `recorder_update_failed:${r.name}`
      );
    }
    if (status === 'current' && before && before !== 'current' && before !== 'failed') {
      await adminNoticeService.resolve(`recorder_update_failed:${r.name}`);
      await adminNoticeService.raise(
        'recorder_updated',
        { recorder: shown, revision: r.recorder_revision, agentVersion: r.agent_version },
        `recorder_updated:${r.name}:${r.update_id ?? at}`
      );
    }
  }
}

/** A live match is silent when its server sent nothing for MATCH_SILENT_SECONDS and it is not paused. */
export function isSilentMatch(
  lastSeen: number,
  at: number,
  phase: string | null | undefined
): boolean {
  return at - lastSeen >= MATCH_SILENT_SECONDS && phase !== 'paused';
}

/** Notices sweepSilentMatches raised and has not closed, by match. */
const silentRaised = new Set<string>();

/**
 * Live matches whose server has gone quiet: no fleet event for the match in
 * MATCH_SILENT_SECONDS (a server that lost its players after a map change
 * kept a match "live" for hours, 2026-10-13). A paused match is left alone.
 */
export async function sweepSilentMatches(at = now()): Promise<void> {
  const rows = await db.queryAsync<{
    slug: string;
    last_ms: string | number | null;
    loaded_at: number | null;
  }>(
    `SELECT m.slug, m.loaded_at,
            (SELECT MAX(e.received_at) FROM cs2_fleet_events e WHERE e.match_slug = m.slug) AS last_ms
       FROM matches m
      WHERE m.status = 'live' AND m.server_id IS NOT NULL`
  );
  const { liveStateStore } = await import('./fleet/state');
  const silent = new Set<string>();
  for (const row of rows) {
    const lastSeen = row.last_ms
      ? Math.floor(Number(row.last_ms) / 1000)
      : Number(row.loaded_at ?? at);
    if (at - lastSeen < MATCH_SILENT_SECONDS) continue;
    const record = await liveStateStore.getLiveState(row.slug).catch(() => null);
    if (!isSilentMatch(lastSeen, at, record?.state?.phase)) continue;
    silent.add(row.slug);
    if (silentRaised.has(row.slug)) continue;
    silentRaised.add(row.slug);
    await adminNoticeService.raise(
      'match_silent',
      { matchSlug: row.slug, minutes: Math.floor((at - lastSeen) / 60) },
      `match_silent:${row.slug}`,
      undefined,
      { ongoing: true }
    );
  }
  for (const slug of [...silentRaised]) {
    if (silent.has(slug)) continue;
    silentRaised.delete(slug);
    await adminNoticeService.resolve(`match_silent:${slug}`);
  }
}

/** Clips and demo analyses that keep failing (this hour), and fine again. */
export async function sweepFailures(at = now()): Promise<void> {
  const hourAgo = at - 3600;
  const clips = await db.queryOneAsync<{ n: number; last: string | null }>(
    `SELECT COUNT(*)::int AS n, MAX(error) AS last FROM cs2_highlights
      WHERE status = 'failed' AND COALESCE(done_at, created_at) > ?`,
    [hourAgo]
  );
  if (Number(clips?.n ?? 0) >= FAILING_THRESHOLD) {
    await adminNoticeService.raise(
      'clips_failing',
      { count: Number(clips?.n), error: clips?.last ?? null },
      'clips_failing',
      undefined,
      { ongoing: true }
    );
  } else if (Number(clips?.n ?? 0) === 0) {
    await adminNoticeService.resolve('clips_failing');
  }
  const demos = await db.queryOneAsync<{ n: number; last: string | null }>(
    `SELECT COUNT(*)::int AS n, MAX(error) AS last FROM cs2_demo_jobs
      WHERE status = 'failed' AND COALESCE(finished_at, created_at) > ?`,
    [hourAgo]
  );
  if (Number(demos?.n ?? 0) >= FAILING_THRESHOLD) {
    await adminNoticeService.raise(
      'demos_failing',
      { count: Number(demos?.n), error: demos?.last ?? null },
      'demos_failing',
      undefined,
      { ongoing: true }
    );
  } else if (Number(demos?.n ?? 0) === 0) {
    await adminNoticeService.resolve('demos_failing');
  }
}

/** A Ready Up release newer than the oldest one the servers run. */
export async function sweepPluginUpdates(): Promise<void> {
  const rows = await db.queryAsync<{ plugin_version: string | null }>(
    'SELECT plugin_version FROM cs2_servers WHERE enabled = 1 AND plugin_version IS NOT NULL'
  );
  const versions = rows.map((r) => r.plugin_version).filter((v): v is string => Boolean(v));
  if (!versions.length) return;
  const { getLatestReadyUpRelease } = await import('./services/pluginVersionService');
  const { compareVersions } = await import('./services/readyUpVersion');
  const latest = await getLatestReadyUpRelease({ runningVersion: versions[0] }).catch(() => null);
  if (!latest) return;
  const behind = versions.filter((v) => (compareVersions(latest.version, v) ?? 0) > 0);
  const dedupe = `plugin_update_available:${latest.version}`;
  if (behind.length) {
    const open = await adminNoticeService.list(200);
    if (!open.some((n) => n.dedupeKey === dedupe && n.resolvedAt === null)) {
      await adminNoticeService.raise(
        'plugin_update_available',
        { version: latest.version, servers: behind.length },
        dedupe,
        undefined,
        { ongoing: true }
      );
    }
  } else {
    await adminNoticeService.resolve(dedupe);
  }
}

let timers: NodeJS.Timeout[] = [];

export function startCs2AdminNotices(): void {
  if (timers.length) return;
  hostEvents.on('health', onHealth);
  hostEvents.on('result', onResult);
  const minute = () =>
    Promise.all([sweepRecorders(), sweepFailures(), sweepSilentMatches()]).catch((error) =>
      log.debug('[ADMIN-NOTICES] CS2 sweep failed', { error })
    );
  const hourly = () =>
    sweepPluginUpdates().catch((error) =>
      log.debug('[ADMIN-NOTICES] plugin check failed', { error })
    );
  timers = [
    setTimeout(minute, 45_000),
    setInterval(minute, 60_000),
    setTimeout(hourly, 90_000),
    setInterval(hourly, 3600_000),
  ];
  timers.forEach((t) => t.unref?.());
}

export function stopCs2AdminNotices(): void {
  hostEvents.off('health', onHealth);
  hostEvents.off('result', onResult);
  timers.forEach((t) => clearTimeout(t));
  timers = [];
}
