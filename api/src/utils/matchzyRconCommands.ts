/**
 * Helper functions to generate MatchZy RCON configuration commands
 */

/**
 * Get RCON commands to configure MatchZy webhook
 * Uses match slug in URL path for better event tracking
 */
export function getMatchZyWebhookCommands(
  baseUrl: string,
  serverToken: string,
  matchSlug?: string
): string[] {
  // Encode match slug in URL path if provided (e.g., /api/events/r1m1)
  const webhookUrl = matchSlug ? `${baseUrl}/api/events/${matchSlug}` : `${baseUrl}/api/events`;

  return [
    `matchzy_remote_log_url "${webhookUrl}"`,
    `matchzy_remote_log_header_key "X-MatchZy-Token"`,
    `matchzy_remote_log_header_value "${serverToken}"`,
    `get5_check_auths true`, // Enable auth check to prevent random players
  ];
}

/**
 * Get RCON commands to configure MatchZy match loading with bearer auth
 */
export function getMatchZyLoadMatchAuthCommands(configToken: string): string[] {
  return [
    `matchzy_loadmatch_url_header_key "Authorization"`,
    `matchzy_loadmatch_url_header_value "Bearer ${configToken}"`,
  ];
}

/**
 * Get RCON commands to configure match report upload endpoint
 */
export function getMatchZyReportUploadCommands(
  baseUrl: string,
  serverToken: string,
  serverId: string
): string[] {
  const reportEndpoint = `${baseUrl}/api/events/report`;
  return [
    `matchzy_report_endpoint "${reportEndpoint}"`,
    `matchzy_report_server_id "${serverId}"`,
    `matchzy_report_token "${serverToken}"`,
  ];
}

/**
 * Get RCON commands to configure MatchZy demo upload
 * Returns array of commands to set URL and authentication headers
 * (Similar to webhook configuration)
 */
export function getMatchZyDemoUploadCommands(
  baseUrl: string,
  matchSlug: string,
  serverToken: string
): string[] {
  return [
    `matchzy_demo_upload_url "${baseUrl}/api/demos/${matchSlug}/upload"`,
    `matchzy_demo_upload_header_key "X-MatchZy-Token"`,
    `matchzy_demo_upload_header_value "${serverToken}"`,
  ];
}

/**
 * @deprecated Use getMatchZyDemoUploadCommands() instead
 * Kept for backward compatibility
 */
export function getMatchZyDemoUploadCommand(baseUrl: string, matchSlug: string): string {
  return `matchzy_demo_upload_url "${baseUrl}/api/demos/${matchSlug}/upload"`;
}

/**
 * Get RCON commands for core MatchZy settings that we want to control from the app:
 * - Chat prefixes
 * - Knife round enabled-by-default toggle
 */
export function getMatchZyCoreSettingsCommands(options: {
  chatPrefix: string | null;
  adminChatPrefix: string | null;
  knifeEnabledDefault: boolean | null;
}): string[] {
  const commands: string[] = [];

  if (options.chatPrefix !== null) {
    commands.push(`matchzy_chat_prefix "${options.chatPrefix}"`);
  }

  if (options.adminChatPrefix !== null) {
    commands.push(`matchzy_admin_chat_prefix "${options.adminChatPrefix}"`);
  }

  if (options.knifeEnabledDefault !== null) {
    commands.push(`matchzy_knife_enabled_default ${options.knifeEnabledDefault ? '1' : '0'}`);
  }

  return commands;
}

/**
 * Get RCON commands for per-server MatchZy configuration overrides.
 * All fields are optional; null/undefined means "do not touch this ConVar".
 */
