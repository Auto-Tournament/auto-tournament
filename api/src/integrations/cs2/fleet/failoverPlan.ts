/**
 * Failover decisions (FLEET.md §11), pure: when a server holding a match
 * counts as down, which spare server and which round backup to propose, and
 * the `match.assign.resume` block. No database, no sockets; ./failover.ts
 * feeds these from the live records and acts on the answers.
 */

import type {
  InlineBackup,
  MatchPhase,
  MatchState,
  MapStats,
  ResumeBlock,
} from './protocol/v1/types';
import type { RoundBackupMeta } from './backups';

/** Why the server counts as down; `restarted` = it came back without the match; `manual` = an admin moved it. */
export type FailoverReason = 'offline' | 'hung' | 'exited' | 'restarted' | 'manual';

/** How long a server may be unreachable before a proposal (FLEET.md §11.1). */
export interface FailoverGrace {
  /** live / paused / halftime / overtime: 90 s. */
  liveSeconds: number;
  /** loading / warmup / knife / side_pick / restoring (and no state yet): 30 s. */
  preLiveSeconds: number;
}

export const DEFAULT_FAILOVER_GRACE: FailoverGrace = { liveSeconds: 90, preLiveSeconds: 30 };

export function failoverGraceFromEnv(env: NodeJS.ProcessEnv = process.env): FailoverGrace {
  const read = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    liveSeconds: read(env.FLEET_FAILOVER_LIVE_SECONDS, DEFAULT_FAILOVER_GRACE.liveSeconds),
    preLiveSeconds: read(env.FLEET_FAILOVER_PRELIVE_SECONDS, DEFAULT_FAILOVER_GRACE.preLiveSeconds),
  };
}

const LIVE_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>([
  'live',
  'paused',
  'halftime',
  'overtime',
]);
/** Between maps or over: nothing to resume on another server. */
const NO_FAILOVER_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>(['map_end', 'series_end']);

/** The grace for a phase; null = no failover in this phase. `null` phase = no state yet (pre-live). */
export function graceSecondsFor(
  phase: MatchPhase | null,
  grace: FailoverGrace = DEFAULT_FAILOVER_GRACE
): number | null {
  if (phase && NO_FAILOVER_PHASES.has(phase)) return null;
  return phase && LIVE_PHASES.has(phase) ? grace.liveSeconds : grace.preLiveSeconds;
}

/** csm's last word on the server's process (`host.health`, FLEET.md §18). */
export interface HostHealthSignal {
  event: 'crashed' | 'exited' | 'hung' | 'recovered' | 'restarted';
  /** Unix seconds. */
  at: number;
  detail?: string;
}

export interface FailureInput {
  /** The server has a live, welcomed socket. */
  online: boolean;
  /** Unix seconds since when it is unreachable (null while online). */
  offlineSince: number | null;
  now: number;
  phase: MatchPhase | null;
  health: HostHealthSignal | null;
  grace?: FailoverGrace;
}

export interface Failure {
  reason: FailoverReason;
  /** Unix seconds: when the server went down. */
  since: number;
  detail: string;
}

/**
 * Whether the server holding a match counts as down (FLEET.md §11.1):
 * csm says its process is gone (`exited` / `crashed`) or hung (`/health` not
 * OK for 30 s, csm's own wait), or the link has been down for the phase's
 * grace (90 s live, 30 s before it; the gateway already closes a socket after
 * 30 s without a frame, so a lost heartbeat starts the clock too).
 */
export function detectFailure(input: FailureInput): Failure | null {
  const grace = graceSecondsFor(input.phase, input.grace);
  if (grace === null) return null;
  const health = input.health;
  if (health && (health.event === 'exited' || health.event === 'crashed')) {
    return {
      reason: 'exited',
      since: health.at,
      detail: health.detail
        ? `csm: the server process stopped (${health.detail})`
        : 'csm: the server process stopped',
    };
  }
  if (health && health.event === 'hung') {
    return {
      reason: 'hung',
      since: health.at,
      detail: health.detail
        ? `csm: the server is hung (${health.detail})`
        : 'csm: the server is hung (/health not OK)',
    };
  }
  if (input.online) return null;
  const since = input.offlineSince ?? input.now;
  const down = input.now - since;
  if (down < grace) return null;
  return {
    reason: 'offline',
    since,
    detail: `the fleet link has been down for ${Math.round(down)} s`,
  };
}

/**
 * The round backup to resume from: the latest one of the map that a restore
 * has not voided (FLEET.md §11.2 preselects the latest; the admin may pick
 * another). null = none yet: the map restarts from warmup.
 */
export function pickBackup<T extends Pick<RoundBackupMeta, 'mapNumber' | 'round' | 'supersededAt'>>(
  backups: readonly T[],
  mapNumber: number
): T | null {
  let best: T | null = null;
  for (const b of backups) {
    if (b.mapNumber !== mapNumber || b.supersededAt !== null) continue;
    if (!best || b.round > best.round) best = b;
  }
  return best;
}

