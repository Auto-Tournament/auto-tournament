import type { Request, Response } from 'express';
import { log } from '../../../utils/logger';
import type { Untrusted } from '../../../utils/untrusted';
import { issuedBy } from '../routes/fleetCommands';
import { runFleetCommandOn } from './driver';
import { isSteam64 } from './push/admins';
import { hasControlChars } from './push/settings';
import type { StateSnapshotPayload } from './protocol/v1/types';
import * as registry from './registry';
import { fleetBus } from './service';

/** A human on a Ready Up server, from its latest state.snapshot `players` (assigned or not). */
export interface FleetPlayer {
  steamid64: string;
  name: string;
  team: 'none' | 'spectator' | 't' | 'ct';
}

const latest = new Map<string, FleetPlayer[]>();

/**
 * Keep the players a snapshot reports. One without `players` (built by fleet.so itself:
 * a state.request answer, a reconnect; or an older Ready Up) leaves the list as it was.
 */
export function noteSnapshot(fleetServerId: string, payload: StateSnapshotPayload): void {
  if (Array.isArray(payload.players)) latest.set(fleetServerId, payload.players.slice(0, 64));
}

/** Who is on the server now: nobody when it is offline or never said. */
export function fleetPlayersOf(fleetServerId: string): FleetPlayer[] {
  if (!fleetBus().isConnected(fleetServerId)) return [];
  return latest.get(fleetServerId) ?? [];
}

/** `GET /api/fleet/servers/:id/players`: who the server's last snapshot listed. */
export async function playersHandler(req: Request, res: Response): Promise<Response> {
  const server = await registry.getFleetServer(req.params.id);
  if (!server) return res.status(404).json({ success: false, error: 'Fleet server not found' });
  return res.json({ success: true, players: fleetPlayersOf(server.id) });
}

/** `POST /api/fleet/servers/:id/kick` (any admin): cmd kick, no match needed. */
export async function kickHandler(req: Request, res: Response): Promise<Response> {
  const { steamid64, message } = (req.body ?? {}) as { steamid64?: Untrusted; message?: Untrusted };
  if (!isSteam64(steamid64))
    return res.status(400).json({ ok: false, error: 'steamid64 must be a SteamID64' });
  if (
    message !== undefined &&
    (typeof message !== 'string' || message.length > 128 || hasControlChars(message))
  ) {
    return res.status(400).json({ ok: false, error: 'message: one line, at most 128 characters' });
  }
  const server = await registry.getFleetServer(req.params.id);
  if (!server) return res.status(404).json({ ok: false, error: 'Fleet server not found' });
  if (!fleetBus().isConnected(server.id)) {
    return res
      .status(409)
      .json({ ok: false, errorCode: 'offline', error: 'The Ready Up server is offline' });
  }
  try {
    const outcome = await runFleetCommandOn(
      server.id,
      'kick',
      { steamid64, ...(message ? { message } : {}) },
      issuedBy(req)
    );
    if (!outcome.ok) {
      return res
        .status(outcome.httpStatus)
        .json({ ok: false, errorCode: outcome.errorCode, error: outcome.error ?? 'Kick failed' });
    }
    return res.json({ ok: true });
  } catch (error) {
    log.error(`[FLEET] ${server.id}: kick failed: ${(error as Error).message}`);
    return res.status(500).json({ ok: false, error: 'Kick failed' });
  }
}
