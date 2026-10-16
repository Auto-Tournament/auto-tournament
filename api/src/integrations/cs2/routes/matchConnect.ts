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
 *
 * A finished match (completed or cancelled) gets `server: null` too: its
 * `server_id` stays set, but the server has moved on to another match, so its
 * status and address are that match's. In a shuffle the next round puts players
 * on new servers, and a round-1 page still offering Connect sent them onto
 * another match's server, which kicked them (NTLAN, 2026-10-16). A player on a
 * finished match gets `currentMatchSlug`: their match that is loaded or live
 * in the same tournament, if any, to go to instead.
 */

import { Router, Request, Response } from 'express';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { describeMatch } from '../../../utils/matchIntegration';
import { resolveViewerIdentity } from '../../../utils/viewerIdentity';
import { matchLiveStatsService } from '../../../services/matchLiveStatsService';
import type { DbMatchRow } from '../../../types/database.types';
import { resolveViewerTeamForMatch } from '../veto/routes';
import { checkAdminAccess } from '../../../middleware/auth';
import { connectPasswordFor, fleetServerStatus } from '../fleet/driver';
import { recentMove } from '../fleet/failover';
import { liveStateStore } from '../fleet/state';
import { pauseView } from '../fleet/pauseView';
import { connectChoice } from '../fleet/connectChoice';
import { QUEUE_ORDER_SQL } from '../../../core/allocationQueue';

/** The match is over: its server, if it still names one, belongs to another match now. */
function isFinishedMatchStatus(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'cancelled';
}

/**
 * The viewer's match that is loaded or live in the same tournament, other than this one; null
 * when there is none. Shuffle rounds re-form the teams, so it goes by the rosters, not team ids.
 */
async function viewerCurrentMatchSlug(
  match: DbMatchRow,
  steamId: string | null
): Promise<string | null> {
  if (!steamId || !match.tournament_id) return null;
  const candidates = await db
    .queryAsync<DbMatchRow>(
      `SELECT * FROM matches
        WHERE tournament_id = ? AND slug <> ? AND status IN ('loaded', 'live')
          AND server_id IS NOT NULL`,
      [match.tournament_id, match.slug]
    )
    .catch(() => [] as DbMatchRow[]);
  for (const other of candidates) {
    if (await resolveViewerTeamForMatch(other, steamId).catch(() => null)) return other.slug;
  }
  return null;
}

/**
 * Whether the move no longer concerns this viewer: they are connected again (a player), or every
 * connected-able roster player is (anyone else). False with no players known.
 */
function backOnServer(state: unknown, steamId: string | null | undefined): boolean {
  const teams = (
    state as {
      teams?: Record<string, { players?: Record<string, { connected?: boolean }> }>;
    } | null
  )?.teams;
  const players = Object.values(teams ?? {}).flatMap((t) => Object.entries(t?.players ?? {}));
  if (players.length === 0) return false;
  const mine = steamId ? players.find(([id]) => id === steamId) : undefined;
  if (mine) return mine[1].connected === true;
  return players.every(([, p]) => p.connected === true);
}

/** Whether this roster player is on the match's server now; null when the live state does not list them. */
function viewerOnServer(state: unknown, steamId: string | null | undefined): boolean | null {
  if (!steamId) return null;
  const teams = (
    state as {
      teams?: Record<string, { players?: Record<string, { connected?: boolean }> }>;
    } | null
  )?.teams;
  for (const t of Object.values(teams ?? {})) {
    const p = t?.players?.[steamId];
    if (p) return p.connected === true;
  }
  return null;
}

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
    const parsed = JSON.parse(vetoState) as {
      pickedMaps?: Array<{ mapNumber?: number; mapName: string }>;
    };
    return Array.isArray(parsed?.pickedMaps)
      ? [...parsed.pickedMaps]
          .sort((a, b) => (a.mapNumber || 0) - (b.mapNumber || 0))
          .map((m) => m.mapName)
      : [];
  } catch {
    return [];
  }
}

/**
 * The IPv4 address of a connect host, for the `steam://connect/` link: Steam
 * passes a hostname on but CS2 ignores it (live test: the button opened Steam
 * and nothing happened; the same link with the IP joined). Null when it does
 * not resolve quickly; the client then falls back to the host.
 */