export function getMatchZyServerConfigCommands(config: {
  chatPrefix?: string | null;
  adminChatPrefix?: string | null;
  knifeEnabledDefault?: boolean | null;
  minimumReadyRequired?: number | null;
  pauseAfterRestore?: boolean | null;
  stopCommandAvailable?: boolean | null;
  stopCommandNoDamage?: boolean | null;
  whitelistEnabledDefault?: boolean | null;
  kickWhenNoMatchLoaded?: boolean | null;
  playoutEnabledDefault?: boolean | null;
  resetCvarsOnSeriesEnd?: boolean | null;
  usePauseCommandForTacticalPause?: boolean | null;
  autostartMode?: 'enabled' | 'disabled' | 'ready_check' | null;
  demoPath?: string | null;
  demoNameFormat?: string | null;
  demoUploadUrl?: string | null;
}): string[] {
  const commands: string[] = [];

  if (config.chatPrefix !== undefined && config.chatPrefix !== null) {
    commands.push(`matchzy_chat_prefix "${config.chatPrefix}"`);
  }
  if (config.adminChatPrefix !== undefined && config.adminChatPrefix !== null) {
    commands.push(`matchzy_admin_chat_prefix "${config.adminChatPrefix}"`);
  }
  if (config.knifeEnabledDefault !== undefined && config.knifeEnabledDefault !== null) {
    commands.push(`matchzy_knife_enabled_default ${config.knifeEnabledDefault ? '1' : '0'}`);
  }

  if (
    config.minimumReadyRequired !== undefined &&
    config.minimumReadyRequired !== null &&
    Number.isFinite(config.minimumReadyRequired)
  ) {
    commands.push(`matchzy_minimum_ready_required ${config.minimumReadyRequired}`);
  }
  if (config.pauseAfterRestore !== undefined && config.pauseAfterRestore !== null) {
    commands.push(
      `matchzy_pause_after_restore ${config.pauseAfterRestore ? '1' : '0'}`
    );
  }
  if (config.stopCommandAvailable !== undefined && config.stopCommandAvailable !== null) {
    commands.push(
      `matchzy_stop_command_available ${config.stopCommandAvailable ? '1' : '0'}`
    );
  }
  if (config.stopCommandNoDamage !== undefined && config.stopCommandNoDamage !== null) {
    commands.push(
      `matchzy_stop_command_no_damage ${config.stopCommandNoDamage ? '1' : '0'}`
    );
  }
  if (
    config.whitelistEnabledDefault !== undefined &&
    config.whitelistEnabledDefault !== null
  ) {
    commands.push(
      `matchzy_whitelist_enabled_default ${config.whitelistEnabledDefault ? '1' : '0'}`
    );
  }
  if (
    config.kickWhenNoMatchLoaded !== undefined &&
    config.kickWhenNoMatchLoaded !== null
  ) {
    commands.push(
      `matchzy_kick_when_no_match_loaded ${config.kickWhenNoMatchLoaded ? '1' : '0'}`
    );
  }
  if (config.playoutEnabledDefault !== undefined && config.playoutEnabledDefault !== null) {
    commands.push(
      `matchzy_playout_enabled_default ${config.playoutEnabledDefault ? '1' : '0'}`
    );
  }
  if (
    config.resetCvarsOnSeriesEnd !== undefined &&
    config.resetCvarsOnSeriesEnd !== null
  ) {
    commands.push(
      `matchzy_reset_cvars_on_series_end ${config.resetCvarsOnSeriesEnd ? '1' : '0'}`
    );
  }
  if (
    config.usePauseCommandForTacticalPause !== undefined &&
    config.usePauseCommandForTacticalPause !== null
  ) {
    commands.push(
      `matchzy_use_pause_command_for_tactical_pause ${
        config.usePauseCommandForTacticalPause ? '1' : '0'
      }`
    );
  }

  if (config.autostartMode !== undefined && config.autostartMode !== null) {
    commands.push(`matchzy_autostart_mode "${config.autostartMode}"`);
  }

  if (config.demoPath !== undefined && config.demoPath !== null) {
    commands.push(`matchzy_demo_path "${config.demoPath}"`);
  }
  if (config.demoNameFormat !== undefined && config.demoNameFormat !== null) {
    commands.push(`matchzy_demo_name_format "${config.demoNameFormat}"`);
  }
  if (config.demoUploadUrl !== undefined && config.demoUploadUrl !== null) {
    commands.push(`matchzy_demo_upload_url "${config.demoUploadUrl}"`);
  }

  return commands;
}

/**
 * Get RCON commands to disable MatchZy webhook
 */
export function getDisableWebhookCommands(): string[] {
  return [
    'matchzy_remote_log_url ""',
    'matchzy_remote_log_header_key ""',
    'matchzy_remote_log_header_value ""',
  ];
}

/**
 * Format commands for display
 */
export function formatCommands(commands: string[]): string {
  return commands.join('\n');
}
