/**
 * Helper functions to generate MatchZy RCON configuration commands
 */

/**
 * Get RCON commands to configure MatchZy webhook
 */
export function getMatchZyWebhookCommands(baseUrl: string, serverToken: string): string[] {
  return [
    `matchzy_remote_log_url "${baseUrl}/api/events"`,
    `matchzy_remote_log_header_key "X-MatchZy-Token"`,
    `matchzy_remote_log_header_value "${serverToken}"`,
  ];
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
