/**
 * Helper functions to generate Auto Tournament CS2 RCON configuration commands
 */

import { buildServerEventsUrl } from '../../../utils/serverAttribution';

/**
 * Get RCON commands to configure Auto Tournament CS2 webhook
 * Uses match slug in URL path for better event tracking
 */
export function getPluginWebhookCommands(
  baseUrl: string,
  serverToken: string,
  matchSlug?: string | null,
  serverId?: string | null
): string[] {
  // Encode match slug in URL path if provided (e.g., /api/events/r1m1).
  // Otherwise the server id goes in the query string so events are attributable
  // to the server that sent them (see utils/serverAttribution).
  const webhookUrl = matchSlug
    ? `${baseUrl}/api/events/${matchSlug}`
    : buildServerEventsUrl(baseUrl, serverId);

  return [
    `at_remote_log_url "${webhookUrl}"`,
    `at_remote_log_header_key "X-Auto-Tournament-Token"`,
    `at_remote_log_header_value "${serverToken}"`,
    // Where the plugin pushes full match reports. Without this the plugin's
    // upload is skipped and the report is only offered as the reply to an RCON
    // command — which it builds asynchronously, long after the RCON response has
    // been sent, so MAT reads an empty string and drops the report entirely.
    // `at_report_server_id` needs no command: the plugin sets it from
    // `at_server_id`, which is already sent during initialization.
    `at_report_endpoint "${baseUrl}/api/events/report"`,
    `at_report_token "${serverToken}"`,
    `get5_check_auths true`, // Enable auth check to prevent random players
  ];
}

/**
 * Get RCON commands that point a server at MAT's bootstrap endpoint.
 *
 * Order matters: the plugin fetches the bootstrap URL the moment
 * `at_bootstrap_url` is set, using whatever token it has persisted at that
 * point, and does not refetch when the token changes afterwards. On a server
 * last configured by another MAT instance, setting the URL first sends the stale
 * token, gets a 401, and leaves the server unconfigured. So the token goes
 * before the URL, and the URL is the last command.
 */
export function getPluginBootstrapCommands(
  baseUrl: string,
  serverId: string,
  serverToken: string
): string[] {
  const bootstrapUrl = `${baseUrl}/api/servers/${serverId}/bootstrap`;
  return [
    'at_clear_event_queue',
    `at_server_id "${serverId}"`,
    `at_bootstrap_token "${serverToken}"`,
    `at_bootstrap_url "${bootstrapUrl}"`,
  ];
}

/**
 * Get RCON commands to configure match report upload endpoint
 */
export function getPluginReportUploadCommands(
  baseUrl: string,
  serverToken: string,
  serverId: string
): string[] {
  const reportEndpoint = `${baseUrl}/api/events/report`;
  return [
    `at_report_endpoint "${reportEndpoint}"`,
    `at_report_server_id "${serverId}"`,
    `at_report_token "${serverToken}"`,
  ];
}

/**
 * Get RCON commands to configure Auto Tournament CS2 demo upload
 * Returns array of commands to set URL and authentication headers
 * (Similar to webhook configuration)
 * 
 * @param matchSlug - Optional match slug for specific match upload endpoint. 
 *                    If null, sets base upload URL (for server initialization)
 */
export function getPluginDemoUploadCommands(
  baseUrl: string,
  matchSlug: string | null,
  serverToken: string
): string[] {
  const uploadUrl = matchSlug 
    ? `${baseUrl}/api/demos/${matchSlug}/upload`
    : `${baseUrl}/api/demos/upload`;
    
  return [
    `at_demo_upload_url "${uploadUrl}"`,
    `at_demo_upload_header_key "X-Auto-Tournament-Token"`,
    `at_demo_upload_header_value "${serverToken}"`,
  ];
}

/**
 * @deprecated Use getPluginDemoUploadCommands() instead
 * Kept for backward compatibility
 */
export function getPluginDemoUploadCommand(baseUrl: string, matchSlug: string): string {
  return `at_demo_upload_url "${baseUrl}/api/demos/${matchSlug}/upload"`;
}

/**
 * Header the game server presents when it downloads its match config. Same
 * header, same `SERVER_TOKEN`, as the event webhook and demo upload.
 */
export const MATCH_CONFIG_AUTH_HEADER = 'X-Auto-Tournament-Token';

