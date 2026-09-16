/**
 * Server turnover: when may a server that just finished a series take the next match?
 *
 * After series_end the plugin holds the server while GOTV flushes the demo
 * (tv_delay + 15 s), uploads it, and then kicks players after its series-end
 * kick delay and reports `idle`. MAT then waited a fixed grace window on top of
 * that (120 s, 30 s simulated) measured from the idle timestamp, because it had
 * no way of knowing whether the upload had finished.
 *
 * It does know: MatchZy reports `demo_upload_ended` / `demo_upload_fail` per
 * map. This module tracks those per server so the allocator can
 *  - release a server as soon as it is idle after series_end with no demo
 *    upload outstanding, instead of sitting out the whole grace window, and
 *  - refuse a server whose last demo is still uploading, even past the grace
 *    window (a short kick delay makes the plugin report idle before the upload).
 *
 * All state is in memory. After an API restart nothing is known, and the
 * allocator falls back to the full grace window — the old behaviour.
 */

import { log } from './logger';

/** Minimum time a server must have been idle before an early release (plugin ResetMatch runs 2 s after idle). */
export const TURNOVER_MIN_IDLE_SECONDS = 5;

/** The plugin stops recording tv_delay + this many seconds after a map ends (MatchZy HandleMatchEnd). */
export const GOTV_FLUSH_EXTRA_SECONDS = 15;

/** Time allowed for the HTTP demo upload itself once recording has stopped. */
export const DEMO_UPLOAD_TIMEOUT_SECONDS = 150;

/**
 * tv_delay assumed when the match config does not set one (the server's own
 * value is unknown to MAT). CS2 caps tv_delay at 120 s.
 */
export const ASSUMED_TV_DELAY_SECONDS = 120;

/**
 * SourceTV delay sent to simulated matches. Bots only, so there is nothing to
 * ghost; recording stops GOTV_FLUSH_EXTRA_SECONDS after the map and the demo
 * uploads right away. Real matches never get this.
 */
export const SIMULATION_TV_DELAY_SECONDS = 0;

/**
 * An upload that has not reported back this long after its map ended is
 * presumed lost (plugin crash, dropped event) so the server is not held
 * forever: GOTV flush (tv_delay + 15 s) plus the upload timeout. At most
 * 120 + 15 + 150 = 285 s.
 */
export function demoUploadGiveUpSeconds(tvDelaySeconds: number): number {
  const tvDelay = Number.isFinite(tvDelaySeconds)
    ? Math.min(Math.max(tvDelaySeconds, 0), ASSUMED_TV_DELAY_SECONDS)
    : ASSUMED_TV_DELAY_SECONDS;
  return tvDelay + GOTV_FLUSH_EXTRA_SECONDS + DEMO_UPLOAD_TIMEOUT_SECONDS;
}

/** Cvars added to a match config: short tv_delay for simulations only. */
export function simulationTvCvars(isSimulation: boolean): Record<string, number> {
  if (!isSimulation) return {};
  return { tv_delay: SIMULATION_TV_DELAY_SECONDS, tv_delay1: SIMULATION_TV_DELAY_SECONDS };
}

/** tv_delay a match config sets, or the assumed server default when absent. */
export function tvDelayFromCvars(cvars: Record<string, string | number> | undefined): number {
  const raw = cvars?.tv_delay;
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : ASSUMED_TV_DELAY_SECONDS;
}

/** Series-end kick delays sent to servers while simulation mode is on (seconds). */
export const SIMULATION_SERIES_END_KICK_DELAY_SECONDS = 10;

/** Tolerance between the plugin's idle timestamp and MAT's series_end receipt time (clock skew). */
const IDLE_AFTER_SERIES_END_TOLERANCE_SECONDS = 10;

interface ServerTurnoverState {
  /** matchid of the series last loaded / seen on this server. */
  matchId: string | null;
  /** MAT configured a demo upload URL when it loaded that match. */
  demoUploadConfigured: boolean;
  /** tv_delay the loaded match runs with (bounds how long an upload may take). */
  tvDelaySeconds: number;
  /** Maps whose recording the plugin reported starting, keyed `${matchId}:${map}`. */
  recording: Set<string>;
  /** Maps that ended with an upload expected: key -> map end and give-up time (unix s). */
  pendingUploads: Map<string, { endedAt: number; giveUpAt: number }>;
  /** Maps whose upload already reported back (handles out-of-order events). */
  finishedUploads: Set<string>;
  /** When series_end for `matchId` arrived (unix s); null while the series runs. */
  seriesEndedAt: number | null;
}

export interface TurnoverDecision {
  /** A demo upload from the previous series is still outstanding. */
  demoUploadPending: boolean;
  /** Seconds until the last pending upload is given up on (null when none). */
  demoUploadGiveUpInSeconds: number | null;
  /** Idle after series_end with nothing outstanding: skip the rest of the grace window. */
  releaseEarly: boolean;
}

function mapKey(matchId: string, mapNumber: unknown): string {
  const n = typeof mapNumber === 'number' ? mapNumber : Number(mapNumber);
  return `${matchId}:${Number.isFinite(n) ? n : 0}`;
}

export class ServerTurnoverTracker {
  private readonly servers = new Map<string, ServerTurnoverState>();

  private state(serverId: string): ServerTurnoverState {
    let s = this.servers.get(serverId);
    if (!s) {
      s = {
        matchId: null,
        demoUploadConfigured: false,
        tvDelaySeconds: ASSUMED_TV_DELAY_SECONDS,
        recording: new Set(),
        pendingUploads: new Map(),
        finishedUploads: new Set(),
        seriesEndedAt: null,
      };
      this.servers.set(serverId, s);
    }
    return s;
  }

