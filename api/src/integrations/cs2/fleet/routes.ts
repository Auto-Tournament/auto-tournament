/**
 * The fleet's HTTP routes, mounted at `/api/fleet` (../routes/index.ts).
 *
 * Public, for Ready Up servers:
 *   POST /api/fleet/enroll                   one-time code or fleet key → server token (FLEET.md §4.1);
 *                                            with `kind: "host"`, a csm host token (./hosts/routes.ts)
 *
 * Admin (`requireAuth`), for the Servers page:
 *   GET    /api/fleet/servers                the registry, with online state and versions
 *   POST   /api/fleet/servers                a pending server + one-time code (shown once)
 *   PATCH  /api/fleet/servers/:id            rename
 *   DELETE /api/fleet/servers/:id            forget a server (it may enroll again)
 *   POST   /api/fleet/servers/:id/code       a fresh code for a pending server
 *   POST   /api/fleet/servers/:id/revoke     revoke its tokens, close its socket (4403)
 *   POST   /api/fleet/servers/:id/rotate     rotate its token now (or on its next connect)
 *   POST   /api/fleet/servers/:id/link       take matches: link it to a cs2_servers row (./link.ts)
 *   DELETE /api/fleet/servers/:id/link       stop taking matches
 *   GET    /api/fleet/matches/:slug          a match on the fleet: assignment, live state, commands
 *   POST   /api/fleet/matches/:slug/sync     send roster / team name changes (match.update)
 *   GET    /api/fleet/keys                   fleet enrollment keys
 *   POST   /api/fleet/keys                   a new key (shown once)
 *   DELETE /api/fleet/keys/:id               revoke a key
 *
 * The WebSocket (`/api/fleet/ws`) is not a route: the gateway takes it off
 * the HTTP server's `upgrade` event (./gateway.ts).
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth, requestActorId } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { publicWsOrigin } from '../../../utils/publicOrigin';
import { validateEnrollRequest, FLEET_CLOSE, type EnrollRequest, type EnrollResponse } from './protocol/v1';
import { FLEET_WS_PATH } from './gateway';
import * as registry from './registry';
import { getLatestReadyUpRelease } from '../services/pluginVersionService';
import { readyUpUpdateStatus } from '../services/readyUpVersion';
import { fleetBus, revokeServer, rotateServerToken } from './service';
import {
  checkAddressOverride,
  cs2ServerIdOf,
  renameLinkedRow,
  detectedAddress,
  linkFleetServer,
  listLinkAddresses,
  setLinkAddress,
  unlinkFleetServer,
} from './link';
import { formatConnectAddress, unmapV4, type ConnectSource } from './address';
import { getAssignment, syncMatch } from './driver';
import { listCommands } from './reliable';
import { liveStateStore } from './state';
import { enrollHostHandler } from './hosts/routes';

// ---------------------------------------------------------------------------
// Enrollment (public)
// ---------------------------------------------------------------------------

/** 10 attempts per minute per IP (FLEET.md §15). In memory: one API process. */
const ENROLL_WINDOW_MS = 60_000;
const ENROLL_MAX = 10;
const enrollHits = new Map<string, { count: number; resetAt: number }>();

function enrollRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let entry = enrollHits.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + ENROLL_WINDOW_MS };
    enrollHits.set(key, entry);
  }
  entry.count += 1;
  if (enrollHits.size > 10_000) {
    for (const [k, v] of enrollHits) if (v.resetAt <= now) enrollHits.delete(k);
  }
  if (entry.count > ENROLL_MAX) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    res.status(429).json({ success: false, code: 'rate_limited', error: 'Too many enrollment attempts, slow down' });
    return;
  }
  next();
}

/** Test hook: forget the enrollment rate-limit counts. */
export function resetEnrollRateLimit(): void {
  enrollHits.clear();
}

/**
 * Where the server should connect: FRONTEND_BASE_URL when set, else the host
 * it enrolled through, with wss when that was https (including behind a TLS
 * proxy that sends X-Forwarded-Proto): utils/publicOrigin.ts.
 */
function wsUrl(req: Request): string {
  return `${publicWsOrigin(req)}${FLEET_WS_PATH}`;
}

export const fleetEnrollRouter = Router();

/**
 * POST /api/fleet/enroll
 * Body: protocol/v1/http/enroll.request.json. 201: enroll.response.json.
 * 400 invalid body, 401 invalid code/key, 403 revoked/expired/locked key or
 * revoked server, 409 key limit reached, 429 rate limited.
 */