/**
 * The RCON command that tells Auto Tournament CS2 to load a match.
 *
 * `at_loadmatch_url "<url>" "<header name>" "<header value>"` — Auto Tournament CS2
 * adds the header to its config fetch, and keeps it for a load it queues
 * behind a series in postgame. It has taken the two extra arguments since
 * Auto Tournament CS2 0.6.0, so every Auto Tournament CS2 build does. The config endpoint
 * refuses a fetch without the header (see `requireMatchConfigAccess`).
 *
 * Without a token the bare command is sent; the fetch is then refused, which
 * is the right outcome for an instance with no `SERVER_TOKEN`.
 */
export function getPluginLoadMatchCommand(
  configUrl: string,
  serverToken: string | null | undefined
): string {
  if (!serverToken) {
    return `at_loadmatch_url "${configUrl}"`;
  }
  return `at_loadmatch_url "${configUrl}" "${MATCH_CONFIG_AUTH_HEADER}" "${serverToken}"`;
}

/** The load command as it may appear in logs and API responses: token hidden. */
export function redactLoadMatchCommand(command: string): string {
  return command.replace(/^(at_loadmatch_url "[^"]*" "[^"]*" )"[^"]*"$/, '$1"REDACTED"');
}

/**
 * Get RCON commands for core Auto Tournament CS2 settings that we want to control from the app:
 * - Chat prefixes
 * - Knife round enabled-by-default toggle
 * - Debug chat toggle
 */
export function getPluginCoreSettingsCommands(options: {
  chatPrefix: string | null;
  adminChatPrefix: string | null;
  knifeEnabledDefault: boolean | null;
  debugChatEnabled: boolean | null;
}): string[] {
  const commands: string[] = [];

  if (options.chatPrefix !== null) {
    commands.push(`at_chat_prefix "${options.chatPrefix}"`);
  }

  if (options.adminChatPrefix !== null) {
    commands.push(`at_admin_chat_prefix "${options.adminChatPrefix}"`);
  }

  if (options.knifeEnabledDefault !== null) {
    commands.push(`at_knife_enabled_default ${options.knifeEnabledDefault ? '1' : '0'}`);
  }

  if (options.debugChatEnabled !== null) {
    commands.push(`at_debug_chat ${options.debugChatEnabled ? '1' : '0'}`);
  }

  return commands;
}

/**
 * Get RCON commands for per-server Auto Tournament CS2 configuration overrides.
 * All fields are optional; null/undefined means "do not touch this ConVar".
 * Note: Chat prefixes and knife round defaults are not per-server settings;
 * they are configured at the global/tournament/match level.
 */
