import { Rcon } from 'dathost-rcon-client';
import { serverService } from './serverService';
import { ServerResponse } from '../types/server.types';
import { RconCommandResponse } from '../types/rcon.types';
import { log } from '../utils/logger';

/**
 * RCON Service for sending commands to CS2 servers
 */
export class RconService {
  /**
   * Send a command to a specific server
   */
  async sendCommand(serverId: string, command: string): Promise<RconCommandResponse> {
    const server = serverService.getServerById(serverId);

    if (!server) {
      return {
        success: false,
        serverId,
        serverName: 'Unknown',
        command,
        error: `Server '${serverId}' not found`,
        timestamp: Date.now(),
      };
    }

    if (!server.enabled) {
      return {
        success: false,
        serverId,
        serverName: server.name,
        command,
        error: 'Server is disabled',
        timestamp: Date.now(),
      };
    }

    return this.executeCommand(server, command);
  }

  /**
   * Send a command to multiple servers
   */
  async sendCommandToServers(serverIds: string[], command: string): Promise<RconCommandResponse[]> {
    const promises = serverIds.map((serverId) => this.sendCommand(serverId, command));
    return Promise.all(promises);
  }

  /**
   * Broadcast a command to all enabled servers
   */
  async broadcastCommand(command: string): Promise<RconCommandResponse[]> {
    const servers = serverService.getAllServers(true); // Get only enabled servers

    if (servers.length === 0) {
      return [
        {
          success: false,
          serverId: 'none',
          serverName: 'None',
          command,
          error: 'No enabled servers found',
          timestamp: Date.now(),
        },
      ];
    }

    const promises = servers.map((server) => this.executeCommand(server, command));
    return Promise.all(promises);
  }

  /**
   * Test connection to a server
   */
  async testConnection(serverId: string): Promise<RconCommandResponse> {
    return this.sendCommand(serverId, 'status');
  }

  /**
   * Test connections to all enabled servers
   */
  async testAllConnections(): Promise<RconCommandResponse[]> {
    return this.broadcastCommand('status');
  }

  /**
   * Execute a command on a specific server with proper connection handling
   */
  private async executeCommand(
    server: ServerResponse,
    command: string
  ): Promise<RconCommandResponse> {
    const client = new Rcon({
      host: server.host,
      port: server.port,
      password: server.password,
    });

    try {
      await client.connect();
      const response = await client.send(command);

      log.rconCommand(server.id, command, true);

      return {
        success: true,
        serverId: server.id,
        serverName: server.name,
        command,
        response,
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`RCON command failed on ${server.id} (${server.name})`, error, { command });

      return {
        success: false,
        serverId: server.id,
        serverName: server.name,
        command,
        error: errorMessage,
        timestamp: Date.now(),
      };
    } finally {
      try {
        client.disconnect();
      } catch (disconnectError) {
        // Ignore disconnect errors
        console.warn(`Failed to disconnect from ${server.name}:`, disconnectError);
      }
    }
  }

  /**
   * Helper methods for common CS2/MatchZy commands
   */
  commands = {
    /**
     * Get server status
     */
    status: (serverId: string) => this.sendCommand(serverId, 'status'),

    /**
     * Change map
     */
    changeMap: (serverId: string, mapName: string) =>
      this.sendCommand(serverId, `changelevel ${mapName}`),

    /**
     * Say message in chat
     */
    say: (serverId: string, message: string) => this.sendCommand(serverId, `say ${message}`),

    /**
     * Restart current round
     */
    restartRound: (serverId: string, seconds = 1) =>
      this.sendCommand(serverId, `mp_restartgame ${seconds}`),

    /**
     * Kick a player
     */
    kickPlayer: (serverId: string, playerName: string) =>
      this.sendCommand(serverId, `kick "${playerName}"`),

    /**
     * Execute MatchZy command
     */
    matchzy: (serverId: string, matchzyCommand: string) =>
      this.sendCommand(serverId, `matchzy_${matchzyCommand}`),

    /**
     * Load a match config (MatchZy)
     */
    loadMatch: (serverId: string, configUrl: string) =>
      this.sendCommand(serverId, `matchzy_loadmatch_url "${configUrl}"`),

    /**
     * End current match (MatchZy)
     */
    endMatch: (serverId: string) => this.sendCommand(serverId, 'css_restart'),

    /**
     * Pause match (MatchZy)
     */
    pauseMatch: (serverId: string) => this.sendCommand(serverId, 'css_pause'),

    /**
     * Unpause match (MatchZy)
     */
    unpauseMatch: (serverId: string) => this.sendCommand(serverId, 'css_unpause'),
  };
}

export const rconService = new RconService();