fleetEnrollRouter.post('/enroll', enrollRateLimit, async (req: Request, res: Response) => {
  // csm enrolls a machine through the same URL with `kind: "host"` (FLEET.md §18.1).
  if (req.body?.kind === 'host') return enrollHostHandler(req, res);
  const check = validateEnrollRequest(req.body);
  if (!check.ok) {
    return res.status(400).json({ success: false, code: 'invalid_request', error: 'Invalid enrollment request', details: check.errors });
  }
  const body = req.body as EnrollRequest;
  try {
    const outcome = await registry.enrollServer(body);
    if (!outcome.ok) {
      log.warn(`[FLEET] enrollment refused (${outcome.code}) for install ${body.install_id} from ${req.ip}`);
      return res.status(outcome.status).json({ success: false, code: outcome.code, error: outcome.error });
    }
    // Where it enrolled from: the connect address until its first hello (./address.ts).
    await registry.setPeerAddr(outcome.server.id, req.ip ? unmapV4(req.ip) : null);
    // A re-enrolled server's old tokens were revoked; drop a session still using one.
    if (outcome.reenrolled) fleetBus().disconnect(outcome.server.id, FLEET_CLOSE.REVOKED, 're-enrolled');
    log.info(
      `[FLEET] ${outcome.reenrolled ? 're-enrolled' : 'enrolled'} ${outcome.server.id} (${outcome.server.name}) via ${
        body.code !== undefined ? 'code' : 'fleet key'
      }`
    );
    const response: EnrollResponse = {
      success: true,
      server_id: outcome.server.id,
      tenant_id: 'default',
      name: outcome.server.name,
      token: outcome.token,
      ws_url: wsUrl(req),
      reenrolled: outcome.reenrolled,
    };
    return res.status(201).json(response);
  } catch (error) {
    log.error(`[FLEET] enrollment failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, code: 'internal', error: 'Enrollment failed' });
  }
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const fleetAdminRouter = Router();
fleetAdminRouter.use(requireAuth);

/** An admin handler whose failure is a JSON 500 rather than a hung request. */
function handler(what: string, fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((error) => {
      log.error(`[FLEET] ${what} failed: ${(error as Error).message}`);
      if (!res.headersSent) res.status(500).json({ success: false, error: `Failed to ${what}` });
    });
  };
}

function withLiveState(servers: registry.FleetServerView[]): registry.FleetServerView[] {
  // The socket map is the truth for "online" in this process; the column can
  // lag a crash by one restart.
  const bus = fleetBus();
  return servers.map((s) => ({ ...s, online: bus.isConnected(s.id) }));
}

interface ConnectView {
  host: string;
  port: number;
  /** `host:port` as players type it after `connect`. */
  address: string;
  /** override: an admin set it; public_addr / peer: detected (./address.ts); null: nothing yet. */
  source: ConnectSource | null;
}

/**
 * `linkedServerId`: the cs2_servers row it plays matches as (null = not in
 * the match pool). `connect`: where players connect: the linked row's address,
 * or for an unlinked server the one a link would store now.
 */
async function withLinks<T extends { id: string; host: { public_addr?: string; game_port: number } | null; peerAddr: string | null }>(
  servers: T[]
): Promise<Array<T & { linkedServerId: string | null; connect: ConnectView | null }>> {
  const links = await listLinkAddresses();
  return servers.map((s) => {
    const link = links.get(s.id);
    const detected = detectedAddress({ host: s.host ? JSON.stringify(s.host) : null, peer_addr: s.peerAddr });
    let connect: ConnectView | null = null;
    if (link && link.host && link.host !== '0.0.0.0') {
      connect = {
        host: link.host,
        port: link.port,
        address: formatConnectAddress(link.host, link.port),
        source: link.override
          ? 'override'
          : detected && detected.host === link.host && detected.port === link.port
            ? detected.source
            : null,
      };
    } else if (!link && detected) {
      connect = { ...detected, address: formatConnectAddress(detected.host, detected.port) };
    }
    return { ...s, linkedServerId: link?.cs2ServerId ?? null, connect };
  });
}

function trimmedString(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length === 0 || t.length > max ? null : t;
}

function optionalPositiveInt(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

fleetAdminRouter.get('/servers', async (_req: Request, res: Response) => {
  try {
    const live = await withLinks(withLiveState(await registry.listFleetServers()));
    // Pre-release servers compare against the newest release incl. betas,
    // stable ones against stable releases only (both lookups are cached).
    const servers = await Promise.all(
      live.map(async (s) => {
        const latest = await getLatestReadyUpRelease({ runningVersion: s.versions?.core });
        return {
          ...s,
          // 'unknown' (never a warning) while there is no release to compare against.
          readyUpUpdate: readyUpUpdateStatus(s.versions?.core, latest),
        };
      })
    );
    return res.json({ success: true, count: servers.length, servers });
  } catch (error) {
    log.error(`[FLEET] listing servers failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to list fleet servers' });
  }
});

fleetAdminRouter.post('/servers', async (req: Request, res: Response) => {
  const name = trimmedString(req.body?.name, 100);
  if (name === null) return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
  try {
    const created = await registry.createPendingServer({ name: name ?? undefined, createdBy: requestActorId(req) });
    log.info(`[FLEET] pending server ${created.server.id} (${created.server.name}) created with a one-time code`);
    return res.status(201).json({ success: true, server: created.server, code: created.code, expiresAt: created.expiresAt });
  } catch (error) {
    log.error(`[FLEET] creating a pending server failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to create the server' });
  }
});

fleetAdminRouter.patch('/servers/:id', handler('rename the server', async (req: Request, res: Response) => {
  const name = trimmedString(req.body?.name, 100);
  if (!name) return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
  const ok = await registry.renameFleetServer(req.params.id, name);
  if (!ok) return res.status(404).json({ success: false, error: 'Fleet server not found' });
  await renameLinkedRow(req.params.id, name);
  return res.json({ success: true, server: await registry.getFleetServerView(req.params.id) });
}));

fleetAdminRouter.delete('/servers/:id', handler('remove the server', async (req: Request, res: Response) => {
  fleetBus().disconnect(req.params.id, FLEET_CLOSE.REVOKED, 'removed by an admin');
  const ok = await registry.deleteFleetServer(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Fleet server not found' });
  log.info(`[FLEET] ${req.params.id} removed`);
  return res.json({ success: true });
}));

fleetAdminRouter.post('/servers/:id/code', handler('issue a code', async (req: Request, res: Response) => {
  const issued = await registry.reissueCode(req.params.id, requestActorId(req));
  if (!issued) return res.status(409).json({ success: false, error: 'Only a pending server gets a new code' });
  return res.status(201).json({ success: true, code: issued.code, expiresAt: issued.expiresAt });
}));

fleetAdminRouter.post('/servers/:id/revoke', handler('revoke the server', async (req: Request, res: Response) => {
  const ok = await revokeServer(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Fleet server not found' });
  log.info(`[FLEET] ${req.params.id} revoked by ${requestActorId(req) ?? 'unknown'}`);
  return res.json({ success: true, server: await registry.getFleetServerView(req.params.id) });
}));

fleetAdminRouter.post('/servers/:id/rotate', async (req: Request, res: Response) => {
  const server = await registry.getFleetServer(req.params.id);
  if (!server) return res.status(404).json({ success: false, error: 'Fleet server not found' });
  if (server.status !== 'enrolled') {
    return res.status(409).json({ success: false, error: 'Only an enrolled server has a token to rotate' });
  }
  try {
    if (await rotateServerToken(server.id)) {
      return res.json({ success: true, rotation: 'sent' });
    }
    await registry.requestRotation(server.id);
    return res.status(202).json({ success: true, rotation: 'on_next_connect' });
  } catch (error) {
    log.error(`[FLEET] ${server.id}: rotation failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Rotation failed' });
  }
});

/**
 * Take matches: link the server to a cs2_servers row (`serverId`, an
 * existing server moved to Ready Up) or to a new one named after it. The
 * allocator then hands it matches whenever it is online and `available`.
 */
fleetAdminRouter.post('/servers/:id/link', handler('link the server', async (req: Request, res: Response) => {
  const serverId = trimmedString(req.body?.serverId, 100);
  if (serverId === null) return res.status(400).json({ success: false, error: 'serverId must be 1-100 characters' });
  const name = trimmedString(req.body?.name, 100);
  if (name === null) return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
  const address = checkAddressOverride({ host: req.body?.host, port: req.body?.port });
  if (!address.ok) return res.status(400).json({ success: false, error: address.error });
  const outcome = await linkFleetServer(req.params.id, {
    ...(serverId ? { serverId } : {}),
    ...(name ? { name } : {}),
    ...(address.override ? { address: address.override } : {}),
  });
  if (!outcome.ok) return res.status(outcome.status).json({ success: false, error: outcome.error });
  log.info(
    `[FLEET] ${req.params.id} linked to server ${outcome.link.cs2ServerId}${outcome.created ? ' (new)' : ''} by ${requestActorId(req) ?? 'unknown'}`
  );
  return res.status(outcome.created ? 201 : 200).json({ success: true, ...outcome.link, created: outcome.created });
}));

/**
 * The connect address of a linked server. Body `{host, port?}` sets an admin
 * override (hellos no longer change it); `{host: null}` (or empty) goes back to
 * the detected address (public_addr, else the link's peer address).
 */
fleetAdminRouter.put('/servers/:id/address', handler('set the connect address', async (req: Request, res: Response) => {
  const address = checkAddressOverride({ host: req.body?.host, port: req.body?.port });
  if (!address.ok) return res.status(400).json({ success: false, error: address.error });
  const stored = await setLinkAddress(req.params.id, address.override);
  if (!stored) return res.status(404).json({ success: false, error: 'Fleet server is not linked' });
  log.info(
    `[FLEET] ${req.params.id}: connect address ${address.override ? `set to ${stored.host}:${stored.port}` : 'back to automatic'} by ${requestActorId(req) ?? 'unknown'}`
  );
  return res.json({
    success: true,
    cs2ServerId: stored.cs2ServerId,
    host: stored.host,
    port: stored.port,
    address: formatConnectAddress(stored.host, stored.port),
    override: stored.override,
  });
}));

fleetAdminRouter.delete('/servers/:id/link', handler('unlink the server', async (req: Request, res: Response) => {
  const cs2ServerId = await unlinkFleetServer(req.params.id);
  if (!cs2ServerId) return res.status(404).json({ success: false, error: 'Fleet server is not linked' });
  log.info(`[FLEET] ${req.params.id} unlinked from server ${cs2ServerId} by ${requestActorId(req) ?? 'unknown'}`);
  return res.json({ success: true, cs2ServerId });
}));

/**
 * A match on the fleet: its assignment (epoch, server; never the password),
 * the live state record, and the platform's commands with their answers.
 */
fleetAdminRouter.get('/matches/:slug', handler('read the fleet match', async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const [assignment, record, commands] = await Promise.all([
    getAssignment(slug),
    liveStateStore.getLiveState(slug),
    listCommands(slug),
  ]);
  if (!assignment && !record) return res.status(404).json({ success: false, error: 'Match was never on a fleet server' });
  const linked = assignment?.serverId ? await cs2ServerIdOf(assignment.serverId) : null;
  return res.json({
    success: true,
    assignment: assignment
      ? {
          matchSlug: assignment.matchSlug,
          epoch: assignment.epoch,
          fleetServerId: assignment.serverId,
          serverId: assignment.cs2ServerId ?? linked,
          endedAt: assignment.endedAt,
          config: assignment.config,
        }
      : null,
    liveState: record,
    commands,
  });
}));

/** Roster / team name changes since the assignment → `match.update` (config_rev CAS). */
fleetAdminRouter.post('/matches/:slug/sync', handler('sync the fleet match', async (req: Request, res: Response) => {
  const outcome = await syncMatch(String(req.params.slug));
  if (!outcome.ok) return res.status(outcome.status).json({ success: false, error: outcome.error });
  return res.json({ success: true, ops: outcome.ops, configRev: outcome.configRev });
}));

fleetAdminRouter.get('/keys', handler('list fleet keys', async (_req: Request, res: Response) => {
  const keys = await registry.listFleetKeys();
  return res.json({ success: true, count: keys.length, keys });
}));

fleetAdminRouter.post('/keys', handler('create the fleet key', async (req: Request, res: Response) => {
  const name = trimmedString(req.body?.name, 100);
  if (!name) return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
  const namePrefix = trimmedString(req.body?.namePrefix, 40);
  if (namePrefix === null) return res.status(400).json({ success: false, error: 'namePrefix must be 1-40 characters' });
  const maxServers = optionalPositiveInt(req.body?.maxServers);
  if (maxServers === null) return res.status(400).json({ success: false, error: 'maxServers must be a positive integer' });
  const expiresInDays = optionalPositiveInt(req.body?.expiresInDays);
  if (expiresInDays === null) return res.status(400).json({ success: false, error: 'expiresInDays must be a positive integer' });
  const created = await registry.createFleetKey({
    name,
    namePrefix: namePrefix ?? null,
    maxServers: maxServers ?? null,
    expiresAt: expiresInDays ? Math.floor(Date.now() / 1000) + expiresInDays * 86400 : null,
    createdBy: requestActorId(req),
  });
  log.info(`[FLEET] fleet key ${created.key.id} (${created.key.name}) created`);
  return res.status(201).json({ success: true, key: created.key, value: created.value });
}));

fleetAdminRouter.delete('/keys/:id', handler('revoke the fleet key', async (req: Request, res: Response) => {
  const ok = await registry.revokeFleetKey(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Fleet key not found or already revoked' });
  log.info(`[FLEET] fleet key ${req.params.id} revoked`);
  return res.json({ success: true });
}));