export interface FailoverCandidate {
  /** The linked cs2_servers row. */
  cs2ServerId: string;
  fleetServerId: string;
  name: string;
  cs2Build: number | null;
  capabilities: readonly string[];
}

/**
 * The spare server to propose (FLEET.md §11.1: available, same capabilities
 * and CS2 build): never the one that went down; the admin's pick when it is
 * free; else one on the same CS2 build with at least the failed server's
 * capabilities, then the same build, then any, by name.
 */
export function pickTarget(
  candidates: readonly FailoverCandidate[],
  failed: {
    cs2ServerId: string | null;
    fleetServerId: string | null;
    cs2Build: number | null;
    capabilities: readonly string[];
  },
  preferred?: string | null,
  exclude: readonly string[] = []
): FailoverCandidate | null {
  const usable = candidates.filter(
    (c) =>
      c.cs2ServerId !== failed.cs2ServerId &&
      c.fleetServerId !== failed.fleetServerId &&
      (c.cs2ServerId === preferred || !exclude.includes(c.cs2ServerId))
  );
  if (preferred) {
    const chosen = usable.find((c) => c.cs2ServerId === preferred);
    if (chosen) return chosen;
  }
  const rank = (c: FailoverCandidate) => {
    const sameBuild = failed.cs2Build !== null && c.cs2Build === failed.cs2Build;
    const hasCaps = failed.capabilities.every((cap) => c.capabilities.includes(cap));
    return (sameBuild ? 0 : 2) + (hasCaps ? 0 : 1);
  };
  const sorted = [...usable].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name) ||
      a.cs2ServerId.localeCompare(b.cs2ServerId)
  );
  return sorted[0] ?? null;
}

export interface ResumeInput {
  fromEpoch: number;
  /** Fleet map number (1-based). */
  mapNumber: number;
  /** The chosen backup's round; 0 = restart the map from warmup. */
  round: number;
  /** The backup inline (preferred), else a reference to it by file + sha256. */
  backup: InlineBackup | null;
  backupRef: { file: string; sha256: string } | null;
  /** The platform's last state of the match (from the failed epoch). */
  state: MatchState | null;
  mapStats: MapStats | null;
}

/**
 * `match.assign.resume` (FLEET.md §11.3): the map, the round and the backup,
 * with what the new server cannot know: the series score and the results of
 * the earlier maps, and the resumed map's sides when the knife was decided.
 */
export function buildResume(input: ResumeInput): ResumeBlock {
  const resume: ResumeBlock = {
    from_epoch: input.fromEpoch,
    map_number: input.mapNumber,
    round: input.round,
  };
  if (input.round >= 1) {
    if (input.backup) resume.backup = input.backup;
    else if (input.backupRef)
      resume.backup_ref = { file: input.backupRef.file, sha256: input.backupRef.sha256 };
  }
  const series = input.state?.series;
  if (series) {
    const maps: NonNullable<ResumeBlock['maps']> = {};
    for (const [key, map] of Object.entries(series.maps ?? {})) {
      const n = Number(key);
      if (!Number.isInteger(n) || n >= input.mapNumber || map.status !== 'done') continue;
      maps[key] = {
        ...(map.score ? { score: { team1: map.score.team1, team2: map.score.team2 } } : {}),
        ...(map.winner ? { winner: map.winner } : {}),
      };
    }
    resume.series_score = { team1: series.score.team1, team2: series.score.team2 };
    if (Object.keys(maps).length > 0) resume.maps = maps;
    const sides = series.maps?.[String(input.mapNumber)]?.sides;
    if (sides === 'team1_ct' || sides === 'team2_ct') resume.sides = sides;
  }
  if (input.backup)
    resume.score = { team1: input.backup.score.team1, team2: input.backup.score.team2 };
  // Ready Up drops the rounds from `round` on itself.
  if (input.mapStats && input.round >= 1 && series?.current_map === input.mapNumber) {
    resume.map_stats = input.mapStats;
  }
  return resume;
}

/**
 * How many idle fleet servers normal allocation leaves alone, for failover:
 * the admin's number, else 1 once the pool has two servers (0 below that).
 * Never the whole pool: at least one server can always take a match.
 */
export function effectiveReserve(configured: number | null, poolSize: number): number {
  const wanted = configured ?? (poolSize >= 2 ? 1 : 0);
  return Math.max(0, Math.min(Math.floor(wanted), poolSize - 1));
}

/** Which of the idle servers are held: the last `count` by name (stable between passes). */
export function pickReserved<T extends { id: string; name: string }>(
  idle: readonly T[],
  count: number
): Set<string> {
  if (count <= 0) return new Set();
  const sorted = [...idle].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return new Set(sorted.slice(Math.max(0, sorted.length - count)).map((s) => s.id));
}
