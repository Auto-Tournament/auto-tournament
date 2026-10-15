/**
 * Which address a player connects to: the server's LAN address or its machine's public one.
 *
 * At a LAN party the players sit on the server's network, where the public address only
 * works if the router loops traffic back in (often it does not, or adds lag). The platform
 * sees each player's public IP: when it is the machine's public address (the venue's one
 * address), or a private one (the platform itself runs on that LAN), the player is on the
 * server's network and gets the LAN address. Everyone else gets the public one. Both are
 * listed, so a player can pick the other.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { db } from '../../../config/database';
import {
  detectedAddress,
  machineAddresses,
  machineAddressOf,
  machinePublicAddresses,
} from './link';
import { getFleetServer } from './registry';

export interface ConnectOption {
  kind: 'lan' | 'public';
  host: string;
  port: number;
}

/** RFC 1918, carrier-grade NAT, loopback and link-local IPv4; ULA and link-local IPv6. */
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254)
    );
  }
  const lower = ip.toLowerCase();
  return (
    lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')
  );
}

const bare = (ip: string) => (ip.startsWith('::ffff:') ? ip.slice(7) : ip);

async function resolveAll(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    const found = await Promise.race([lookup(host, { all: true }), timeout]);
    return found ? found.map((f) => f.address) : [];
  } catch {
    return [];
  }
}

/**
 * The viewer is on the server's network: their address is private, or one of the addresses
 * the machine's public host resolves to (the same NAT).
 */
export async function onServerNetwork(
  viewerIp: string | null | undefined,
  publicHost: string | null
): Promise<boolean> {
  if (!viewerIp) return false;
  const ip = bare(viewerIp);
  if (isPrivateIp(ip)) return true;
  if (!publicHost) return false;
  return (await resolveAll(publicHost)).some((a) => bare(a) === ip);
}

/**
 * The LAN and public addresses of a match's server (when it has both and they differ), and
 * which one this viewer should use. Null when there is no choice to make.
 */
export async function connectChoice(
  cs2ServerId: string,
  viewerIp: string | null | undefined
): Promise<{ options: ConnectOption[]; recommended: 'lan' | 'public' } | null> {
  const row = await db.queryOneAsync<{ fleet_server_id: string | null }>(
    'SELECT fleet_server_id FROM cs2_servers WHERE id = ?',
    [cs2ServerId]
  );
  const fleet = await getFleetServer(row?.fleet_server_id ?? cs2ServerId);
  if (!fleet) return null;
  const [machines, publics] = await Promise.all([machineAddresses(), machinePublicAddresses()]);
  const lan = detectedAddress(fleet, machineAddressOf(machines, fleet));
  const publicHost = machineAddressOf(publics, fleet);
  if (!lan || !publicHost || lan.host === publicHost) return null;
  const options: ConnectOption[] = [
    { kind: 'lan', host: lan.host, port: lan.port },
    { kind: 'public', host: publicHost, port: lan.port },
  ];
  return {
    options,
    recommended: (await onServerNetwork(viewerIp, publicHost)) ? 'lan' : 'public',
  };
}
