/**
 * Every server once, grouped by the machine that runs it. A machine server
 * linked to Ready Up is one row on its machine; Ready Up servers on no
 * machine make the No machine group.
 */
import type { FleetHost, FleetHostServer, FleetServer } from '../../cs2.types';

export type ServerRow =
  | {
      kind: 'machine';
      key: `m:${string}:${string}`;
      host: FleetHost;
      server: FleetHostServer;
      fleet: FleetServer | null;
    }
  | { kind: 'readyup'; key: `r:${string}`; fleet: FleetServer };

export interface ServerGroup {
  key: string;
  /** null: the No machine group. */
  host: FleetHost | null;
  rows: ServerRow[];
}

/** Online machines first; then the ones waiting to be linked, the offline ones, the revoked. */
function hostRank(host: FleetHost): number {
  if (host.status === 'enrolled') return host.online ? 0 : 2;
  return host.status === 'pending' ? 1 : 3;
}

/** The address players use was guessed from where the server connects. */
export function isGuessedAddress(server: FleetServer): boolean {
  return server.connect?.source === 'peer';
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export function buildServerGroups(hosts: FleetHost[], fleet: FleetServer[]): ServerGroup[] {
  const fleetById = new Map(fleet.map((f) => [f.id, f]));
  const onMachines = new Set<string>();
  const groups: ServerGroup[] = [...hosts]
    .sort((a, b) => hostRank(a) - hostRank(b) || byName(a, b))
    .map((host) => ({
      key: host.id,
      host,
      rows: host.servers.map((server) => {
        const id = server.fleetServer?.id;
        if (id) onMachines.add(id);
        return {
          kind: 'machine' as const,
          key: `m:${host.id}:${server.name}` as const,
          host,
          server,
          fleet: (id && fleetById.get(id)) || null,
        };
      }),
    }));

  const readyUp = fleet
    .filter((f) => !onMachines.has(f.id))
    .sort((a, b) => Number(a.status === 'revoked') - Number(b.status === 'revoked') || byName(a, b))
    .map((f) => ({ kind: 'readyup' as const, key: `r:${f.id}` as const, fleet: f }));
  if (readyUp.length > 0) groups.push({ key: 'none', host: null, rows: readyUp });
  return groups;
}

/** The id the allocation status knows a row's server by, to find its match. */
export function rowMatchKey(row: ServerRow): string | null {
  if (row.kind === 'readyup') return row.fleet.linkedServerId ?? row.fleet.id;
  return row.fleet?.linkedServerId ?? row.server.fleetServer?.id ?? null;
}