export function getPluginServerConfigCommands(config: {
  minimumReadyRequired?: number | null;
  allowForceReady?: boolean | null;
  pauseAfterRestore?: boolean | null;
  stopCommandAvailable?: boolean | null;
  stopCommandNoDamage?: boolean | null;
  whitelistEnabledDefault?: boolean | null;
  kickWhenNoMatchLoaded?: boolean | null;
  playoutEnabledDefault?: boolean | null;
  resetCvarsOnSeriesEnd?: boolean | null;
  usePauseCommandForTacticalPause?: boolean | null;
  /**
   * Auto Tournament CS2 autostart mode:
   * 0 = idle/sleep, 1 = match mode, 2 = practice mode
   */
  autostartMode?: 0 | 1 | 2 | null;
  /**
   * Hostname Auto Tournament CS2 applies on match load. `''` is a meaningful value: it tells
   * the plugin to leave the server's own `hostname` alone.
   */
  hostnameFormat?: string | null;
  demoPath?: string | null;
  demoNameFormat?: string | null;
  seriesEndKickDelayNoDemo?: number | null;
  seriesEndKickDelayDemoNoUpload?: number | null;
  seriesEndKickDelayDemoUpload?: number | null;
  demoUploadUrl?: string | null;
  debugChatEnabled?: boolean | null;
}): string[] {
  const commands: string[] = [];

  if (
    config.minimumReadyRequired !== undefined &&
    config.minimumReadyRequired !== null &&
    Number.isFinite(config.minimumReadyRequired)
  ) {
    commands.push(`at_minimum_ready_required ${config.minimumReadyRequired}`);
  }
  if (config.allowForceReady !== undefined && config.allowForceReady !== null) {
    commands.push(`at_allow_force_ready ${config.allowForceReady ? '1' : '0'}`);
  }
  if (config.pauseAfterRestore !== undefined && config.pauseAfterRestore !== null) {
    commands.push(`at_pause_after_restore ${config.pauseAfterRestore ? '1' : '0'}`);
  }
  if (config.stopCommandAvailable !== undefined && config.stopCommandAvailable !== null) {
    commands.push(`at_stop_command_available ${config.stopCommandAvailable ? '1' : '0'}`);
  }
  if (config.stopCommandNoDamage !== undefined && config.stopCommandNoDamage !== null) {
    commands.push(`at_stop_command_no_damage ${config.stopCommandNoDamage ? '1' : '0'}`);
  }
  if (config.whitelistEnabledDefault !== undefined && config.whitelistEnabledDefault !== null) {
    commands.push(
      `at_whitelist_enabled_default ${config.whitelistEnabledDefault ? '1' : '0'}`
    );
  }
  if (config.kickWhenNoMatchLoaded !== undefined && config.kickWhenNoMatchLoaded !== null) {
    commands.push(`at_kick_when_no_match_loaded ${config.kickWhenNoMatchLoaded ? '1' : '0'}`);
  }
  if (config.playoutEnabledDefault !== undefined && config.playoutEnabledDefault !== null) {
    commands.push(`at_playout_enabled_default ${config.playoutEnabledDefault ? '1' : '0'}`);
  }
  if (config.resetCvarsOnSeriesEnd !== undefined && config.resetCvarsOnSeriesEnd !== null) {
    commands.push(`at_reset_cvars_on_series_end ${config.resetCvarsOnSeriesEnd ? '1' : '0'}`);
  }
  if (
    config.usePauseCommandForTacticalPause !== undefined &&
    config.usePauseCommandForTacticalPause !== null
  ) {
    commands.push(
      `at_use_pause_command_for_tactical_pause ${
        config.usePauseCommandForTacticalPause ? '1' : '0'
      }`
    );
  }

  if (config.autostartMode !== undefined && config.autostartMode !== null) {
    commands.push(`at_autostart_mode ${config.autostartMode}`);
  }

  // Emitted even when empty — `at_hostname_format ""` is how the plugin is
  // told not to overwrite the hostname set in the server's own config.
  if (config.hostnameFormat !== undefined && config.hostnameFormat !== null) {
    commands.push(`at_hostname_format "${config.hostnameFormat}"`);
  }

  if (config.demoPath !== undefined && config.demoPath !== null) {
    commands.push(`at_demo_path "${config.demoPath}"`);
  }
  if (config.demoNameFormat !== undefined && config.demoNameFormat !== null) {
    commands.push(`at_demo_name_format "${config.demoNameFormat}"`);
  }
  if (
    config.seriesEndKickDelayNoDemo !== undefined &&
    config.seriesEndKickDelayNoDemo !== null &&
    Number.isFinite(config.seriesEndKickDelayNoDemo)
  ) {
    commands.push(`at_series_end_kick_delay_no_demo ${config.seriesEndKickDelayNoDemo}`);
  }
  if (
    config.seriesEndKickDelayDemoNoUpload !== undefined &&
    config.seriesEndKickDelayDemoNoUpload !== null &&
    Number.isFinite(config.seriesEndKickDelayDemoNoUpload)
  ) {
    commands.push(
      `at_series_end_kick_delay_demo_no_upload ${config.seriesEndKickDelayDemoNoUpload}`
    );
  }
  if (
    config.seriesEndKickDelayDemoUpload !== undefined &&
    config.seriesEndKickDelayDemoUpload !== null &&
    Number.isFinite(config.seriesEndKickDelayDemoUpload)
  ) {
    commands.push(
      `at_series_end_kick_delay_demo_upload ${config.seriesEndKickDelayDemoUpload}`
    );
  }
  if (config.demoUploadUrl !== undefined && config.demoUploadUrl !== null) {
    commands.push(`at_demo_upload_url "${config.demoUploadUrl}"`);
  }

  if (config.debugChatEnabled !== undefined && config.debugChatEnabled !== null) {
    commands.push(`at_debug_chat ${config.debugChatEnabled ? '1' : '0'}`);
  }

  return commands;
}

/**
 * Get RCON commands to disable Auto Tournament CS2 webhook
 */
export function getDisableWebhookCommands(): string[] {
  return [
    'at_remote_log_url ""',
    'at_remote_log_header_key ""',
    'at_remote_log_header_value ""',
  ];
}

/**
 * Format commands for display
 */
export function formatCommands(commands: string[]): string {
  return commands.join('\n');
}
