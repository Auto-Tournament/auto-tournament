/**
 * Skin tryout servers: Ready Up servers on the Skin tryout plugin set
 * (movement + skins on a surf map, no match plugin), where a player tries the skins they
 * equipped here. Equipping on the site reaches them in game at once (the
 * live loadout push), so the inventory links to whichever is online.
 */
import { getFleetServer, listFleetServers } from '../fleet/registry';
import {
  detectedAddress,
  listLinkAddresses,
  machineAddresses,
  machineAddressOf,
} from '../fleet/link';
import { connectIp } from '../routes/matchConnect';

export interface TryoutServer {
  name: string;
  /** For the console: `connect host:port`. */
  address: string;
  /** For the steam://connect/ link (an IP; CS2 ignores a host name there). */
  connectIp: string | null;
  port: number;
}

/** A server runs `plugin` when it is installed and not disabled (hello.plugins_state). */
function runs(state: { installed: string[]; disabled: string[] } | null, plugin: string): boolean {
  return !!state && state.installed.includes(plugin) && !state.disabled.includes(plugin);
}

/** Online tryout servers, by name. */
export async function tryoutServers(): Promise<TryoutServer[]> {
  const [servers, links, machines] = await Promise.all([
    listFleetServers(),
    listLinkAddresses(),
    machineAddresses(),
  ]);
  const out: TryoutServer[] = [];
  for (const s of servers) {
    if (!s.online || s.status === 'revoked') continue;
    if (!runs(s.pluginsState, 'skins')) continue;
    // Movement (the Skin tryout set) or practice (tryout servers before it).
    if (!runs(s.pluginsState, 'movement') && !runs(s.pluginsState, 'practice')) continue;
    // A server with the match plugin on takes matches: not a tryout server.
    if (runs(s.pluginsState, 'match')) continue;
    // Not in the match pool, so usually not linked: where it was seen
    // (its own address, the machine's, the peer), as the Servers page shows.
    const link = links.get(s.id);
    let host = link?.host || null;
    let port = link?.port ?? 0;
    if (!host) {
      const row = await getFleetServer(s.id);
      const found = row
        ? detectedAddress(
            row,
            machineAddressOf(machines, { id: row.id, install_id: row.install_id })
          )
        : null;
      if (!found) continue;
      host = found.host;
      port = found.port;
    }
    out.push({
      name: s.name,
      address: `${host}:${port}`,
      connectIp: await connectIp(host),
      port,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
