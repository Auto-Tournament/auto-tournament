/**
 * Match Loading Service - handles loading matches on game servers
 * Centralized logic for configuring and loading matches via RCON
 */

import { db } from '../config/database';
import { rconService } from './rconService';
import { emitMatchUpdate, emitBracketUpdate } from './socketService';
import { log } from '../utils/logger';
import type { DbMatchRow } from '../types/database.types';
import type { MatchConfig } from '../types/match.types';
import { matchLiveStatsService } from './matchLiveStatsService';
import { serverInitializationService } from './serverInitializationService';
import { settingsService } from './settingsService';
import { getMatchZyServerConfigCommands } from '../utils/matchzyRconCommands';

export interface MatchLoadOptions {
  skipWebhook?: boolean; // Deprecated: Webhooks are now persistent, this param is ignored
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
  const { baseUrl } = options;
  const results: Array<{ success: boolean; command: string; error?: string }> = [];
  let demoUploadConfigured = false;

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

    // Parse match config once so we can reuse its cvars for per-match setup.
    // Important: we never store secrets (SERVER_TOKEN) in match JSON; token-bearing
    // commands must be sent over RCON only.
    let parsedConfig: { cvars?: Record<string, string | number> } = {};
    try {
      parsedConfig = (match.config
        ? (JSON.parse(match.config) as Partial<MatchConfig> & {
            cvars?: Record<string, string | number>;
          })
        : {}) as { cvars?: Record<string, string | number> };
    } catch (e) {
      log.warn('[MATCH LOADING] Failed to parse stored match config JSON; continuing with empty config', {
        matchSlug,
        serverId,
        error: e instanceof Error ? e.message : String(e),
      });
      parsedConfig = {};
    }

    const cvars = parsedConfig.cvars ?? {};

    // Helper to add small delay between RCON commands to avoid overwhelming the server
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Never expose tokens in logs or API responses.
    const redactSensitiveCommand = (command: string): string => {
      // MatchZy demo upload token / header value
      if (command.startsWith('matchzy_demo_upload_header_value ')) {
        return 'matchzy_demo_upload_header_value "REDACTED"';
      }
      // MatchZy webhook token / header value (defense-in-depth; currently not set here)
      if (command.startsWith('matchzy_remote_log_header_value ')) {
        return 'matchzy_remote_log_header_value "REDACTED"';
      }
      // Match load auth header value (defense-in-depth; currently not set here)
      if (command.startsWith('matchzy_loadmatch_url_header_value ')) {
        return 'matchzy_loadmatch_url_header_value "REDACTED"';
      }
      // Match report token (defense-in-depth; currently not set here)
      if (command.startsWith('matchzy_report_token ')) {
        return 'matchzy_report_token "REDACTED"';
      }
      return command;
    };

    // STEP 1: Initialize server with persistent configuration (if not already done)
    // This sends base webhook URL, auth tokens, chat prefixes, etc.
    // These settings persist across server restarts and only need to be sent once.
    const initResult = await serverInitializationService.initializeServer(serverId, baseUrl);
    if (!initResult.success && !initResult.alreadyInitialized) {
      log.error(`Cannot load match ${matchSlug}: server initialization failed`, {
        error: initResult.error,
      });
      return {
        success: false,
        error: `Server initialization failed: ${initResult.error}`,
        rconResponses: results,
      };
    }

    if (initResult.alreadyInitialized) {
      log.debug(`[MATCH LOADING] Server ${serverId} already initialized, skipping persistent config`);
    } else {
      log.success(`[MATCH LOADING] Server ${serverId} initialized with persistent configuration`);
    }

