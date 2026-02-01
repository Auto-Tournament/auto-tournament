/**
 * CS2 fleet monitoring service
 *
 * Goal: Keep cs2_required_version accurate without relying on servers to emit
 * cs2_update_required events, and without requiring admins to manually refresh
 * each server.
 *
 * Strategy:
 * - Periodically check enabled servers via RCON `version` -> BuildID
 * - Verify BuildID via Steam UpToDateCheck
 * - Persist cs2_required_version (+ timestamps) so allocator/UI can block outdated servers
 *
 * This runs with a low cadence and sequentially to avoid hammering either
 * the servers (RCON) or Steam.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { serverService } from './serverService';
import { rconService } from './rconService';
import { parseCs2BuildId } from '../utils/cs2Version';
import { cs2UpdateService } from './cs2UpdateService';
import type { Server } from '../types/server.types';

export interface Cs2FleetCycleStats {
  /** Unix timestamp when the cycle ran. */
  now: number;
  /** Number of servers considered for queuing (enabled, non-fake). */
  eligible: number;
  /** Number of servers selected for checking this cycle (outdated+stale, deduped). */
  considered: number;
  /** Number of servers we successfully checked against Steam. */
  checked: number;
  /** Number of servers newly marked out-of-date in this cycle. */
  markedOutOfDate: number;
  /** Number of servers cleared from out-of-date in this cycle. */
  clearedOutOfDate: number;
  /** Number of servers that failed RCON/version parsing/Steam check. */
  failed: number;
  /** Number of outdated servers in the queue. */
  queuedOutOfDate: number;
  /** Number of stale servers in the queue. */
  queuedStale: number;
  /** True if a cycle was skipped because another was already running. */
  skippedBecauseInProgress?: boolean;
}

class Cs2FleetMonitoringService {
  private readonly STALE_AFTER_SECONDS = 30 * 60; // 30 minutes (full fleet refresh window)
  private inProgress = false;

  /**
   * Run one CS2 version check cycle.
   *
   * This is intentionally sequential to avoid hammering either RCON or Steam.
   * Scheduling/cadence is controlled by the caller (typically health monitoring).
   */
  async runOnce(params?: { servers?: Server[]; now?: number }): Promise<Cs2FleetCycleStats> {
    if (this.inProgress) {
      return {
        now: params?.now ?? Math.floor(Date.now() / 1000),
        eligible: 0,
        considered: 0,
        checked: 0,
        markedOutOfDate: 0,
        clearedOutOfDate: 0,
        failed: 0,
        queuedOutOfDate: 0,
        queuedStale: 0,
        skippedBecauseInProgress: true,
      };
    }

    this.inProgress = true;
    try {
      const now = params?.now ?? Math.floor(Date.now() / 1000);
      const servers = params?.servers ?? (await serverService.getAllServers(true));

      const enabled = servers.filter((s) => s.enabled === 1);
      const eligible = enabled.filter((s) => s.host !== '0.0.0.0');

      // Prioritize servers that are currently marked out of date.
      const markedOutOfDate = eligible.filter((s) => typeof s.cs2_required_version === 'number');
      const stale = eligible.filter(
        (s) => !s.cs2_update_checked_at || now - s.cs2_update_checked_at >= this.STALE_AFTER_SECONDS
      );

      // Deduplicate: out-of-date first, then stale.
      const queue: typeof eligible = [];
      const seen = new Set<string>();
      for (const s of [...markedOutOfDate, ...stale]) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        queue.push(s);
      }

      if (queue.length === 0) {
        log.debug('[CS2-FLEET] No servers require CS2 version check');
        return {
          now,
          eligible: eligible.length,
          considered: 0,
          checked: 0,
          markedOutOfDate: 0,
          clearedOutOfDate: 0,
          failed: 0,
          queuedOutOfDate: markedOutOfDate.length,
          queuedStale: stale.length,
        };
      }

      let checked = 0;
      let marked = 0;
      let cleared = 0;
      let failed = 0;

      for (const s of queue) {
        try {
          const versionResult = await rconService.sendCommand(s.id, 'version');
          if (!versionResult.success || typeof versionResult.response !== 'string') {
            failed += 1;
            continue;
          }

          const buildId = parseCs2BuildId(versionResult.response);
          if (!buildId) {
            failed += 1;
            continue;
          }

          const check = await cs2UpdateService.upToDateCheck(buildId);
          checked += 1;

          if (check.upToDate) {
            await db.updateAsync(
              'servers',
              {
                cs2_build_id: buildId,
                cs2_version_string: versionResult.response,
                cs2_version_fetched_at: now,
                cs2_required_version: null,
                cs2_update_phase: null,
                cs2_update_required_at: null,
                cs2_update_checked_at: now,
                updated_at: now,
              },
              'id = ?',
              [s.id]
            );
            if (typeof s.cs2_required_version === 'number') {
              cleared += 1;
            }
          } else {
            await db.updateAsync(
              'servers',
              {
                cs2_build_id: buildId,
                cs2_version_string: versionResult.response,
                cs2_version_fetched_at: now,
                cs2_required_version: check.requiredVersion ?? null,
                cs2_update_phase: (s.cs2_update_phase === 'shutdown' ? 'shutdown' : 'available'),
                cs2_update_required_at: now,
                cs2_update_checked_at: now,
                updated_at: now,
              },
              'id = ?',
              [s.id]
            );
            if (typeof s.cs2_required_version !== 'number') {
              marked += 1;
            }
          }
        } catch {
          failed += 1;
        }
      }

      const stats: Cs2FleetCycleStats = {
        now,
        eligible: eligible.length,
        considered: queue.length,
        checked,
        markedOutOfDate: marked,
        clearedOutOfDate: cleared,
        failed,
        queuedOutOfDate: markedOutOfDate.length,
        queuedStale: stale.length,
      };

      log.debug('[CS2-FLEET] Cycle complete', stats);
      return stats;
    } catch (error) {
      log.warn('[CS2-FLEET] Cycle failed', { error });
      return {
        now: params?.now ?? Math.floor(Date.now() / 1000),
        eligible: 0,
        considered: 0,
        checked: 0,
        markedOutOfDate: 0,
        clearedOutOfDate: 0,
        failed: 0,
        queuedOutOfDate: 0,
        queuedStale: 0,
      };
    } finally {
      this.inProgress = false;
    }
  }
}

export const cs2FleetMonitoringService = new Cs2FleetMonitoringService();

