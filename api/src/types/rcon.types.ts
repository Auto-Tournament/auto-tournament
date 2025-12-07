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
