/**
 * Server Tracking Service
 * Handles automatic server registration and health monitoring from MatchZy Enhanced
 * 
 * MatchZy servers send a 'server_configured' event when they connect to the API.
 * We track:
 * - Server registration and configuration
 * - Heartbeat (last_seen timestamp on every event)
 * - Health status (online/offline based on heartbeat)
 * - Plugin version tracking
 */

import { db } from '../config/database';
import { log } from '../utils/logger';

export interface ServerConfiguredEvent {
  event: 'server_configured';
  server_id: string;
  hostname: string;
  plugin_version: string;
  remote_log_url: string;
  timestamp: number;
  configured_by: 'Console' | 'Startup';
}

export interface Cs2UpdateRequiredEvent {
  event: 'cs2_update_required';
  matchid: -1;
  server_id: string;
  required_version: number;
  phase?: 'available' | 'shutdown';
  timestamp: number;
}

export interface ServerHealthEvent {
  event: 'server_health';
  server_id: string;
  plugin_version: string;
  timestamp: number;
  db_ok: boolean;
  db_type: 'sqlite' | 'mysql' | string;
  db_error?: string | null;
  reason?: 'startup' | 'periodic' | 'change' | string;
}

class ServerTrackingService {
  /**
   * In-memory reachability failure counter per server.
   * This avoids flapping "offline" due to transient RCON issues.
   *
   * NOTE: This is intentionally not persisted (no DB migration required).
   */
  private readonly reachabilityFailureCounts = new Map<string, number>();

  recordReachability(serverId: string, ok: boolean): number {
    if (ok) {
      this.reachabilityFailureCounts.delete(serverId);
      return 0;
    }

    const next = (this.reachabilityFailureCounts.get(serverId) ?? 0) + 1;
    this.reachabilityFailureCounts.set(serverId, next);
    return next;
  }

  shouldMarkOffline(serverId: string, failureThreshold: number): boolean {
    if (failureThreshold <= 0) return true;
    return (this.reachabilityFailureCounts.get(serverId) ?? 0) >= failureThreshold;
  }

  pruneReachabilityFailures(activeServerIds: Set<string>): void {
    for (const serverId of this.reachabilityFailureCounts.keys()) {
      if (!activeServerIds.has(serverId)) {
        this.reachabilityFailureCounts.delete(serverId);
      }
    }
  }

  async markServerOnline(serverId: string, reason?: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);

    // Only update when it actually changes to avoid noisy writes/logs.
    const result = await db.updateAsync(
      'servers',
      { status: 'online', updated_at: now },
      "id = ? AND (status IS NULL OR status != 'online')",
      [serverId]
    );

    if (result.changes > 0) {
      log.info(`[SERVER-TRACKING] ✓ Marked server online: ${serverId}${reason ? ` (${reason})` : ''}`);
      return true;
    }

