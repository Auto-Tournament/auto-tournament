/**
 * The fleet's HTTP routes, mounted at `/api/fleet` (../routes/index.ts).
 *
 * Public, for Ready Up servers:
 *   POST /api/fleet/enroll                   one-time code or fleet key → server token (FLEET.md §4.1)
 *
 * Admin (`requireAuth`), for the Servers page:
 *   GET    /api/fleet/servers                the registry, with online state and versions
 *   POST   /api/fleet/servers                a pending server + one-time code (shown once)
 *   PATCH  /api/fleet/servers/:id            rename
 *   DELETE /api/fleet/servers/:id            forget a server (it may enroll again)
 *   POST   /api/fleet/servers/:id/code       a fresh code for a pending server
 *   POST   /api/fleet/servers/:id/revoke     revoke its tokens, close its socket (4403)
 *   POST   /api/fleet/servers/:id/rotate     rotate its token now (or on its next connect)
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
import { validateEnrollRequest, FLEET_CLOSE, type EnrollRequest, type EnrollResponse } from './protocol/v1';
import { FLEET_WS_PATH } from './gateway';
import * as registry from './registry';
import { fleetBus, revokeServer, rotateServerToken } from './service';

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

/** Where the server should connect: the same host it enrolled through. */
function wsUrl(req: Request): string {
  const proto = req.protocol === 'https' ? 'wss' : 'ws';
  return `${proto}://${req.get('host')}${FLEET_WS_PATH}`;
}

export const fleetEnrollRouter = Router();

/**
 * POST /api/fleet/enroll
 * Body: protocol/v1/http/enroll.request.json. 201: enroll.response.json.
 * 400 invalid body, 401 invalid code/key, 403 revoked/expired/locked key or
 * revoked server, 409 key limit reached, 429 rate limited.
 */
fleetEnrollRouter.post('/enroll', enrollRateLimit, async (req: Request, res: Response) => {
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
    const servers = withLiveState(await registry.listFleetServers());
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
