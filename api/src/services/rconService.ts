import { Rcon } from 'dathost-rcon-client';
import { GameDig } from 'gamedig';
import { serverService } from './serverService';
import { ServerResponse } from '../types/server.types';
import { RconCommandResponse } from '../types/rcon.types';
import { log } from '../utils/logger';

/**
 * RCON Service for sending commands to CS2 servers
 */
export class RconService {
  /**
   * Track authentication errors per server to detect IP bans
   * Maps serverId -> { count, lastErrorTime, serverReachable }
   * IP ban is only flagged if:
   * - Server is reachable (we can connect, but auth fails)
   * - We get 3+ auth errors in 30 seconds
   * - Error is specifically "Authentication error" (not timeout/connection refused)
   */
  private readonly authErrorTracker = new Map<
    string,
    { 
      count: number; 
      lastErrorTime: number;
      serverReachable: boolean; // True if server responded (not timeout/refused)
    }
  >();

  /**
   * Check if server IP is likely banned based on repeated auth errors
   * Only returns true if:
   * - Server is reachable (we can connect but auth fails)
   * - We've had 3+ auth errors in the last 30 seconds
   * - Errors are specifically authentication errors (not network issues)
   */
  private isLikelyIpBanned(serverId: string): boolean {
    const tracker = this.authErrorTracker.get(serverId);
    if (!tracker) return false;
    
    // Only flag as IP banned if:
    // 1. Server is reachable (we can connect, but auth fails)
    // 2. We've had 3+ auth errors in the last 30 seconds
    const timeSinceLastError = Date.now() - tracker.lastErrorTime;
    return tracker.serverReachable && tracker.count >= 3 && timeSinceLastError < 30000;
  }

  /**
   * Record an authentication error for a server
   * @param serverId Server ID
   * @param serverReachable Whether the server responded (true) or timed out/refused (false)
   */
  private recordAuthError(serverId: string, serverReachable: boolean): void {
    const existing = this.authErrorTracker.get(serverId);
    const now = Date.now();
    
    if (existing) {
      // Reset count if last error was more than 30 seconds ago
      const timeSinceLastError = now - existing.lastErrorTime;
      if (timeSinceLastError > 30000) {
        this.authErrorTracker.set(serverId, { 
          count: 1, 
          lastErrorTime: now,
          serverReachable,
        });
      } else {
        // Keep the most recent serverReachable status (if we got a response, server is reachable)
        this.authErrorTracker.set(serverId, {
          count: existing.count + 1,
          lastErrorTime: now,
          serverReachable: serverReachable || existing.serverReachable, // Once reachable, stay reachable
        });
      }
    } else {
      this.authErrorTracker.set(serverId, { 
        count: 1, 
        lastErrorTime: now,
        serverReachable,
      });
    }
  }