export async function connectIp(host: string | null | undefined): Promise<string | null> {
  if (!host) return null;
  if (isIP(host)) return host;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    const found = await Promise.race([lookup(host, { family: 4 }), timeout]);
    return found ? found.address : null;
  } catch {
    return null;
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
    const finished = isFinishedMatchStatus(match.status);
    const canSeeServer = (viewerIsTeamMember || viewerIsAdmin) && !finished;
    const currentMatchSlug =
      finished && viewerIsTeamMember ? await viewerCurrentMatchSlug(match, effectiveSteamId) : null;

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
    // A failover moved the match in the last half hour: players reconnect.
    let moved: { at: number; reason: string; inPlace: boolean } | null = null;
    // Ready Up: the match is paused, and whose seat is empty.
    let pause: { type: string | null; waitingFor: string[] } | null = null;
    // The viewer is on the server: the panel offers the other address when a Connect did not land.
    let viewerConnected: boolean | null = null;
    if (canSeeServer && match.server_id) {
      if (onFleet) {
        const move = await recentMove(match.slug).catch(() => null);
        if (move && move.newCs2ServerId === match.server_id) {
          moved = { at: move.updatedAt, reason: move.reason, inPlace: move.reason === 'restarted' };
        }
        const fleet = await fleetServerStatus(match.server_id);
        status =
          fleet.online && fleet.status
            ? {
                status: fleet.status,
                description: (
                  await import('../services/serverStatusService')
                ).serverStatusService.getStatusDescription(fleet.status),
              }
            : null;
        password = await connectPasswordFor(match.slug);
        const live = await liveStateStore.getLiveState(match.slug).catch(() => null);
        pause = pauseView(live?.state ?? null);
        if (viewerIsTeamMember)
          viewerConnected = viewerOnServer(live?.state ?? null, effectiveSteamId);
        // The viewer is back on the server (or, for an admin, everyone is): the move is done, no
        // "reconnect" notice (it stayed up while the player was playing again, 2026-10-15).
        if (moved && backOnServer(live?.state ?? null, effectiveSteamId)) moved = null;
      } else {
        status = await serverStatus(match.server_id, match.slug);
      }
    }

    // No server yet: the match's place in line for one (the allocator's order), 1 = next.
    let queuePosition: number | null = null;
    if (!match.server_id && (match.status === 'pending' || match.status === 'ready')) {
      const waiting = await db
        .queryAsync<{ slug: string }>(
          `SELECT slug FROM matches
            WHERE server_id IS NULL AND status IN ('pending', 'ready')
              AND team1_id IS NOT NULL AND team2_id IS NOT NULL AND team1_id <> team2_id
              ${match.tournament_id ? 'AND tournament_id = ?' : ''}
            ORDER BY ${QUEUE_ORDER_SQL}`,
          match.tournament_id ? [match.tournament_id] : []
        )
        .catch(() => []);
      const at = waiting.findIndex((w) => w.slug === match.slug);
      queuePosition = at >= 0 ? at + 1 : null;
    }

    // A LAN address and a public one: the viewer gets the one for where they are (on the
    // server's network: LAN), and both are listed to pick from (fleet/connectChoice.ts).
    const viewerIp = req.get('cf-connecting-ip') || req.ip || null;
    const choice =
      canSeeServer && match.server_id && onFleet
        ? await connectChoice(match.server_id, viewerIp).catch(() => null)
        : null;
    const chosen = choice?.options.find((o) => o.kind === choice.recommended) ?? null;
    const host = chosen?.host ?? match.server_host;
    const port = chosen?.port ?? match.server_port;

    return res.json({
      success: true,
      viewerIsTeamMember,
      matchStatus: match.status,
      liveStatus: liveStats?.status ?? null,
      roundNumber: liveStats?.roundNumber ?? null,
      queuePosition,
      currentMatchSlug,
      currentMap,
      mapNumber,
      server:
        canSeeServer && match.server_id
          ? {
              id: match.server_id,
              name: match.server_name,
              host,
              ip: await connectIp(host),
              port,
              // Where to connect from: the LAN address and the public one, when they differ.
              addresses: choice
                ? await Promise.all(
                    choice.options.map(async (o) => ({ ...o, ip: await connectIp(o.host) }))
                  )
                : null,
              recommended: choice?.recommended ?? null,
              // RCON servers have no join password; the RCON password is never
              // sent. Ready Up servers: this assignment's sv_password.
              password,
              status: status?.status ?? null,
              statusDescription: status?.description ?? null,
              moved,
              pause,
              viewerConnected,
            }
          : null,
    });
  } catch (error) {
    log.error('Error reading how to join a CS2 match', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to read match connection' });
  }
});

export default router;
