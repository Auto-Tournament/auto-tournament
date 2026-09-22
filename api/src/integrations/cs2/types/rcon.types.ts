/**
 * RCON types
 */

export interface RconCommandRequest {
  serverId: string;
  command: string;
}

export interface RconCommandResponse {
  success: boolean;
  serverId: string;
  serverName: string;
  command: string;
  response?: string;
  error?: string;
  timestamp: number;
  ipBanned?: boolean; // True if server has likely banned our IP
  /**
   * True when a server-restart command (css_restart) was sent but its reply was
   * lost because the server restarted. `success` is true: the command ran, its
   * outcome just could not be confirmed over RCON.
   */
  unconfirmed?: boolean;
}

export interface RconBroadcastRequest {
  command: string;
  serverIds?: string[]; // Optional: specific servers, otherwise all enabled
}

export interface RconBroadcastResponse {
  success: boolean;
  message: string;
  results: RconCommandResponse[];
  stats: {
    total: number;
    successful: number;
    failed: number;
  };
}
