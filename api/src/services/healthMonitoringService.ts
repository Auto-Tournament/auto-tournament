/**
 * Health Monitoring Service
 * Runs periodic checks to keep server online/offline status stable.
 */

import { log } from '../utils/logger';
import { serverService } from './serverService';
import { serverStatusService } from './serverStatusService';
import { serverTrackingService } from './serverTrackingService';
import { cs2FleetMonitoringService } from './cs2FleetMonitoringService';
import type { Server } from '../types/server.types';

class HealthMonitoringService {
  private intervalId: NodeJS.Timeout | null = null;
  private inProgress = false;
  private readonly CHECK_INTERVAL_MS = 60 * 1000; // Check every 1 minute
  private readonly HEARTBEAT_RECENT_THRESHOLD_SECONDS = 5 * 60; // "recent events" window
  private readonly OFFLINE_FAILURE_THRESHOLD = 3; // Only mark offline after N consecutive failures
  private readonly CS2_FLEET_CHECK_INTERVAL_SECONDS = 5 * 60; // 5 minutes
  private lastCs2FleetCheckAt: number | null = null; // unix seconds

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.intervalId) {
      log.warn('[HEALTH-MONITOR] Already running');
      return;
    }

    log.info(
      `[HEALTH-MONITOR] Starting (check interval: ${this.CHECK_INTERVAL_MS / 1000}s, heartbeat recent: ${this.HEARTBEAT_RECENT_THRESHOLD_SECONDS}s, offline after: ${this.OFFLINE_FAILURE_THRESHOLD} consecutive failures, cs2 fleet: ${this.CS2_FLEET_CHECK_INTERVAL_SECONDS}s)`
    );

    // Run immediately on start
    void this.runHealthCheck();

    // Then run every minute
    this.intervalId = setInterval(() => {
      void this.runHealthCheck();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info('[HEALTH-MONITOR] Stopped');
    }
  }

  /**
   * Run a health check cycle
   */
  private async runHealthCheck(): Promise<void> {
    if (this.inProgress) {
      log.warn('[HEALTH-MONITOR] Previous cycle still running; skipping this tick');
      return;
    }

    this.inProgress = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const servers = await serverService.getAllServers(true);

      serverTrackingService.pruneReachabilityFailures(new Set(servers.map((s) => s.id)));

      let markedOnline = 0;
      let markedOffline = 0;

      for (const server of servers) {
        const lastSeen = server.lastSeen;
        const heartbeatRecent =
          typeof lastSeen === 'number' && now - lastSeen <= this.HEARTBEAT_RECENT_THRESHOLD_SECONDS;

        // If we saw MatchZy events recently, treat server as Online even if reachability checks fail.
        // This matches the desired semantics: Online = (recent events) OR (reachable from API).
        if (heartbeatRecent) {
          serverTrackingService.recordReachability(server.id, true);
          if (await serverTrackingService.markServerOnline(server.id, 'recent events')) {
            markedOnline += 1;
          }
          continue;
        }

        const reachability = await serverStatusService.getServerStatus(server.id, true);
        const ok = reachability.online;

        const failures = serverTrackingService.recordReachability(server.id, ok);

        if (ok) {
          if (await serverTrackingService.markServerOnline(server.id, 'reachable')) {
            markedOnline += 1;
          }
          continue;
        }

        if (serverTrackingService.shouldMarkOffline(server.id, this.OFFLINE_FAILURE_THRESHOLD)) {
          if (
            await serverTrackingService.markServerOffline(
              server.id,
              `unreachable (${failures}/${this.OFFLINE_FAILURE_THRESHOLD})`
            )
          ) {
            markedOffline += 1;
          }
        }
      }

      if (markedOffline > 0 || markedOnline > 0) {
        log.info(
          `[HEALTH-MONITOR] Cycle complete (servers=${servers.length}, markedOnline=${markedOnline}, markedOffline=${markedOffline})`
        );
      } else {
        log.debug('[HEALTH-MONITOR] All servers healthy');
      }

      // CS2 fleet monitoring (RCON BuildID + Steam UpToDateCheck) is orchestrated here
      // so we have a single authoritative monitoring cadence.
      void this.maybeRunCs2FleetCheck(servers, now);
    } catch (error) {
      log.error('[HEALTH-MONITOR] Health check failed', error as Error);
    } finally {
      this.inProgress = false;
    }
  }

  private async maybeRunCs2FleetCheck(servers: Server[], now: number): Promise<void> {
    const last = this.lastCs2FleetCheckAt;
    const due = typeof last !== 'number' || now - last >= this.CS2_FLEET_CHECK_INTERVAL_SECONDS;
    if (!due) return;

    this.lastCs2FleetCheckAt = now;

    const enabled = servers.filter((s) => s.enabled === 1 && s.host !== '0.0.0.0');
    const outdated = enabled.filter((s) => typeof s.cs2_required_version === 'number');
    const stale = enabled.filter(
      (s) => !s.cs2_update_checked_at || now - s.cs2_update_checked_at >= 30 * 60
    );

    log.info('[HEALTH-MONITOR] Starting CS2 fleet check', {
      enabled: enabled.length,
      outdated: outdated.length,
      stale: stale.length,
    });

    const stats = await cs2FleetMonitoringService.runOnce({ servers, now });

    if (stats.skippedBecauseInProgress) {
      log.warn('[HEALTH-MONITOR] CS2 fleet check skipped (already running)', stats);
      return;
    }

    log.info('[HEALTH-MONITOR] CS2 fleet check complete', stats);
  }

  /**
   * Get monitoring status
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

export const healthMonitoringService = new HealthMonitoringService();
