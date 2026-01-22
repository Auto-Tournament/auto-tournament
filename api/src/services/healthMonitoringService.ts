/**
 * Health Monitoring Service
 * Runs periodic checks to mark inactive servers as offline
 */

import { log } from '../utils/logger';
import { serverTrackingService } from './serverTrackingService';

class HealthMonitoringService {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60 * 1000; // Check every 1 minute
  private readonly INACTIVE_THRESHOLD_MINUTES = 5; // Mark offline after 5 minutes

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.intervalId) {
      log.warn('[HEALTH-MONITOR] Already running');
      return;
    }

    log.info(
      `[HEALTH-MONITOR] Starting (check interval: ${this.CHECK_INTERVAL_MS / 1000}s, inactive threshold: ${this.INACTIVE_THRESHOLD_MINUTES}m)`
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
      const result = await serverTrackingService.markInactiveServersOffline(
        this.INACTIVE_THRESHOLD_MINUTES
      );

      if (result.markedOffline > 0) {
        log.warn(`[HEALTH-MONITOR] Marked ${result.markedOffline} server(s) as offline`);
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
