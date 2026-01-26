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
import {
  getMatchZyWebhookCommands,
  getMatchZyDemoUploadCommands,
  getMatchZyLoadMatchAuthCommands,
  getMatchZyCoreSettingsCommands,
  getMatchZyServerConfigCommands,
} from '../utils/matchzyRconCommands';
import { settingsService } from './settingsService';

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

      log.info(`[SERVER-INIT] Initializing server ${serverId} with persistent configuration`);

      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const errors: string[] = [];

      const cmdTag = (c: string) => {
        const first = c.trim().split(/\s+/)[0];
        return first ? ` (${first})` : '';
      };
      const err = (detail: string | undefined) => detail && detail.trim().length > 0 ? detail.trim() : 'no details';

      // 0. Clear MatchZy event queue so the server does not keep retrying with a wrong webhook URL
      const clearResult = await rconService.sendCommand(serverId, 'matchzy_clear_event_queue');
      if (!clearResult.success) {
        log.debug(`[SERVER-INIT] Server ${serverId}: matchzy_clear_event_queue failed (continuing)`, {
          error: clearResult.error,
        });
      }
      await delay(200);

      // 1. Configure webhook (persistent)
      const webhookCommands = getMatchZyWebhookCommands(baseUrl, serverToken, null);
      for (const cmd of webhookCommands) {
        const result = await rconService.sendCommand(serverId, cmd);
        if (!result.success) {
          errors.push(`Webhook config failed${cmdTag(cmd)}: ${err(result.error)}`);
        } else {
          configsSent.push('webhook');
        }
        await delay(200);
      }

      await delay(300);

      // 2. Configure demo upload (persistent)
      const demoUploadCommands = getMatchZyDemoUploadCommands(baseUrl, null, serverToken);
      for (const cmd of demoUploadCommands) {
        const result = await rconService.sendCommand(serverId, cmd);
        if (!result.success) {
          errors.push(`Demo upload config failed${cmdTag(cmd)}: ${err(result.error)}`);
        } else {
          configsSent.push('demo_upload');
        }
        await delay(200);
      }

      await delay(300);

      // 3. Configure match loading authentication (persistent)
      const authCommands = getMatchZyLoadMatchAuthCommands(serverToken);
      for (const cmd of authCommands) {
        const result = await rconService.sendCommand(serverId, cmd);
        if (!result.success) {
          errors.push(`Auth config failed${cmdTag(cmd)}: ${err(result.error)}`);
        } else {
          configsSent.push('auth');
        }
        await delay(200);
      }

      await delay(300);

      // 4. Configure chat prefixes (persistent)
      const [chatPrefix, adminChatPrefix, knifeEnabledDefault, debugChatEnabled] =
        await Promise.all([
          settingsService.getMatchzyChatPrefix(),
          settingsService.getMatchzyAdminChatPrefix(),
          settingsService.isKnifeRoundEnabledByDefault(),
          settingsService.isMatchzyDebugChatEnabled(),
        ]);

      const coreSettingsCommands = getMatchZyCoreSettingsCommands({
        chatPrefix,
        adminChatPrefix,
        knifeEnabledDefault,
        debugChatEnabled,
      });

      for (const cmd of coreSettingsCommands) {
        const result = await rconService.sendCommand(serverId, cmd);
        if (!result.success) {
          errors.push(`Core settings failed${cmdTag(cmd)}: ${err(result.error)}`);
        } else {
          configsSent.push('core_settings');
        }
        await delay(200);
      }

      await delay(300);

      // 4b. Configure MatchZy core defaults (persistent)
      const matchzyCore = await settingsService.getMatchzyCoreDefaults();
      const matchzyCoreCommands = getMatchZyServerConfigCommands({
        minimumReadyRequired: matchzyCore.minimumReadyRequired,
        allowForceReady: matchzyCore.allowForceReady,
        kickWhenNoMatchLoaded: matchzyCore.kickWhenNoMatchLoaded,
        whitelistEnabledDefault: matchzyCore.whitelistEnabledDefault,
        pauseAfterRestore: matchzyCore.pauseAfterRestore,
        stopCommandAvailable: matchzyCore.stopCommandAvailable,
        stopCommandNoDamage: matchzyCore.stopCommandNoDamage,
        usePauseCommandForTacticalPause: matchzyCore.usePauseCommandForTacticalPause,
        demoPath: matchzyCore.demoPath,
        demoNameFormat: matchzyCore.demoNameFormat,
        seriesEndKickDelayNoDemo: matchzyCore.seriesEndKickDelayNoDemo,
        seriesEndKickDelayDemoNoUpload: matchzyCore.seriesEndKickDelayDemoNoUpload,
        seriesEndKickDelayDemoUpload: matchzyCore.seriesEndKickDelayDemoUpload,
      });
      for (const cmd of matchzyCoreCommands) {
        const result = await rconService.sendCommand(serverId, cmd);
        if (!result.success) {
          errors.push(`MatchZy defaults failed${cmdTag(cmd)}: ${err(result.error)}`);
        } else {
          configsSent.push('matchzy_defaults');
        }
        await delay(200);
      }

      // 5. Set server ID (persistent)
      const serverIdCmd = `matchzy_server_id "${serverId}"`;
      const serverIdResult = await rconService.sendCommand(serverId, serverIdCmd);
      if (!serverIdResult.success) {
        errors.push(`Server ID config failed: ${err(serverIdResult.error)}`);
      } else {
        configsSent.push('server_id');
      }

      if (errors.length > 0) {
        log.warn(`[SERVER-INIT] Server ${serverId} initialization completed with errors`, {
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

      // Mark as initialized
      await this.markServerInitialized(serverId);

      log.success(`[SERVER-INIT] Server ${serverId} successfully initialized with persistent configuration`);
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
