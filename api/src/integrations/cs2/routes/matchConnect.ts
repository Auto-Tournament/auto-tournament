/**
 * GET /api/game/cs2/matches/:slug/connect
 *
 * How a player joins one CS2 match: the server it runs on, what that server
 * says it is doing, and which map is up. The client's join panel
 * (`matchPanels.teamView`) reads it by match slug (client API 0.2.0). Before
 * that, core read the same facts off the team and player match routes and
 * handed them to the panel.
 *
 * The server's address goes only to a player on one of the two teams, as
 * `/api/team/:id/match` already decides it: the rosters decide, and admin
 * impersonation counts. Anyone else gets `server: null`, which is also what a
 * match with no server looks like.
 *
 * A match on a Ready Up server (fleet link) has a connect password, made per
 * assignment (FLEET.md D9). It goes to the roster and to admins, and nobody
 * else: an admin (not impersonating) also gets the server for such a match.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { describeMatch } from '../../../utils/matchIntegration';
import { resolveViewerIdentity } from '../../../utils/viewerIdentity';
import { matchLiveStatsService } from '../../../services/matchLiveStatsService';
import type { DbMatchRow } from '../../../types/database.types';
import { resolveViewerTeamForMatch } from '../veto/routes';
import { checkAdminAccess } from '../../../middleware/auth';
import { connectPasswordFor, fleetServerStatus } from '../fleet/driver';

const router = Router();

/** How long to wait for the server's own status before answering without it. */
const STATUS_TIMEOUT_MS = 2000;

async function serverStatus(
  serverId: string,
  matchSlug: string
): Promise<{ status: string; description: unknown } | null> {
  try {
    const { serverStatusService } = await import('../services/serverStatusService');
    const read = (async () => {
      const info = await serverStatusService.getServerStatus(serverId);
      if (!info.online || !info.status) return null;
      return {
        status: info.status,
        description: serverStatusService.getStatusDescription(info.status),
      };
    })();
    return await Promise.race([
      read,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STATUS_TIMEOUT_MS)),
    ]);
  } catch (error) {
    // Nice to have: the plugin's ConVars may not exist yet.
    log.debug('[Cs2Connect] Server status check failed', {
      matchSlug,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** The veto's picked maps, in play order. */
function pickedMaps(vetoState: string | null | undefined): string[] {
  if (!vetoState) return [];
  try {
    const parsed = JSON.parse(vetoState) as { pickedMaps?: Array<{ mapNumber?: number; mapName: string }> };
    return Array.isArray(parsed?.pickedMaps)
      ? [...parsed.pickedMaps]
          .sort((a, b) => (a.mapNumber || 0) - (b.mapNumber || 0))
          .map((m) => m.mapName)
      : [];
  } catch {
    return [];
  }
}

router.get('/matches/:slug/connect', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const match = await db.queryOneAsync<
      DbMatchRow & {
        server_name?: string;
        server_host?: string;
        server_port?: number;
        server_transport?: string | null;
      }
    >(
      `SELECT m.*, s.name as server_name, s.host as server_host, s.port as server_port,
              s.transport as server_transport
       FROM matches m
       LEFT JOIN cs2_servers s ON m.server_id = s.id
       WHERE m.slug = ?`,
      [slug]
    );
    if (!match) {
      return res.status(404).json({ success: false, error: `Match '${slug}' not found` });
    }

    const { effectiveSteamId } = await resolveViewerIdentity(req);
    const viewerTeam = await resolveViewerTeamForMatch(match, effectiveSteamId);
    const viewerIsTeamMember = viewerTeam !== null;
    const onFleet = match.server_transport === 'fleet';
    // Fleet matches: admins see how to join too (they are not asked otherwise).
    const viewerIsAdmin = onFleet && !viewerIsTeamMember ? (await checkAdminAccess(req)).ok : false;
    const canSeeServer = viewerIsTeamMember || viewerIsAdmin;

    const liveStats = matchLiveStatsService.getStats(match.slug);
    const mapNumber = liveStats?.mapNumber ?? match.map_number ?? null;
    const picked = pickedMaps(match.veto_state);
    const configMaps = describeMatch(match).maps;
    const at = (list: string[]) =>
      typeof mapNumber === 'number' && list[mapNumber] ? list[mapNumber] : list[0];
    const currentMap =
      liveStats?.mapName || match.current_map || at(picked) || at(configMaps) || null;

    let status: { status: string; description: unknown } | null = null;
    let password: string | null = null;
    if (canSeeServer && match.server_id) {
      if (onFleet) {
        const fleet = await fleetServerStatus(match.server_id);
        status =
          fleet.online && fleet.status
            ? {
                status: fleet.status,
                description: (await import('../services/serverStatusService')).serverStatusService.getStatusDescription(
                  fleet.status
                ),
              }
            : null;
        password = await connectPasswordFor(match.slug);
      } else {
        status = await serverStatus(match.server_id, match.slug);
      }
    }

    return res.json({
      success: true,
      viewerIsTeamMember,
      matchStatus: match.status,
      liveStatus: liveStats?.status ?? null,
      currentMap,
      mapNumber,
      server:
        canSeeServer && match.server_id
          ? {
              id: match.server_id,
              name: match.server_name,
              host: match.server_host,
              port: match.server_port,
              // RCON servers have no join password; the RCON password is never
              // sent. Ready Up servers: this assignment's sv_password.
              password,
              status: status?.status ?? null,
              statusDescription: status?.description ?? null,
            }
          : null,
    });
  } catch (error) {
    log.error('Error reading how to join a CS2 match', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to read match connection' });
  }
});

export default router;