    return false;
  }

  async markServerOffline(serverId: string, reason?: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);

    // Only update when it actually changes to avoid noisy writes/logs.
    const result = await db.updateAsync(
      'servers',
      { status: 'offline', updated_at: now },
      "id = ? AND (status IS NULL OR status != 'offline')",
      [serverId]
    );

    if (result.changes > 0) {
      log.warn(`[SERVER-TRACKING] ⚠️  Marked server offline: ${serverId}${reason ? ` (${reason})` : ''}`);
      return true;
    }

    return false;
  }

  /**
   * Handle server_configured event from MatchZy
   * Registers or updates server information
   */
  async handleServerConfigured(event: ServerConfiguredEvent): Promise<void> {
    try {
      const { server_id, hostname, plugin_version, timestamp } = event;
      const lastSeen = Math.floor(timestamp || Date.now() / 1000);
      const now = Math.floor(Date.now() / 1000);

      // Check if server exists
      const existingServer = await db.queryOneAsync<{ id: string }>(
        'SELECT id FROM servers WHERE id = ?',
        [server_id]
      );

      if (existingServer) {
        // Update existing server
        await db.updateAsync(
          'servers',
          {
            hostname,
            plugin_version,
            last_seen: lastSeen,
            status: 'online',
            server_can_reach_api_at: now,
            // On startup we consider the server "back" and clear any stale
            // CS2 update-required banner. If the server is still out of date,
            // it will report it again shortly.
            ...(event.configured_by === 'Startup'
              ? {
                  cs2_required_version: null,
                  cs2_update_phase: null,
                  cs2_update_required_at: null,
                }
              : {}),
            updated_at: now,
          },
          'id = ?',
          [server_id]
        );

        log.success(
          `[SERVER-TRACKING] ✓ Server updated: ${server_id} (${hostname}) - Plugin v${plugin_version}`
        );
      } else {
        // Server doesn't exist in database yet
        // Log it but don't create automatically (servers must be added via admin UI)
        log.info(
          `[SERVER-TRACKING] ℹ️  Unknown server connected: ${server_id} (${hostname})`
        );
        log.info(
          `[SERVER-TRACKING] ℹ️  Add this server via admin UI to enable tracking`
        );
      }
    } catch (error) {
      log.error('[SERVER-TRACKING] Failed to handle server_configured event', error as Error);
    }
  }

  async setServerHealth(
    serverId: string,
    health: { dbOk: boolean; dbType: string; dbError?: string | null; timestamp?: number }
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ts = Math.floor(health.timestamp ?? now);
    const matchzyDbLastOkAt = health.dbOk ? ts : null;

    try {
      await db.updateAsync(
        'servers',
        {
          matchzy_db_ok: health.dbOk ? 1 : 0,
          matchzy_db_type: health.dbType,
          matchzy_db_error: health.dbOk ? null : health.dbError ?? null,
          matchzy_db_last_ok_at: matchzyDbLastOkAt,
          matchzy_db_last_seen_at: ts,
          server_can_reach_api_at: now,
          updated_at: now,
        },
        'id = ?',
        [serverId]
      );
    } catch (error) {
      log.warn(`[SERVER-TRACKING] Failed to persist server health for ${serverId}`, { error });
    }
  }

  async setCs2UpdateRequired(
    serverId: string,
    requiredVersion: number,
    opts?: { phase?: string | null; timestamp?: number }
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ts = Math.floor(opts?.timestamp ?? now);
    const phase = opts?.phase ?? null;
    try {
      await db.updateAsync(
        'servers',
        {
          cs2_required_version: requiredVersion,
          cs2_update_phase: phase,
          cs2_update_required_at: ts,
          updated_at: now,
        },
        'id = ?',
        [serverId]
      );
    } catch (error) {
      log.warn(`[SERVER-TRACKING] Failed to persist CS2 update-required for ${serverId}`, {
        error,
      });
    }
  }

  /**
   * Update server heartbeat (last_seen timestamp)
   * Called on EVERY event from a server
   */
  async updateHeartbeat(serverId: string): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);

      const result = await db.updateAsync(
        'servers',
        {
          last_seen: now,
          status: 'online',
          server_can_reach_api_at: now,
          updated_at: now,
        },
        'id = ?',
        [serverId]
      );
      
      if (result.changes === 0) {
        log.warn(`[SERVER-TRACKING] Heartbeat update for ${serverId} affected 0 rows - server not found in database`);
      } else {
        log.info(`[SERVER-TRACKING] ✓ Heartbeat updated for ${serverId}`);
      }

      // A fresh event is a strong online signal; reset reachability failures.
      this.recordReachability(serverId, true);
    } catch (error) {
      log.warn(`[SERVER-TRACKING] Failed to update heartbeat for ${serverId}`, { error });
    }
  }

  /**
   * Mark servers as offline if they haven't sent events in X minutes
   * Should be called by a cron job every minute
   */
  async markInactiveServersOffline(
    inactiveThresholdMinutes: number = 5
  ): Promise<{ markedOffline: number }> {
    try {
      const thresholdTimestamp = Math.floor(Date.now() / 1000) - inactiveThresholdMinutes * 60;

      // Find servers that were online but haven't sent events recently
      const inactiveServers = await db.queryAsync<{ id: string; name: string }>(
        `SELECT id, name FROM servers 
         WHERE status = 'online' 
         AND last_seen IS NOT NULL 
         AND last_seen < ?`,
        [thresholdTimestamp]
      );

      if (inactiveServers.length > 0) {
        // Mark as offline
        for (const server of inactiveServers) {
          await db.updateAsync(
            'servers',
            {
              status: 'offline',
              updated_at: Math.floor(Date.now() / 1000),
            },
            'id = ?',
            [server.id]
          );
        }

        log.warn(
          `[SERVER-TRACKING] ⚠️  Marked ${inactiveServers.length} server(s) as offline:`,
          {
            servers: inactiveServers.map((s) => `${s.name} (${s.id})`),
          }
        );

        return { markedOffline: inactiveServers.length };
      }

      return { markedOffline: 0 };
    } catch (error) {
      log.error('[SERVER-TRACKING] Failed to mark inactive servers offline', error as Error);
      return { markedOffline: 0 };
    }
  }

  /**
   * Get server statistics
   */
  async getServerStats(): Promise<{
    total: number;
    online: number;
    offline: number;
    unknown: number;
  }> {
    try {
      const total = await db.queryOneAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM servers'
      );

      const online = await db.queryOneAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM servers WHERE status = 'online'"
      );

      const offline = await db.queryOneAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM servers WHERE status = 'offline'"
      );

      const unknown = await db.queryOneAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM servers WHERE status = 'unknown' OR status IS NULL"
      );

      return {
        total: total?.count || 0,
        online: online?.count || 0,
        offline: offline?.count || 0,
        unknown: unknown?.count || 0,
      };
    } catch (error) {
      log.error('[SERVER-TRACKING] Failed to get server stats', error as Error);
      return { total: 0, online: 0, offline: 0, unknown: 0 };
    }
  }
}

export const serverTrackingService = new ServerTrackingService();
