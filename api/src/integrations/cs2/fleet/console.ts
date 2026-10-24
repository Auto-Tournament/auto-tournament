import type { Request, Response } from 'express';
import { log } from '../../../utils/logger';
import type { Untrusted } from '../../../utils/untrusted';
import { isRootRequest, issuedBy } from '../routes/fleetCommands';
import { auditedFleetCommand } from './driver';
import * as registry from './registry';
import { fleetBus } from './service';

/** `GET /api/fleet/root`: whether the signed-in admin may run console commands (the panel shows only to them). */
export function rootHandler(req: Request, res: Response): Response {
  return res.json({ success: true, root: isRootRequest(req) });
}

/**
 * `POST /api/fleet/servers/:id/exec { command }`: one console line on a Ready Up server
 * (`cmd exec`, FLEET.md D10), audited. Root only: an admin-scope API token, the local admin
 * account, or an admin Steam ID saved in Settings. One line of at most 512 bytes.
 */
export async function execHandler(req: Request, res: Response): Promise<Response> {
  const who = issuedBy(req);
  if (!who.root) {
    return res.status(403).json({
      success: false,
      error:
        'Raw console commands on Ready Up servers are for root admins only (the setup admin, Admin Steam IDs in Settings -> Sign-in, or an admin API token)',
    });
  }
  const raw = (req.body as { command?: Untrusted } | undefined)?.command;
  const line = typeof raw === 'string' ? raw.trim() : '';
  if (!line || line.includes('\n') || Buffer.byteLength(line, 'utf8') > 512) {
    return res
      .status(400)
      .json({ success: false, error: 'exec takes one line of at most 512 bytes' });
  }
  const server = await registry.getFleetServer(req.params.id);
  if (!server) return res.status(404).json({ success: false, error: 'Fleet server not found' });
  if (!fleetBus().isConnected(server.id)) {
    return res
      .status(409)
      .json({ success: false, errorCode: 'offline', error: 'The Ready Up server is offline' });
  }
  try {
    const outcome = await auditedFleetCommand(server.id, 'exec', { command: line }, line, who);
    return res.status(outcome.httpStatus).json({
      success: outcome.ok,
      ...(outcome.output !== undefined ? { response: outcome.output } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
      errorCode: outcome.errorCode,
      auditId: outcome.auditId,
    });
  } catch (error) {
    log.error(`[FLEET] ${server.id}: exec failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'The command failed' });
  }
}
