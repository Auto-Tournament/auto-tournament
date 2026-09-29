/**
 * The host channel's HTTP routes (FLEET.md §18), mounted at `/api/fleet`.
 *
 * Public, for csm (through ../routes.ts, FLEET.md §18.1):
 *   POST /api/fleet/enroll with `kind: "host"`   one-time machine code or fleet key → host token (rhs_…)
 *
 * Admin (`requireAuth`), for Servers → Machines:
 *   GET    /api/fleet/hosts                 machines with inventory, joined Ready Up servers, recent commands
 *   POST   /api/fleet/hosts                 a pending machine + one-time code + the `csm link` command
 *   GET    /api/fleet/hosts/:id             one machine, with more command and health history
 *   PATCH  /api/fleet/hosts/:id             rename
 *   DELETE /api/fleet/hosts/:id             forget a machine (it may enroll again)
 *   POST   /api/fleet/hosts/:id/code        a fresh code for a pending machine
 *   POST   /api/fleet/hosts/:id/revoke      revoke its token (4403) and its server.create keys
 *   POST   /api/fleet/hosts/:id/rotate      rotate its token now (or on its next connect)
 *   POST   /api/fleet/hosts/:id/commands    send a command (server.start/stop/restart/create, host.update_*, …)
 *   GET    /api/fleet/hosts/:id/commands/:commandId   its progress and host.result
 *
 * The WebSocket (`/api/fleet/host`) is not a route: ./gateway.ts takes it off
 * the HTTP server's `upgrade` event.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth, requestActorId } from '../../../../middleware/auth';
import { log } from '../../../../utils/logger';
import { isHostCommandType, validateHostEnrollRequest, type HostEnrollRequest, type HostEnrollResponse } from '../protocol/host/v1';
import { validatePluginSet } from '../push/pluginSets';
import { FLEET_HOST_WS_PATH } from './gateway';
import * as registry from './registry';
import {
  HostCommandError,
  disconnectHost,
  isHostOnline,
  listHostViews,
  revokeHostAndDisconnect,
  rotateHostToken,
  sendHostCommand,
} from './service';

/** The one command an admin runs on a new machine (Machines → Add machine). */
export function linkCommand(platformUrl: string, code: string): string {
  return `csm link ${platformUrl} ${code}`;
}

function platformUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

function hostWsUrl(req: Request): string {
  const proto = req.protocol === 'https' ? 'wss' : 'ws';
  return `${proto}://${req.get('host')}${FLEET_HOST_WS_PATH}`;
}

// ---------------------------------------------------------------------------
// Enrollment (public)
// ---------------------------------------------------------------------------

/**
 * `POST /api/fleet/enroll` with `kind: "host"` (../routes.ts sends it here,
 * after the enrollment rate limit).
 * Body: protocol/host/v1/http/enroll.request.json. 201: enroll.response.json.
 * 400 invalid body, 401 invalid code/key, 403 revoked/expired/locked key or
 * revoked machine, 429 rate limited.
 */
