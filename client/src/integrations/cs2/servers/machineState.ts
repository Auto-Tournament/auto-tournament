/**
 * What the Servers page shows of a machine and its servers, derived from
 * `GET /api/fleet/hosts`: a state per server (a command for it that csm is
 * still running wins over what the inventory last said), the machine's
 * running command, and its latest problem worth a "Try again".
 */
import type { FleetHost, FleetHostCommand, FleetHostServer } from '../cs2.types';

export type ServerTileState =
  | 'deleting'
  | 'starting'
  | 'stopping'
  | 'restarting'
  | 'updating'
  | 'match'
  | 'free'
  | 'stopped'
  | 'offline';

const pending = (c: FleetHostCommand) => c.status === 'pending';
const targets = (c: FleetHostCommand, server: string) =>
  c.server === server || c.payload.server === server;
/** A host update covers the servers it names, or every server when it names none. */
const updateCovers = (c: FleetHostCommand, server: string) => {
  if (c.type !== 'host.update_game' && c.type !== 'host.update_plugins') return false;
  const list = c.payload.servers;
  return Array.isArray(list) ? list.includes(server) : true;
};

export function serverState(
  host: FleetHost,
  s: FleetHostServer,
  deletingHere: boolean
): ServerTileState {
  if (deletingHere) return 'deleting';
  const running = host.commands.filter(pending);
  const own = running.find((c) => targets(c, s.name));
  if (own?.type === 'server.remove') return 'deleting';
  if (own?.type === 'server.start') return 'starting';
  if (own?.type === 'server.stop') return 'stopping';
  if (own?.type === 'server.restart') return 'restarting';
  if (!host.online) return 'offline';
  if (s.matchInProgress) return 'match';
  if (running.some((c) => updateCovers(c, s.name))) return 'updating';
  return s.process.running ? 'free' : 'stopped';
}

/** The machine's command csm is working on (the newest), if any. */
export function activeCommand(host: FleetHost): FleetHostCommand | null {
  return host.commands.find(pending) ?? null;
}

const PROBLEM_WINDOW_S = 30 * 60;

/**
 * The newest command that failed or was refused in the last half hour, unless
 * the same kind of command was sent again after it.
 */
export function latestProblem(host: FleetHost, nowS = Date.now() / 1000): FleetHostCommand | null {
  // host.commands is newest first.
  for (let i = 0; i < host.commands.length; i++) {
    const c = host.commands[i];
    if (c.status !== 'failed' && c.status !== 'rejected') continue;
    if ((c.answeredAt ?? c.createdAt) < nowS - PROBLEM_WINDOW_S) return null;
    const retried = host.commands
      .slice(0, i)
      .some((later) => later.type === c.type && (later.server ?? null) === (c.server ?? null));
    return retried ? null : c;
  }
  return null;
}

export interface ServerCounts {
  free: number;
  match: number;
  busy: number;
  down: number;
}

/** The page's summary: free, in a match, being changed, and stopped or offline. */
export function countServers(
  hosts: FleetHost[],
  isDeleting: (h: FleetHost, s: string) => boolean
): ServerCounts {
  const counts: ServerCounts = { free: 0, match: 0, busy: 0, down: 0 };
  for (const host of hosts) {
    if (host.status !== 'enrolled') continue;
    for (const s of host.servers) {
      const state = serverState(host, s, isDeleting(host, s.name));
      if (state === 'free') counts.free += 1;
      else if (state === 'match') counts.match += 1;
      else if (state === 'stopped' || state === 'offline') counts.down += 1;
      else counts.busy += 1;
    }
  }
  return counts;
}
