/**
 * Server Initialization Service
 * Handles sending persistent MatchZy configuration to servers on first connection
 * 
 * With the updated MatchZy plugin, certain configuration values are now persisted
 * to the server's database and survive restarts. This means we only need to send
 * them once (or when they change), not on every match load.
 * 
 * Before sending config we run matchzy_clear_event_queue so the server does not
 * keep retrying webhooks against a wrong URL.
 *
 * Persistent configuration includes:
 * - matchzy_remote_log_url (webhook endpoint)
 * - matchzy_demo_upload_url (demo upload endpoint)
 * - matchzy_chat_prefix
 * - matchzy_admin_chat_prefix
 * - matchzy_server_id
 */

import { db } from '../config/database';
import { rconService } from './rconService';
import { log } from '../utils/logger';
// NOTE: Remaining MatchZy configuration is fetched by the server itself
// via /api/servers/:id/bootstrap to avoid RCON command churn.

export interface ServerInitializationResult {
  success: boolean;
  alreadyInitialized: boolean;
  error?: string;
  configsSent?: string[];
}

class ServerInitializationService {
  /**
   * Check if a server has been initialized with persistent configuration
   */
  async isServerInitialized(serverId: string): Promise<boolean> {
    try {
      const server = await db.queryOneAsync<{ persistent_config_sent: number | null }>(
        'SELECT persistent_config_sent FROM servers WHERE id = ?',
        [serverId]
      );
      return server?.persistent_config_sent !== null;
    } catch (error) {
      log.error(`Failed to check if server ${serverId} is initialized`, error as Error);
      return false;
    }
  }

  /**
   * Mark server as initialized (persistent config has been sent)
   */
  async markServerInitialized(serverId: string): Promise<void> {
    try {
      await db.updateAsync(
        'servers',
        { persistent_config_sent: Math.floor(Date.now() / 1000) },
        'id = ?',
        [serverId]
      );
      log.info(`[SERVER-INIT] Server ${serverId} marked as initialized`);
    } catch (error) {
      log.error(`Failed to mark server ${serverId} as initialized`, error as Error);
    }
  }

  /**
   * Reset initialization status (forces re-initialization on next use)
   * Use this when configuration has changed and needs to be re-sent
   */
  async resetServerInitialization(serverId: string): Promise<void> {
    try {
      await db.updateAsync(
        'servers',
        { persistent_config_sent: null },
        'id = ?',
        [serverId]
      );
      log.info(`[SERVER-INIT] Server ${serverId} initialization reset - will be reconfigured on next use`);
    } catch (error) {
      log.error(`Failed to reset server ${serverId} initialization`, error as Error);
    }
  }

  /**
   * Send persistent configuration to a server
   * This should only be called once per server (or when config changes)
   */
  async initializeServer(
    serverId: string,
    baseUrl: string,
    options: {
      force?: boolean; // Force re-initialization even if already initialized
    } = {}
  ): Promise<ServerInitializationResult> {
    const { force = false } = options;
    const serverToken = process.env.SERVER_TOKEN || '';
    const configsSent: string[] = [];

    try {
      // Check if already initialized
      if (!force) {
        const alreadyInitialized = await this.isServerInitialized(serverId);
        if (alreadyInitialized) {
          log.debug(`[SERVER-INIT] Server ${serverId} already initialized, skipping`);
          return {
            success: true,
            alreadyInitialized: true,
          };
        }
      }

      if (!serverToken) {
        log.error('[SERVER-INIT] Cannot initialize server: SERVER_TOKEN not set');
        return {
          success: false,
          alreadyInitialized: false,
          error: 'SERVER_TOKEN is required for server initialization',
        };
      }

      log.info(`[SERVER-INIT] Initializing server ${serverId} via bootstrap URL`);

      const bootstrapUrl = `${baseUrl}/api/servers/${serverId}/bootstrap`;
      const errors: string[] = [];

      const commands = [
        'matchzy_clear_event_queue',
        `matchzy_server_id "${serverId}"`,
        `matchzy_bootstrap_url "${bootstrapUrl}"`,
        `matchzy_bootstrap_token "${serverToken}"`,
      ];

      for (const cmd of commands) {
        const result = await rconService.sendCommand(serverId, cmd);
        if (!result.success) {
          errors.push(`${cmd}: ${result.error ?? 'no details'}`);
        }
      }

      await this.markServerInitialized(serverId);
      configsSent.push('bootstrap');

      if (errors.length > 0) {
        log.warn(`[SERVER-INIT] Server ${serverId} bootstrap initialization completed with errors`, {
          errors,
          configsSent,
        });
        return {
          success: false,
          alreadyInitialized: false,
          error: errors.join('; '),
          configsSent,
        };
      }

      log.success(`[SERVER-INIT] Server ${serverId} bootstrap initialization scheduled`);
      return {
        success: true,
        alreadyInitialized: false,
        configsSent,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error(`[SERVER-INIT] Failed to initialize server ${serverId}`, error as Error);
      return {
        success: false,
        alreadyInitialized: false,
        error: errorMessage,
        configsSent,
      };
    }
  }

  /**
   * Reset all servers (useful for global config changes)
   */
  async resetAllServers(): Promise<void> {
    try {
      await db.queryAsync('UPDATE servers SET persistent_config_sent = NULL');
      log.info('[SERVER-INIT] All servers reset - will be reconfigured on next use');
    } catch (error) {
      log.error('Failed to reset all servers', error as Error);
    }
  }
}

export const serverInitializationService = new ServerInitializationService();