    // STEP 1.5: Apply MatchZy global defaults from Settings.
    // Even though these are persisted by MatchZy Enhanced, we re-apply them on
    // each match load so updates take effect without requiring a server init reset.
    try {
      const matchzyCore = await settingsService.getMatchzyCoreDefaults();
      const cmds = getMatchZyServerConfigCommands({
        autostartMode: matchzyCore.autostartMode,
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
      for (const cmd of cmds) {
        const result = await rconService.sendCommand(serverId, cmd);
        results.push({ success: result.success, command: cmd, error: result.error });
        await delay(150);
      }
    } catch (coreError) {
      log.warn(
        `[MATCH LOADING] Failed to apply MatchZy global defaults for ${matchSlug} on ${serverId}`,
        coreError as Error
      );
    }

    // STEP 1.6: Ensure demo prerequisites and per-match upload endpoint are configured.
    // - Demo recording is controlled by match config cvars (matchzy_demo_recording_enabled)
    // - Actual demo creation requires GOTV enabled (tv_enable 1)
    // - Demo uploads must target a match-specific URL: POST /api/demos/:matchSlug/upload
    //
    // We configure these via RCON (not match JSON) to avoid leaking SERVER_TOKEN.
    const demoRecordingFlagRaw = cvars['matchzy_demo_recording_enabled'];
    const demoRecordingEnabled =
      demoRecordingFlagRaw === undefined ? true : String(demoRecordingFlagRaw).trim() !== '0';

    const serverToken = process.env.SERVER_TOKEN || '';
    if (demoRecordingEnabled) {
      log.info('[DEMO_CONFIG] DEMO_RECORDING_ENABLED', { matchSlug, serverId });
      if (!serverToken) {
        log.warn('[MATCH LOADING] Demo upload not configured: SERVER_TOKEN missing', {
          matchSlug,
          serverId,
        });
      } else {
        const demoCommands = [
          // Ensure GOTV is enabled so tv_record actually produces a .dem file.
          'tv_enable 1',
          // Configure per-match upload URL + auth header.
          `matchzy_demo_upload_url "${baseUrl}/api/demos/${matchSlug}/upload"`,
          `matchzy_demo_upload_header_key "X-MatchZy-Token"`,
          `matchzy_demo_upload_header_value "${serverToken}"`,
        ];

        const errors: string[] = [];
        for (const cmd of demoCommands) {
          const result = await rconService.sendCommand(serverId, cmd);
          const safeCmd = redactSensitiveCommand(cmd);
          results.push({ success: result.success, command: safeCmd, error: result.error });
          if (result.success) {
            log.info('[DEMO_CONFIG] COMMAND_OK', { matchSlug, serverId, command: safeCmd });
          } else {
            log.warn('[DEMO_CONFIG] COMMAND_FAIL', {
              matchSlug,
              serverId,
              command: safeCmd,
              error: result.error ?? 'no details',
            });
          }
          if (!result.success) {
            errors.push(`${safeCmd}: ${result.error ?? 'no details'}`);
          }
          await delay(150);
        }

        demoUploadConfigured = errors.length === 0;
        if (!demoUploadConfigured) {
          log.warn('[MATCH LOADING] Demo configuration failed', {
            matchSlug,
            serverId,
            errors,
          });
        } else {
          log.success('[DEMO_CONFIG] COMPLETE', { matchSlug, serverId });
        }
      }
    } else {
      log.info('[DEMO_CONFIG] DEMO_RECORDING_DISABLED', { matchSlug, serverId });
      // Avoid stale demo upload endpoints from previous matches.
      const disableCmd = 'matchzy_demo_upload_url ""';
      const result = await rconService.sendCommand(serverId, disableCmd);
      results.push({ success: result.success, command: disableCmd, error: result.error });
      await delay(150);
      demoUploadConfigured = false;
    }

    // STEP 2: Apply per-match cvar overrides (if any)
    // These are match-specific settings that override server defaults for this particular match
    // (e.g., knife round enabled/disabled, max rounds, etc.)
    try {
      if (cvars && Object.keys(cvars).length > 0) {
        log.debug(
          `[MATCH LOADING] Applying per-match cvars for ${matchSlug} on ${serverId}`,
          { keys: Object.keys(cvars) }
        );
        for (const [key, value] of Object.entries(cvars)) {
          const cmd = `${key} ${value}`;
          const result = await rconService.sendCommand(serverId, cmd);
          results.push({
            success: result.success,
            command: cmd,
            error: result.error,
          });
          await delay(200);
        }
      }
    } catch (cfgError) {
      log.warn(
        `[MATCH LOADING] Failed to apply per-match cvars for ${matchSlug} on ${serverId}`,
        cfgError as Error
      );
    }

    // Delay before sending the load command to ensure previous commands are processed
    await delay(500);

    // Load match on server
    // Server initialization has already ensured webhook, auth, and core config are set and persisted
    log.success(`✅ Server ${serverId} ready. Loading match ${matchSlug}`);
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
        webhookConfigured: false,
        demoUploadConfigured: false,
        rconResponses: results,
      };
    }

    if (loadResult.success) {
      log.success(`[MATCH LOADING] Match ${matchSlug} loaded successfully on ${serverId}`);
      matchLiveStatsService.reset(match.slug);

      // With persistent configuration, webhook and demo upload URLs are stored in the server's
      // database and automatically loaded on startup. No need to reapply configuration after
      // every match load!

      // Update match status to 'loaded'
      await db.updateAsync(
        'matches',
        { status: 'loaded', loaded_at: Math.floor(Date.now() / 1000) },
        'slug = ?',
        [matchSlug]
      );
      log.matchLoaded(matchSlug, serverId, true);

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
        webhookConfigured: true,
        demoUploadConfigured,
        rconResponses: results,
      };
    }
    
    return {
      success: false,
      error: loadResult.error,
      webhookConfigured: false,
      demoUploadConfigured: false,
      rconResponses: results,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
      rconResponses: results,
    };
  }
}