export async function enrollHostHandler(req: Request, res: Response): Promise<unknown> {
  const check = validateHostEnrollRequest(req.body);
  if (!check.ok) {
    return res.status(400).json({ success: false, code: 'invalid_request', error: 'Invalid host enrollment request', details: check.errors });
  }
  const body = req.body as HostEnrollRequest;
  try {
    const outcome = await registry.enrollHost(body);
    if (!outcome.ok) {
      log.warn(`[FLEET-HOST] enrollment refused (${outcome.code}) for machine ${body.machine_id} from ${req.ip}`);
      return res.status(outcome.status).json({ success: false, code: outcome.code, error: outcome.error });
    }
    if (outcome.reenrolled) disconnectHost(outcome.host.id, 're-enrolled');
    log.info(
      `[FLEET-HOST] ${outcome.reenrolled ? 're-enrolled' : 'enrolled'} ${outcome.host.id} (${outcome.host.name}) via ${
        body.code !== undefined ? 'code' : 'fleet key'
      }`
    );
    const response: HostEnrollResponse = {
      success: true,
      host_id: outcome.host.id,
      tenant_id: 'default',
      name: outcome.host.name,
      token: outcome.token,
      ws_url: hostWsUrl(req),
      reenrolled: outcome.reenrolled,
    };
    return res.status(201).json(response);
  } catch (error) {
    log.error(`[FLEET-HOST] enrollment failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, code: 'internal', error: 'Enrollment failed' });
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const fleetHostAdminRouter = Router();
fleetHostAdminRouter.use(requireAuth);

function handler(what: string, fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((error) => {
      if (error instanceof HostCommandError) {
        if (!res.headersSent) {
          res.status(error.status).json({ success: false, code: error.code, error: error.message, ...(error.details ?? {}) });
        }
        return;
      }
      log.error(`[FLEET-HOST] ${what} failed: ${(error as Error).message}`);
      if (!res.headersSent) res.status(500).json({ success: false, error: `Failed to ${what}` });
    });
  };
}

function trimmedString(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length === 0 || t.length > max ? null : t;
}

fleetHostAdminRouter.get('/hosts', handler('list machines', async (_req, res) => {
  const hosts = await listHostViews();
  return res.json({ success: true, count: hosts.length, hosts });
}));

fleetHostAdminRouter.post('/hosts', handler('add a machine', async (req, res) => {
  const name = trimmedString(req.body?.name, 100);
  if (name === null) return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
  const created = await registry.createPendingHost({ name: name ?? undefined, createdBy: requestActorId(req) });
  log.info(`[FLEET-HOST] pending machine ${created.host.id} (${created.host.name}) created with a one-time code`);
  return res.status(201).json({
    success: true,
    host: created.host,
    code: created.code,
    expiresAt: created.expiresAt,
    command: linkCommand(platformUrl(req), created.code),
  });
}));

fleetHostAdminRouter.get('/hosts/:id', handler('read the machine', async (req, res) => {
  const hosts = await listHostViews({ commands: 50, health: 50 });
  const host = hosts.find((h) => h.id === req.params.id);
  if (!host) return res.status(404).json({ success: false, error: 'Machine not found' });
  return res.json({ success: true, host });
}));

fleetHostAdminRouter.patch('/hosts/:id', handler('rename the machine', async (req, res) => {
  const name = trimmedString(req.body?.name, 100);
  if (!name) return res.status(400).json({ success: false, error: 'name must be 1-100 characters' });
  if (!(await registry.renameHost(req.params.id, name))) return res.status(404).json({ success: false, error: 'Machine not found' });
  return res.json({ success: true, host: await registry.getHostView(req.params.id) });
}));

fleetHostAdminRouter.delete('/hosts/:id', handler('remove the machine', async (req, res) => {
  disconnectHost(req.params.id, 'removed by an admin');
  if (!(await registry.deleteHost(req.params.id))) return res.status(404).json({ success: false, error: 'Machine not found' });
  log.info(`[FLEET-HOST] ${req.params.id} removed`);
  return res.json({ success: true });
}));

fleetHostAdminRouter.post('/hosts/:id/code', handler('issue a code', async (req, res) => {
  const issued = await registry.reissueHostCode(req.params.id, requestActorId(req));
  if (!issued) return res.status(409).json({ success: false, error: 'Only a pending machine gets a new code' });
  return res.status(201).json({ success: true, code: issued.code, expiresAt: issued.expiresAt, command: linkCommand(platformUrl(req), issued.code) });
}));

fleetHostAdminRouter.post('/hosts/:id/revoke', handler('revoke the machine', async (req, res) => {
  if (!(await revokeHostAndDisconnect(req.params.id))) return res.status(404).json({ success: false, error: 'Machine not found' });
  log.info(`[FLEET-HOST] ${req.params.id} revoked by ${requestActorId(req) ?? 'unknown'}`);
  return res.json({ success: true, host: await registry.getHostView(req.params.id) });
}));

fleetHostAdminRouter.post('/hosts/:id/rotate', handler('rotate the token', async (req, res) => {
  const host = await registry.getHost(req.params.id);
  if (!host) return res.status(404).json({ success: false, error: 'Machine not found' });
  if (host.status !== 'enrolled') return res.status(409).json({ success: false, error: 'Only an enrolled machine has a token to rotate' });
  if (isHostOnline(host.id) && (await rotateHostToken(host.id))) return res.json({ success: true, rotation: 'sent' });
  await registry.requestHostRotation(host.id);
  return res.status(202).json({ success: true, rotation: 'on_next_connect' });
}));

/**
 * Body: `{ type, payload?, force?: { reason }, plugins?: { preset, plugins? } }`
 * (`plugins` only with server.create: the new servers' Ready Up plugin set). 202 with the command record
 * (`delivered` false = queued until csm reconnects). 409 `match_in_progress`
 * (with `servers`) for a disruptive command on a server with a live match
 * and no `force`; 400 for an invalid payload.
 */
fleetHostAdminRouter.post('/hosts/:id/commands', handler('send the command', async (req, res) => {
  const type = req.body?.type;
  if (!isHostCommandType(type)) return res.status(400).json({ success: false, code: 'invalid_type', error: 'Unknown command type' });
  const payload = req.body?.payload ?? {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ success: false, code: 'invalid_payload', error: 'payload must be an object' });
  }
  let force: { reason: string } | null = null;
  if (req.body?.force !== undefined && req.body?.force !== null && req.body?.force !== false) {
    const reason = trimmedString(req.body.force?.reason, 500);
    if (!reason) return res.status(400).json({ success: false, code: 'invalid_force', error: 'force.reason must be 1-500 characters' });
    force = { reason };
  }
  // server.create enrolls its servers unless told otherwise, and can carry
  // the plugin set they get once they enroll (else the fleet default).
  const body = type === 'server.create' && payload.enroll === undefined ? { ...payload, enroll: true } : payload;
  let meta: Record<string, unknown> | undefined;
  if (req.body?.plugins !== undefined && req.body?.plugins !== null) {
    if (type !== 'server.create') {
      return res.status(400).json({ success: false, code: 'invalid_plugins', error: 'plugins only go with server.create' });
    }
    const check = validatePluginSet(req.body.plugins);
    if (!check.ok) return res.status(400).json({ success: false, code: 'invalid_plugins', error: check.error });
    meta = { plugins: check.value };
  }
  const sent = await sendHostCommand(req.params.id, type, body, { issuedBy: requestActorId(req), force, meta });
  return res.status(202).json({ success: true, delivered: sent.delivered, command: sent.command });
}));

fleetHostAdminRouter.get('/hosts/:id/commands/:commandId', handler('read the command', async (req, res) => {
  const command = await registry.getHostCommand(req.params.commandId);
  if (!command || command.hostId !== req.params.id) return res.status(404).json({ success: false, error: 'Command not found' });
  return res.json({ success: true, command });
}));