  /**
   * Clear auth error tracking for a server (when connection succeeds)
   */
  private clearAuthErrors(serverId: string): void {
    this.authErrorTracker.delete(serverId);
  }
  /**
   * Send a command to a specific server
   */
  async sendCommand(serverId: string, command: string): Promise<RconCommandResponse> {
    const server = await serverService.getServerById(serverId);

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

    // Fake server for screenshots/testing - always return success
    // Servers with IP 0.0.0.0 are treated as always online (fake servers)
    if (server.host === '0.0.0.0') {
      return {
        success: true,
        serverId,
        serverName: server.name,
        command,
        response: `"${command}" = "fake_response"`, // Mock response format
        timestamp: Date.now(),
      };
    }

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
    const servers = await serverService.getAllServers(true); // Get only enabled servers

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
   * Test connection to a server by host, port, and password (without requiring server to be saved)
   * Attempts to check server status with gamedig first (optional, non-blocking), then tests RCON authentication
   */
  async testConnectionByParams(
    host: string,
    port: number,
    password: string,
    serverName?: string
  ): Promise<RconCommandResponse> {
    // Step 1: Attempt to check if server is online using gamedig (non-blocking)
    // If gamedig fails, we'll still try RCON - server might be online but query disabled/blocked
    let serverQueryStatus: 'online' | 'offline' | 'unknown' = 'unknown';
    try {
      await Promise.race([
        GameDig.query({
          type: 'cs2',
          host,
          port, // CS2 uses the same port for queries as the game port
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Server query timeout (5s)')), 5000)
        ),
      ]);
      serverQueryStatus = 'online';
      log.debug(`Server ${host}:${port} query check successful (gamedig)`, { serverName });
    } catch (queryError) {
      serverQueryStatus = 'offline';
      // Log but don't fail - query might be disabled/blocked even if server is online
      log.debug(`Server ${host}:${port} query check failed (gamedig) - will try RCON anyway`, { 
        serverName,
        note: 'Query failure is non-blocking - server might still be online with RCON access',
        error: queryError 
      });
    }

    // Step 2: Server is online - now test RCON authentication
    const client = new Rcon({
      host,
      port,
      password,
      timeout: 5000,
    });

    try {
      const executeWithTimeout = async () => {
        await client.connect();
        const response = await client.send('status');
        return response;
      };

      await Promise.race([
        executeWithTimeout(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('RCON connection timeout (10s)')), 10000)
        ),
      ]);

      const successMessage = serverQueryStatus === 'online' 
        ? 'Connection successful - Server is online (verified) and RCON authentication successful'
        : 'RCON authentication successful - Server query status unknown (query may be disabled/blocked)';
      
      // Clear auth errors on successful connection
      const serverId = `${host}:${port}`;
      this.clearAuthErrors(serverId);
      
      return {
        success: true,
        serverId,
        serverName: serverName || serverId,
        command: 'status',
        response: successMessage,
        timestamp: Date.now(),
        ipBanned: false,
      };
    } catch (error) {
      let errorMessage = 'Unknown error';
      
      // Handle AggregateError (can occur with Promise.race/timeouts)
      if (error && typeof error === 'object' && 'constructor' && error.constructor.name === 'AggregateError') {
        const aggError = error as { message?: string; errors?: unknown[]; code?: string };
        // Try to get the first meaningful error from the aggregate
        if (aggError.errors && Array.isArray(aggError.errors) && aggError.errors.length > 0) {
          const firstError = aggError.errors[0];
          if (firstError instanceof Error) {
            errorMessage = firstError.message || firstError.toString();
          } else if (typeof firstError === 'string') {
            errorMessage = firstError;
          } else {
            errorMessage = String(firstError);
          }
        } else if (aggError.message) {
          errorMessage = aggError.message;
        } else if (aggError.code) {
          errorMessage = `Connection failed: ${aggError.code}`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message || error.toString() || 'Unknown error';
      } else if (error) {
        errorMessage = String(error);
      }
      
      // If error message is still generic, try to extract from error object
      if (errorMessage === 'Unknown error' || errorMessage === 'AggregateError') {
        if (error && typeof error === 'object') {
          const err = error as Record<string, unknown>;
          if (err.message && typeof err.message === 'string') {
            errorMessage = err.message;
          } else if (err.code && typeof err.code === 'string') {
            errorMessage = `Error: ${err.code}`;
          } else if (err.errno !== undefined) {
            errorMessage = `Connection error (errno: ${err.errno})`;
          }
        }
      }
      
      // RCON failed - provide specific error messages based on query status
      const lowerMessage = errorMessage.toLowerCase();
      const queryStatusNote = serverQueryStatus === 'online' 
        ? 'Server is online (verified) but RCON authentication failed.' 
        : serverQueryStatus === 'offline'
        ? 'Server query failed and RCON authentication failed.'
        : 'RCON authentication failed (server query status unknown).';
      
      if (lowerMessage.includes('authentication') || lowerMessage.includes('password') || lowerMessage.includes('auth') || lowerMessage.includes('invalid password')) {
        errorMessage = `Authentication failed - Incorrect RCON password. ${queryStatusNote}`;
      } else if (lowerMessage.includes('timeout')) {
        errorMessage = `RCON timeout - RCON did not respond within 10 seconds. ${queryStatusNote} Check if RCON port ${port} is correct and accessible.`;
      } else if (lowerMessage.includes('econnrefused') || lowerMessage.includes('connection refused')) {
        if (serverQueryStatus === 'online') {
          errorMessage = `RCON connection refused - Server is online but RCON port ${port} is not accessible. Check firewall or RCON port configuration.`;
        } else {
          errorMessage = `Connection refused - Server appears offline or unreachable at ${host}:${port}. Check if server is running and accessible.`;
        }
      } else if (lowerMessage.includes('econnreset') || lowerMessage.includes('connection reset')) {
        errorMessage = `RCON connection reset - RCON connection was closed. ${queryStatusNote} Check RCON configuration.`;
      } else if (lowerMessage.includes('enotfound') || lowerMessage.includes('host not found')) {
        errorMessage = `Host not found - Cannot resolve hostname "${host}"`;
      } else if (lowerMessage.includes('eaddrinuse')) {
        errorMessage = `Address already in use - Port ${port} may be in use`;
      } else {
        // Generic RCON error
        if (serverQueryStatus === 'online') {
          errorMessage = `RCON connection failed - Server is online but RCON failed: ${errorMessage}`;
        } else {
          errorMessage = `Connection failed - ${errorMessage}. Server may be offline or unreachable.`;
        }
      }
      
      log.error(`RCON test connection failed for ${host}:${port}`, error, { serverName, errorMessage });
      
      // Check if this is an authentication error (could be IP ban)
      // Only flag as potential IP ban if:
      // 1. Server is reachable (not timeout/refused) - we got a response
      // 2. Error is specifically authentication-related
      // 3. Server query status shows it's online (or unknown, but not offline)
      const serverId = `${host}:${port}`;
      const isNetworkError = lowerMessage.includes('timeout') || 
                            lowerMessage.includes('econnrefused') || 
                            lowerMessage.includes('connection refused') ||
                            lowerMessage.includes('econnreset') ||
                            lowerMessage.includes('connection reset') ||
                            lowerMessage.includes('enotfound') ||
                            lowerMessage.includes('host not found');
      
      // Server is reachable if we got an auth error (server responded) and it's not a network error
      const serverReachable = (lowerMessage.includes('authentication') || lowerMessage === 'authentication error') && !isNetworkError;
      
      if (lowerMessage.includes('authentication') || lowerMessage === 'authentication error') {
        // Only track as potential IP ban if server is reachable (responded to us)
        // AND server appears to be online (GameDig query succeeded or unknown)
        if (serverReachable && (serverQueryStatus === 'online' || serverQueryStatus === 'unknown')) {
          this.recordAuthError(serverId, true);
          const isBanned = this.isLikelyIpBanned(serverId);
          
          if (isBanned) {
            log.warn(`Server ${serverId} may have banned our IP - server is reachable but repeatedly rejecting authentication`);
          }
        } else {
          // Network error or server offline - not an IP ban, clear tracking
          this.clearAuthErrors(serverId);
        }
      } else {
        // Not an auth error - clear tracking
        this.clearAuthErrors(serverId);
      }
      
      return {
        success: false,
        serverId,
        serverName: serverName || serverId,
        command: 'status',
        error: errorMessage,
        timestamp: Date.now(),
        ipBanned: this.isLikelyIpBanned(serverId),
      };
    } finally {
      try {
        client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
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
      timeout: 5000, // 5 second timeout for connection and commands
    });

    try {
      // Add overall timeout wrapper to prevent indefinite hanging
      const executeWithTimeout = async () => {
        await client.connect();
        const response = await client.send(command);
        return response;
      };

      const response = await Promise.race([
        executeWithTimeout(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('RCON operation timeout (10s)')), 10000)
        ),
      ]);

      log.rconCommand(server.id, command, true);
      
      // Clear auth errors on successful connection
      this.clearAuthErrors(server.id);

      return {
        success: true,
        serverId: server.id,
        serverName: server.name,
        command,
        response,
        timestamp: Date.now(),
        ipBanned: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const lowerMessage = errorMessage.toLowerCase();
      
      // Check if this is an authentication error (could be IP ban)
      // Only flag as potential IP ban if server is reachable (not timeout/refused)
      const isNetworkError = lowerMessage.includes('timeout') || 
                            lowerMessage.includes('econnrefused') || 
                            lowerMessage.includes('connection refused') ||
                            lowerMessage.includes('econnreset') ||
                            lowerMessage.includes('connection reset') ||
                            lowerMessage.includes('enotfound') ||
                            lowerMessage.includes('host not found');
      
      // Server is reachable if we got an auth error (server responded) and it's not a network error
      const serverReachable = (lowerMessage.includes('authentication') || lowerMessage === 'authentication error') && !isNetworkError;
      
      if (lowerMessage.includes('authentication') || lowerMessage === 'authentication error') {
        if (serverReachable) {
          // Server responded but rejected auth - could be IP ban
          this.recordAuthError(server.id, true);
          const isBanned = this.isLikelyIpBanned(server.id);
          
          if (isBanned) {
            log.warn(`Server ${server.id} (${server.name}) may have banned our IP - server is reachable but repeatedly rejecting authentication`);
          }
        } else {
          // Network error - not an IP ban, clear tracking
          this.clearAuthErrors(server.id);
        }
      } else {
        // Not an auth error - clear tracking
        this.clearAuthErrors(server.id);
      }
      
      log.error(`RCON command failed on ${server.id} (${server.name})`, error, { command });

      return {
        success: false,
        serverId: server.id,
        serverName: server.name,
        command,
        error: errorMessage,
        timestamp: Date.now(),
        ipBanned: this.isLikelyIpBanned(server.id),
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
