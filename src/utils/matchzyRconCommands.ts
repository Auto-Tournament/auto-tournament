/**
 * Helper functions to generate MatchZy RCON configuration commands
 */

/**
 * Get RCON commands to configure MatchZy webhook
 * Uses match slug in URL path for better event tracking
 */
export function getMatchZyWebhookCommands(baseUrl: string, serverToken: string, matchSlug?: string): string[] {
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
 * Get RCON command to configure MatchZy demo upload
 */
export function getMatchZyDemoUploadCommand(baseUrl: string, matchSlug: string): string {
  return `matchzy_demo_upload_url "${baseUrl}/api/demos/${matchSlug}/upload"`;
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
