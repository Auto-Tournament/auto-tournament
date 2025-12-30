import { rconService } from './rconService';
import { serverService } from './serverService';
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
  QUEUED = 'queued', // Next match is queued to load after reset/postgame
  ERROR = 'error', // Something went wrong
}

/**
 * Service for managing custom server status ConVars
 * These are the single source of truth for server/match state
 */
const STATUS_CACHE_TTL_MS = 10_000; // 10 seconds of "buffer" for lightweight status checks

export class ServerStatusService {
  // Custom ConVar names (must be unique to avoid conflicts)
  private readonly STATUS_VAR = 'matchzy_tournament_status';
  private readonly MATCH_SLUG_VAR = 'matchzy_tournament_match';
  private readonly NEXT_MATCH_VAR = 'matchzy_tournament_next_match';
  private readonly UPDATE_TIME_VAR = 'matchzy_tournament_updated';

  /**
   * In-memory cache of the most recent status per server. This is used as a
   * short-lived buffer for lightweight views (e.g. Servers page) so that
   * transient RCON issues or brief reconnects don't immediately flip servers
   * between "online" and "offline" in the UI.
   */
  private readonly statusCache = new Map<
    string,
    {
      status: ServerStatus | null;
      matchSlug: string | null;
      nextMatchSlug: string | null;
      updatedAt: number | null;
      online: boolean;
      cachedAt: number;
    }
  >();

  /**
   * Get the current server status by querying the server directly
   * The CS2 plugin manages these ConVars; we only read them.
   */
  async getServerStatus(
    serverId: string,
    useCache = false
  ): Promise<{
    status: ServerStatus | null;
    matchSlug: string | null;
    nextMatchSlug: string | null;
    updatedAt: number | null;
    online: boolean;
  }> {
    if (useCache) {
      const cached = this.statusCache.get(serverId);
      if (cached) {
        const { cachedAt, ...rest } = cached;
        const age = Date.now() - cachedAt;
        if (age <= STATUS_CACHE_TTL_MS) {
          log.debug(`[STATUS] Using cached status for server ${serverId} (age=${age}ms)`);
          return rest;
        }
      }
    }

    try {
      // Check if this is a fake server (IP 0.0.0.0) - always return online
      const server = await serverService.getServerById(serverId);
      if (server && server.host === '0.0.0.0') {
        // Fake server for screenshots/testing - always return online with idle status
        const result = {
          status: ServerStatus.IDLE,
          matchSlug: null,
          nextMatchSlug: null,
          updatedAt: Math.floor(Date.now() / 1000),
          online: true,
        };
        this.statusCache.set(serverId, { ...result, cachedAt: Date.now() });
        return result;
      }

      // Try to get status from server
      const statusResult = await rconService.sendCommand(serverId, this.STATUS_VAR);

      if (!statusResult.success) {
        return {
          status: null,
          matchSlug: null,
          nextMatchSlug: null,
          updatedAt: null,
          online: false,
        };
      }

      // Parse the response - ConVar commands return: "varname" = "value"
      const statusMatch = statusResult.response?.match(/"([^"]+)"\s*=\s*"([^"]*)"/);
      const status = statusMatch ? (statusMatch[2] as ServerStatus) : ServerStatus.IDLE;

      // Get current match slug
      const slugResult = await rconService.sendCommand(serverId, this.MATCH_SLUG_VAR);
      const slugMatch = slugResult.response?.match(/"([^"]+)"\s*=\s*"([^"]*)"/);
      const matchSlug = slugMatch && slugMatch[2] ? slugMatch[2] : null;

      // Get queued next match slug (if any)
      const nextResult = await rconService.sendCommand(serverId, this.NEXT_MATCH_VAR);
      const nextMatch = nextResult.response?.match(/"([^"]+)"\s*=\s*"([^"]*)"/);
      const nextMatchSlug = nextMatch && nextMatch[2] ? nextMatch[2] : null;

      // Get update timestamp
      const timeResult = await rconService.sendCommand(serverId, this.UPDATE_TIME_VAR);
      const timeMatch = timeResult.response?.match(/"([^"]+)"\s*=\s*"([^"]*)"/);
      const updatedAt = timeMatch && timeMatch[2] ? parseInt(timeMatch[2], 10) : null;

      const result = {
        status,
        matchSlug,
        nextMatchSlug,
        updatedAt,
        online: true,
      };
      this.statusCache.set(serverId, { ...result, cachedAt: Date.now() });
      return result;
    } catch (error) {
      log.error(`Failed to get server status from ${serverId}`, error);
      const result = {
        status: null,
        matchSlug: null,
        nextMatchSlug: null,
        updatedAt: null,
        online: false,
      };
      this.statusCache.set(serverId, { ...result, cachedAt: Date.now() });
      return result;
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
      case ServerStatus.QUEUED:
        return {
          label: 'Next Match Queued',
          description: 'Current series is ending – next match will auto-load on this server',
          color: 'info',
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
