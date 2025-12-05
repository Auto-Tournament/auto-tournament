/**
 * Match Loading Service - handles loading matches on game servers
 * Centralized logic for configuring and loading matches via RCON
 */

import { db } from '../config/database';
import { rconService } from './rconService';
import { emitMatchUpdate, emitBracketUpdate } from './socketService';
import { log } from '../utils/logger';
import {
  getMatchZyWebhookCommands,
  getMatchZyDemoUploadCommand,
  getMatchZyDemoUploadCommands,
  getMatchZyLoadMatchAuthCommands,
} from '../utils/matchzyRconCommands';
import type { DbMatchRow } from '../types/database.types';
import { matchLiveStatsService } from './matchLiveStatsService';

export interface MatchLoadOptions {
  skipWebhook?: boolean;
  baseUrl: string;
}

export interface MatchLoadResult {
  success: boolean;
  error?: string;
  webhookConfigured?: boolean;
  demoUploadConfigured?: boolean;
  rconResponses?: Array<{ success: boolean; command: string; error?: string }>;
}

/**
 * Load a match on a server via RCON
 * Handles all configuration: webhook, demo upload, auth, and match loading
 */
export async function loadMatchOnServer(
  matchSlug: string,
  serverId: string,
  options: MatchLoadOptions
): Promise<MatchLoadResult> {
  const { skipWebhook = false, baseUrl } = options;
  const serverToken = process.env.SERVER_TOKEN || '';
  const results: Array<{ success: boolean; command: string; error?: string }> = [];

  try {
    log.info(`[MATCH LOADING] Loading match ${matchSlug} on server ${serverId}`);

    // Get match config
    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      matchSlug,
    ]);
    if (!match) {
      log.error(`Match ${matchSlug} not found in database`);
      return { success: false, error: 'Match not found' };
    }

    const configUrl = `${baseUrl}/api/matches/${matchSlug}.json`;
    log.debug(`Match config URL: ${configUrl}`);

    let webhookConfigured = false;

    // Helper to add small delay between RCON commands to avoid overwhelming the server
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Configure webhook (if SERVER_TOKEN is set and not skipped)
    if (!skipWebhook && serverToken) {
      log.debug(`Configuring webhook for match ${matchSlug} on server ${serverId}`);
      const webhookCommands = getMatchZyWebhookCommands(baseUrl, serverToken, matchSlug);
      for (const cmd of webhookCommands) {
        log.debug(`Sending webhook command: ${cmd}`, { serverId });
        const result = await rconService.sendCommand(serverId, cmd);
        results.push({
          success: result.success,
          command: cmd,
          error: result.error,
        });
        // Small delay between commands to avoid overwhelming the server
        await delay(200);
      }
      const webhookUrl = `${baseUrl}/api/events/${matchSlug}`;
      log.webhookConfigured(serverId, webhookUrl);
      webhookConfigured = true;
    } else if (!skipWebhook && !serverToken) {
      log.warn(`No SERVER_TOKEN set, skipping webhook configuration for ${serverId}`);
    }

    // Small delay before next set of commands
    await delay(300);

    // Configure demo upload URL and headers (if SERVER_TOKEN is set)
    let demoUploadConfigured = false;
    const uploadUrl = `${baseUrl}/api/demos/${matchSlug}/upload`;

    if (serverToken) {
      console.log('\n');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('CONFIGURING DEMO UPLOAD');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log(`Match Slug:     ${matchSlug}`);
      console.log(`Server ID:      ${serverId}`);
      console.log(`Upload URL:     ${uploadUrl}`);
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('\n');

      log.debug(`Configuring demo upload for match ${matchSlug}`, {
        serverId,
        uploadUrl,
      });

      const demoUploadCommands = getMatchZyDemoUploadCommands(baseUrl, matchSlug, serverToken);
      let allCommandsSucceeded = true;
      const commandErrors: string[] = [];

      for (const cmd of demoUploadCommands) {
        log.debug(`Sending demo upload command: ${cmd}`, { serverId });
        const result = await rconService.sendCommand(serverId, cmd);
        results.push({
          success: result.success,
          command: cmd,
          error: result.error,
        });
        if (!result.success) {
          allCommandsSucceeded = false;
          if (result.error) {
            commandErrors.push(result.error);
          }
        }
        // Small delay between commands to avoid overwhelming the server
        await delay(200);
      }

      demoUploadConfigured = allCommandsSucceeded;

      if (allCommandsSucceeded) {
        console.log('\n');
        console.log(
          '═══════════════════════════════════════════════════════════════════════════════'
        );
        console.log('DEMO UPLOAD CONFIGURED SUCCESSFULLY');
        console.log(
          '═══════════════════════════════════════════════════════════════════════════════'
        );
        console.log(`Match Slug:   ${matchSlug}`);
        console.log(`Server ID:    ${serverId}`);
        console.log(`Upload URL:   ${uploadUrl}`);
        console.log(`Auth Header:  X-MatchZy-Token`);
        console.log(
          `Status:       MatchZy will upload demos to this URL after match/map completion`
        );
        console.log(
          '═══════════════════════════════════════════════════════════════════════════════'
        );
        console.log('\n');
        log.info(`[DEMO UPLOAD] Demo upload configured for match ${matchSlug} on ${serverId}`);
      } else {
        console.log('\n');
        console.log(
          '═══════════════════════════════════════════════════════════════════════════════'
        );
        console.log('DEMO UPLOAD CONFIGURATION FAILED');
        console.log(
          '═══════════════════════════════════════════════════════════════════════════════'
        );
        console.log(`Match Slug:     ${matchSlug}`);
        console.log(`Server ID:      ${serverId}`);
        console.log(`Errors:         ${commandErrors.join('; ') || 'Unknown error'}`);
        console.log(
          '═══════════════════════════════════════════════════════════════════════════════'
        );
        console.log('\n');
        log.warn(`Failed to configure demo upload for ${matchSlug}`, {
          errors: commandErrors,
        });
      }
    } else {
      log.warn(`No SERVER_TOKEN set, skipping demo upload header configuration for ${serverId}`);
      // Still try to set URL without auth headers (for backward compatibility)
      const demoUploadCommand = getMatchZyDemoUploadCommand(baseUrl, matchSlug);
      const demoResult = await rconService.sendCommand(serverId, demoUploadCommand);
      results.push({
        success: demoResult.success,
        command: demoUploadCommand,
        error: demoResult.error,
      });
      demoUploadConfigured = demoResult.success;
    }

    // Small delay before auth commands
    await delay(300);

    // Configure bearer token auth for match config loading (uses same SERVER_TOKEN)
    if (serverToken) {
      log.debug(`Configuring match config auth for ${serverId}`);
      const authCommands = getMatchZyLoadMatchAuthCommands(serverToken);
      for (const cmd of authCommands) {
        log.debug(`Sending auth command: ${cmd}`, { serverId });
        const result = await rconService.sendCommand(serverId, cmd);
        results.push({
          success: result.success,
          command: cmd,
          error: result.error,
        });
        // Small delay between commands
        await delay(200);
      }
      log.info(`[MATCH LOADING] Match config auth configured for ${serverId}`);
    } else {
      log.warn(`No SERVER_TOKEN set - match loading will fail. Please set SERVER_TOKEN in .env`);
    }

    // Delay before sending the load command to ensure previous commands are processed
    await delay(500);

    // Load match on server
    log.info(`Sending load command to ${serverId}: matchzy_loadmatch_url "${configUrl}"`);
    const loadResult = await rconService.sendCommand(
      serverId,
      `matchzy_loadmatch_url "${configUrl}"`
    );
    results.push({
      success: loadResult.success,
      command: `matchzy_loadmatch_url "${configUrl}"`,
      error: loadResult.error,
    });

    const responseText = (loadResult.response || '').toLowerCase();
    const pluginReportedFailure = responseText.includes('match load failed');
    const gotvInactive = responseText.includes('gotv[0] not active');

    const handlePluginFailure = (message: string) => {
      log.warn(message, {
        serverId,
        matchSlug,
        response: loadResult.response,
      });
    };

    if (pluginReportedFailure || gotvInactive) {
      const errorMessage = gotvInactive
        ? 'MatchZy refused to load because GOTV is disabled. Enable GOTV (tv_enable 1) and retry.'
        : 'MatchZy plugin reported that it failed to load the match. Check the server console for the detailed error.';

      handlePluginFailure(errorMessage);

      return {
        success: false,
        error: errorMessage,
        webhookConfigured,
        demoUploadConfigured,
        rconResponses: results,
      };
    }

    if (loadResult.success) {
      log.success(`[MATCH LOADING] Match ${matchSlug} loaded successfully on ${serverId}`);
      matchLiveStatsService.reset(match.slug);

      // MatchZy wipes remote log/upload cvars when a new match loads.
      // Reapply them a short moment after the load command finishes so webhook + uploads keep working.
      const reapplyCommands = async () => {
        log.debug(`Reapplying MatchZy webhook/demo config after load for ${serverId}`);
        if (!skipWebhook && serverToken) {
          const webhookCommands = getMatchZyWebhookCommands(baseUrl, serverToken, matchSlug);
          for (const cmd of webhookCommands) {
            const result = await rconService.sendCommand(serverId, cmd);
            results.push({
              success: result.success,
              command: `[reload] ${cmd}`,
              error: result.error,
            });
            if (!result.success) {
              log.warn(`Failed to reapply webhook command post-load`, {
                serverId,
                matchSlug,
                command: cmd,
                error: result.error,
              });
            }
            // Small delay between reapply commands
            await delay(200);
          }
        }

        // Small delay before demo command
        await delay(300);

        // Reapply demo upload commands (with headers for authentication)
        if (serverToken) {
          const demoUploadCommands = getMatchZyDemoUploadCommands(baseUrl, matchSlug, serverToken);
          for (const cmd of demoUploadCommands) {
            const cmdResult = await rconService.sendCommand(serverId, cmd);
            results.push({
              success: cmdResult.success,
              command: `[reload] ${cmd}`,
              error: cmdResult.error,
            });
            if (!cmdResult.success) {
              log.warn(`Failed to reapply demo upload command post-load`, {
                serverId,
                matchSlug,
                command: cmd,
                error: cmdResult.error,
              });
            }
            // Small delay between reapply commands
            await delay(200);
          }
        } else {
          // Fallback to old method if no server token
          const demoCmd = getMatchZyDemoUploadCommand(baseUrl, matchSlug);
          const demoReResult = await rconService.sendCommand(serverId, demoCmd);
          results.push({
            success: demoReResult.success,
            command: `[reload] ${demoCmd}`,
            error: demoReResult.error,
          });
          if (!demoReResult.success) {
            log.warn(`Failed to reapply demo upload command post-load`, {
              serverId,
              matchSlug,
              error: demoReResult.error,
            });
          }
        }
      };

      try {
        // Wait longer after match load - server needs time to process the match load
        // MatchZy can be busy during this time, so we wait 8 seconds instead of 5
        await new Promise((resolve) => setTimeout(resolve, 8000));
        await reapplyCommands();
      } catch (reapplyError) {
        log.warn('Post-load MatchZy reconfiguration failed', reapplyError as Error);
      }

      // Update match status to 'loaded'
      await db.updateAsync(
        'matches',
        { status: 'loaded', loaded_at: Math.floor(Date.now() / 1000) },
        'slug = ?',
        [matchSlug]
      );
      log.matchLoaded(matchSlug, serverId, webhookConfigured);

      // Emit websocket events to notify clients
      const updatedMatch = await db.queryOneAsync<DbMatchRow>(
        'SELECT * FROM matches WHERE slug = ?',
        [matchSlug]
      );
      if (updatedMatch) {
        emitMatchUpdate(updatedMatch);
        emitBracketUpdate({ action: 'match_loaded', matchSlug });
      }

      return {
        success: true,
        webhookConfigured,
        demoUploadConfigured,
        rconResponses: results,
      };
    } else {
      return {
        success: false,
        error: loadResult.error,
        webhookConfigured,
        demoUploadConfigured,
        rconResponses: results,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
      rconResponses: results,
    };
  }
}
