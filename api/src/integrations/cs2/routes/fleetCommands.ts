/**
 * The admin server buttons (`/api/rcon/*`, ./rcon.ts) on a Ready Up server:
 * the same routes, sent as a fleet `cmd` (FLEET.md §7.4) instead of an RCON
 * command, answered with the server's `cmd.result`.
 *
 * The response keeps the RCON shape (`success`, `response`, `error`) so the
 * admin UI reads both the same way, plus `transport: 'fleet'`, the result
 * `status` / `errorCode` and the command id.
 */

import type { Request, Response } from 'express';
import { requestActorId, type AuthedRequest } from '../../../middleware/auth';
import { parseAdminSteamIds } from '../../../utils/adminSteamIds';
import { transportOf } from '../driver';
import {
  execOnFleetServer,
  runFleetCommand,
  type FleetCommandOutcome,
  type IssuedBy,
} from '../fleet/driver';
import type { CmdName } from '../fleet/protocol/v1';

/**
 * Root (FLEET.md D10: `exec`): an admin-scope API token, or a signed-in
 * admin whose Steam ID is in `ADMIN_STEAM_IDS` (the instance's operators).
 * Other admins drive matches but cannot run raw console commands on a Ready
 * Up server.
 */
export function isRootRequest(req: Request): boolean {
  const token = (req as AuthedRequest).serviceToken;
  if (token) return token.scope === 'admin';
  const actor = requestActorId(req);
  return !!actor && parseAdminSteamIds(process.env.ADMIN_STEAM_IDS).valid.includes(actor);
}

export function issuedBy(req: Request): IssuedBy & { actor: string | null } {
  const actor = requestActorId(req);
  return { userId: actor ?? 'unknown', name: actor ?? 'admin', root: isRootRequest(req), actor };
}

export function fleetResponseBody(outcome: FleetCommandOutcome & { auditId?: string }) {
  return {
    success: outcome.ok,
    transport: 'fleet' as const,
    status: outcome.status,
    errorCode: outcome.errorCode,
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.output !== undefined ? { response: outcome.output } : {}),
    ...(outcome.commandId ? { commandId: outcome.commandId } : {}),
    ...(outcome.matchSlug ? { matchSlug: outcome.matchSlug } : {}),
    ...(outcome.auditId ? { auditId: outcome.auditId } : {}),
  };
}

export async function isFleetServer(serverId: string): Promise<boolean> {
  return (await transportOf(serverId)) === 'fleet';
}

/**
 * Answer the request with a fleet command when `serverId` is a Ready Up
 * server. Returns false (nothing sent, nothing answered) for an RCON server,
 * so the route carries on with its RCON command.
 */
export async function answerWithFleetCommand(
  req: Request,
  res: Response,
  serverId: string,
  name: CmdName,
  args: Record<string, unknown> = {}
): Promise<boolean> {
  if (!(await isFleetServer(serverId))) return false;
  const outcome = await runFleetCommand(serverId, name, args, issuedBy(req));
  res.status(outcome.httpStatus).json(fleetResponseBody(outcome));
  return true;
}

/** A button that has no Ready Up equivalent. */
export async function answerUnsupportedOnFleet(
  res: Response,
  serverId: string,
  what: string
): Promise<boolean> {
  if (!(await isFleetServer(serverId))) return false;
  res.status(400).json({
    success: false,
    transport: 'fleet',
    error: `${what} is not available on Ready Up servers`,
  });
  return true;
}

/** `exec` (root only, audited). 403 for anyone else. */
export async function fleetExec(
  req: Request,
  serverId: string,
  command: string
): Promise<{ httpStatus: number; body: ReturnType<typeof fleetResponseBody> | { success: false; error: string } }> {
  const who = issuedBy(req);
  if (!who.root) {
    return {
      httpStatus: 403,
      body: {
        success: false,
        error: 'Raw console commands on Ready Up servers are for root admins only (ADMIN_STEAM_IDS or an admin API token)',
      },
    };
  }
  const line = command.trim();
  if (!line || line.includes('\n') || Buffer.byteLength(line, 'utf8') > 512) {
    return { httpStatus: 400, body: { success: false, error: 'exec takes one line of at most 512 bytes' } };
  }
  const outcome = await execOnFleetServer(serverId, line, who);
  return { httpStatus: outcome.httpStatus, body: fleetResponseBody(outcome) };
}

/**
 * The generic `/api/rcon/command` names (the admin console's command list)
 * as fleet commands. Null: no Ready Up equivalent.
 */
export function fleetCommandFor(input: {
  command: string;
  message?: unknown;
  round?: unknown;
  value?: unknown;
  map?: unknown;
}): { name: CmdName; args: Record<string, unknown> } | null {
  const base = input.command.replace(/^css_/, '').split(' ')[0];
  switch (base) {
    case 'pause':
      return { name: 'pause', args: { type: 'technical' } };
    case 'forcepause':
    case 'fp':
      return { name: 'pause', args: { type: 'admin' } };
    case 'unpause':
    case 'forceunpause':
    case 'fup':
      return { name: 'unpause', args: {} };
    case 'start':
    case 'forcestart':
    case 'force_ready':
    case 'forceready':
      return { name: base === 'start' ? 'start' : 'force_ready', args: {} };
    case 'switch':
    case 'swap':
      return { name: 'swap_teams', args: {} };
    case 'endmatch':
      return { name: 'end_match', args: { reason: 'admin' } };
    case 'map':
    case 'changemap':
      return typeof input.map === 'string' || typeof input.value === 'string'
        ? { name: 'change_map', args: { name: String(input.map ?? input.value) } }
        : null;
    case 'say':
    case 'asay':
      return typeof input.message === 'string'
        ? { name: 'say', args: { text: input.message.slice(0, 190), as_admin: base === 'asay' } }
        : null;
    default:
      return null;
  }
}
