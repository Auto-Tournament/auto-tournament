/**
 * Server Status Values
 * The match phase a linked Ready Up server reports, in the words the views use.
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

/** A server's status, read from its Ready Up fleet connection. */
export class ServerStatusService {
  async getServerStatus(serverId: string): Promise<{
    status: ServerStatus | null;
    matchSlug: string | null;
    online: boolean;
  }> {
    // A fake server (host 0.0.0.0, for screenshots and tests) is always up and idle.
    const { serverService } = await import('./serverService');
    const server = await serverService.getServerById(serverId);
    if (server?.host === '0.0.0.0') {
      return { status: ServerStatus.IDLE, matchSlug: null, online: true };
    }
    const { fleetServerStatus } = await import('../fleet/driver');
    const s = await fleetServerStatus(serverId);
    return { status: s.status, matchSlug: s.matchSlug, online: s.online };
  }

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