  private startSeries(s: ServerTurnoverState, matchId: string): void {
    s.matchId = matchId;
    s.seriesEndedAt = null;
    s.recording.clear();
    s.finishedUploads.clear();
  }

  /** A match was loaded on the server. Uploads still pending from before stay pending. */
  matchLoaded(
    serverId: string,
    matchId: string | number,
    demoUploadConfigured: boolean,
    tvDelaySeconds: number = ASSUMED_TV_DELAY_SECONDS
  ): void {
    const s = this.state(serverId);
    this.startSeries(s, String(matchId));
    s.demoUploadConfigured = demoUploadConfigured;
    s.tvDelaySeconds = tvDelaySeconds;
  }

  /**
   * Feed a MatchZy webhook event sent by `serverId`. Only the events that
   * matter for turnover are looked at.
   */
  recordEvent(serverId: string, event: Record<string, unknown>, now: number): void {
    if (!serverId || serverId === 'unknown') return;
    const rawMatchId = event.matchid;
    if (rawMatchId === undefined || rawMatchId === null || String(rawMatchId) === '-1') return;
    const matchId = String(rawMatchId);
    const s = this.state(serverId);

    switch (event.event) {
      case 'series_start':
        if (s.matchId !== matchId) {
          this.startSeries(s, matchId);
          s.demoUploadConfigured = false;
          s.tvDelaySeconds = ASSUMED_TV_DELAY_SECONDS;
        }
        return;
      case 'demo_recording_start':
        s.recording.add(mapKey(matchId, event.map_number));
        return;
      case 'map_result': {
        const key = mapKey(matchId, event.map_number);
        const expectsUpload =
          s.recording.has(key) || (s.matchId === matchId && s.demoUploadConfigured);
        if (expectsUpload && !s.finishedUploads.has(key) && !s.pendingUploads.has(key)) {
          s.pendingUploads.set(key, {
            endedAt: now,
            giveUpAt: now + demoUploadGiveUpSeconds(s.tvDelaySeconds),
          });
        }
        return;
      }
      case 'series_end':
        if (s.matchId !== matchId) {
          this.startSeries(s, matchId);
          s.demoUploadConfigured = false;
          s.tvDelaySeconds = ASSUMED_TV_DELAY_SECONDS;
        }
        s.seriesEndedAt = now;
        return;
      case 'demo_upload_success':
      case 'demo_upload_fail':
      case 'demo_upload_ended': {
        const key = mapKey(matchId, event.map_number);
        s.pendingUploads.delete(key);
        s.finishedUploads.add(key);
        return;
      }
      default:
        return;
    }
  }

  /**
   * Decide what the allocator may do with an idle server.
   * `idleSince` is the plugin's `matchzy_tournament_updated` timestamp.
   */
  evaluate(serverId: string, idleSince: number | null, now: number): TurnoverDecision {
    const s = this.servers.get(serverId);
    if (!s) {
      return { demoUploadPending: false, demoUploadGiveUpInSeconds: null, releaseEarly: false };
    }

    let latestGiveUp: number | null = null;
    for (const [key, pending] of s.pendingUploads) {
      if (now >= pending.giveUpAt) {
        s.pendingUploads.delete(key);
        log.warn(
          `[TURNOVER] Demo upload for ${key} on server ${serverId} never reported back ` +
            `${now - pending.endedAt}s after the map ended; releasing the server`
        );
        continue;
      }
      if (latestGiveUp === null || pending.giveUpAt > latestGiveUp) latestGiveUp = pending.giveUpAt;
    }
    const demoUploadPending = latestGiveUp !== null;

    const releaseEarly =
      !demoUploadPending &&
      s.seriesEndedAt !== null &&
      idleSince !== null &&
      idleSince >= s.seriesEndedAt - IDLE_AFTER_SERIES_END_TOLERANCE_SECONDS &&
      now - idleSince >= TURNOVER_MIN_IDLE_SECONDS;

    return {
      demoUploadPending,
      demoUploadGiveUpInSeconds:
        latestGiveUp === null ? null : latestGiveUp - now,
      releaseEarly,
    };
  }
}

export interface SeriesEndKickDelays {
  seriesEndKickDelayNoDemo: number | null;
  seriesEndKickDelayDemoNoUpload: number | null;
  seriesEndKickDelayDemoUpload: number | null;
}

/**
 * Kick delays to send with a match load. Real matches keep the admin's values
 * (players need time to see the result and leave). Simulated matches only have
 * bots, and MAT itself waits for the demo upload, so the plugin can go idle
 * as soon as its GOTV flush allows.
 */
export function resolveSeriesEndKickDelays(
  adminDefaults: SeriesEndKickDelays,
  isSimulation: boolean
): SeriesEndKickDelays {
  if (!isSimulation) {
    return {
      seriesEndKickDelayNoDemo: adminDefaults.seriesEndKickDelayNoDemo,
      seriesEndKickDelayDemoNoUpload: adminDefaults.seriesEndKickDelayDemoNoUpload,
      seriesEndKickDelayDemoUpload: adminDefaults.seriesEndKickDelayDemoUpload,
    };
  }
  const short = SIMULATION_SERIES_END_KICK_DELAY_SECONDS;
  return {
    seriesEndKickDelayNoDemo: short,
    seriesEndKickDelayDemoNoUpload: short,
    seriesEndKickDelayDemoUpload: short,
  };
}

/** Process-wide tracker fed by the events route and read by the allocator. */
export const serverTurnoverTracker = new ServerTurnoverTracker();
