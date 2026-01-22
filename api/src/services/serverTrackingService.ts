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

class ServerTrackingService {
  /**
   * Handle server_configured event from MatchZy
   * Registers or updates server information
   */
  async handleServerConfigured(event: ServerConfiguredEvent): Promise<void> {
    try {
      const { server_id, hostname, plugin_version, timestamp } = event;
      const lastSeen = Math.floor(timestamp || Date.now() / 1000);

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
            updated_at: Math.floor(Date.now() / 1000),
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

  /**
   * Update server heartbeat (last_seen timestamp)
   * Called on EVERY event from a server
   */
  async updateHeartbeat(serverId: string): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);

      await db.updateAsync(
        'servers',
        {
          last_seen: now,
          status: 'online',
          updated_at: now,
        },
        'id = ?',
        [serverId]
      );
    } catch {
      // Silently fail - server might not be registered yet
      // This is normal during initial connection
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
