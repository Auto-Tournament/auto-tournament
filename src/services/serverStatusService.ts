import { rconService } from './rconService';
import { log } from '../utils/logger';

/**
 * Server Status Values
 * These represent the actual state of the CS2 server
 */
export enum ServerStatus {
  IDLE = 'idle', // Server is free, no match loaded
  LOADING = 'loading', // Match is being loaded onto server
  WARMUP = 'warmup', // Match loaded, waiting for players to ready up
  KNIFE = 'knife', // Knife round in progress
  LIVE = 'live', // Match is live
  PAUSED = 'paused', // Match is paused
  HALFTIME = 'halftime', // Halftime break
  POSTGAME = 'postgame', // Match completed, server needs cleanup
  ERROR = 'error', // Something went wrong
}

/**
 * Service for managing custom server status ConVars
 * These are the single source of truth for server/match state
 */
export class ServerStatusService {
  // Custom ConVar names (must be unique to avoid conflicts)
  private readonly STATUS_VAR = 'matchzy_tournament_status';
  private readonly MATCH_SLUG_VAR = 'matchzy_tournament_match';
  private readonly UPDATE_TIME_VAR = 'matchzy_tournament_updated';

  /**
   * Get the current server status by querying the server directly
   * The CS2 plugin manages these ConVars; we only read them.
   */
  async getServerStatus(serverId: string): Promise<{
    status: ServerStatus | null;
    matchSlug: string | null;
    updatedAt: number | null;
    online: boolean;
  }> {
    try {
      // Try to get status from server
      const statusResult = await rconService.sendCommand(serverId, this.STATUS_VAR);

      if (!statusResult.success) {
        return {
          status: null,
          matchSlug: null,
          updatedAt: null,
          online: false,
        };
      }

      // Parse the response - ConVar commands return: "varname" = "value"
      const statusMatch = statusResult.response?.match(/"([^"]+)"\s*=\s*"([^"]*)"/);
      const status = statusMatch ? (statusMatch[2] as ServerStatus) : ServerStatus.IDLE;

      // Get match slug
      const slugResult = await rconService.sendCommand(serverId, this.MATCH_SLUG_VAR);
      const slugMatch = slugResult.response?.match(/"([^"]+)"\s*=\s*"([^"]*)"/);
      const matchSlug = slugMatch && slugMatch[2] ? slugMatch[2] : null;

      // Get update timestamp
      const timeResult = await rconService.sendCommand(serverId, this.UPDATE_TIME_VAR);
      const timeMatch = timeResult.response?.match(/"([^"]+)"\s*=\s*"([^"]*)"/);
      const updatedAt = timeMatch && timeMatch[2] ? parseInt(timeMatch[2], 10) : null;

      return {
        status,
        matchSlug,
        updatedAt,
        online: true,
      };
    } catch (error) {
      log.error(`Failed to get server status from ${serverId}`, error);
      return {
        status: null,
        matchSlug: null,
        updatedAt: null,
        online: false,
      };
    }
  }

  /**
   * Get descriptive status text for display
   */
  getStatusDescription(status: ServerStatus): {
    label: string;
    description: string;
    color: 'success' | 'warning' | 'error' | 'info' | 'default';
  } {
    switch (status) {
      case ServerStatus.IDLE:
        return {
          label: 'Available',
          description: 'Server is ready for a new match',
          color: 'success',
        };
      case ServerStatus.LOADING:
        return {
          label: 'Loading',
          description: 'Match is being loaded onto the server',
          color: 'info',
        };
      case ServerStatus.WARMUP:
        return {
          label: 'Warmup - Join Now!',
          description: 'Waiting for players to connect and ready up',
          color: 'warning',
        };
      case ServerStatus.KNIFE:
        return {
          label: 'Knife Round',
          description: 'Knife round in progress',
          color: 'info',
        };
      case ServerStatus.LIVE:
        return {
          label: 'Live',
          description: 'Match is live and in progress',
          color: 'error',
        };
      case ServerStatus.PAUSED:
        return {
          label: 'Paused',
          description: 'Match is paused',
          color: 'warning',
        };
      case ServerStatus.HALFTIME:
        return {
          label: 'Halftime',
          description: 'Halftime break',
          color: 'info',
        };
      case ServerStatus.POSTGAME:
        return {
          label: 'Match Ended',
          description: 'Match completed, server cleaning up',
          color: 'default',
        };
      case ServerStatus.ERROR:
        return {
          label: 'Error',
          description: 'Server encountered an error',
          color: 'error',
        };
      default:
        return {
          label: 'Unknown',
          description: 'Server status unknown',
          color: 'default',
        };
    }
  }
}

export const serverStatusService = new ServerStatusService();
