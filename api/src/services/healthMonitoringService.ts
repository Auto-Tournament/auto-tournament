/**
 * Health Monitoring Service
 * Runs periodic checks to keep server online/offline status stable.
 */

import { log } from '../utils/logger';
import { serverService } from './serverService';
import { serverStatusService } from './serverStatusService';
import { serverTrackingService } from './serverTrackingService';

class HealthMonitoringService {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60 * 1000; // Check every 1 minute
  private readonly HEARTBEAT_RECENT_THRESHOLD_SECONDS = 5 * 60; // "recent events" window
  private readonly OFFLINE_FAILURE_THRESHOLD = 3; // Only mark offline after N consecutive failures

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.intervalId) {
      log.warn('[HEALTH-MONITOR] Already running');
      return;
    }

    log.info(
      `[HEALTH-MONITOR] Starting (check interval: ${this.CHECK_INTERVAL_MS / 1000}s, heartbeat recent: ${this.HEARTBEAT_RECENT_THRESHOLD_SECONDS}s, offline after: ${this.OFFLINE_FAILURE_THRESHOLD} consecutive failures)`
    );

    // Run immediately on start
    this.runHealthCheck();

    // Then run every minute
    this.intervalId = setInterval(() => {
      this.runHealthCheck();
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
    } catch (error) {
      log.error('[HEALTH-MONITOR] Health check failed', error as Error);
    }
  }

  /**
   * Get monitoring status
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

export const healthMonitoringService = new HealthMonitoringService();
