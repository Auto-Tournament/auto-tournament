/**
 * Which address a player connects to: the server's LAN address or its machine's public one.
 *
 * At a LAN party the players sit on the server's network, where the public address only
 * works if the router loops traffic back in (often it does not, or adds lag). The platform
 * sees each player's public IP: when it is the machine's public address (the venue's one
 * address), or a private one (the platform itself runs on that LAN), the player is on the
 * server's network and gets the LAN address. Everyone else gets the public one. Both are
 * listed, so a player can pick the other.
 *
 * Behind Cloudflare that guess can miss: at NTLAN (2026-10-16) players at the venue reached the
 * site by another address (IPv6, most likely) and were told to use the public one, whose new
 * ports the router did not forward. The `connect_prefer_lan` site setting skips the guess: LAN
 * for everyone. And it misses when the venue's internet goes out another way than the
 * servers' (a tunnel). So it also learns: when a player's game client joins from the
 * machine's LAN (Ready Up reports the address), the web address they used the site from is
 * remembered for that machine (cs2_lan_networks), and everyone coming from it is recommended
 * the LAN address from then on.
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
import { settingsService } from '../../../services/settingsService';

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

/** How long a learned network counts. */
const LEARNED_FOR_S = 30 * 24 * 60 * 60;
/** How long a player's web address is kept to pair with their client joining. */
const VIEWER_FOR_MS = 2 * 60 * 60 * 1000;
const viewers = new Map<string, { ip: string; at: number }>();

/** A player looked at their match's connect panel from this web address (the join comes next). */
export function noteViewerIp(
  steamId: string | null | undefined,
  ip: string | null | undefined
): void {
  if (steamId && ip) viewers.set(steamId, { ip: bare(ip), at: Date.now() });
}

/** On one LAN (pure): the same IPv4 /24 as the machine's own address. */
export function sameLan(clientIp: string, machineIp: string): boolean {
  const a = bare(clientIp).split('.');
  const b = bare(machineIp).split('.');
  // shortcut: a /24 stands for the LAN; a venue on a wider subnet is learned only for its /24s.
  return a.length === 4 && b.length === 4 && a.slice(0, 3).join('.') === b.slice(0, 3).join('.');
}

/**
 * A player's client joined a fleet server from `address`: when that is the machine's LAN, the
 * web address they used the site from (noteViewerIp) reaches the machine over LAN.
 */
export async function learnFromJoin(
  fleetServerId: string,
  steamId: string,
  address: string | undefined
): Promise<void> {
  const viewer = viewers.get(steamId);
  if (!address || !viewer || Date.now() - viewer.at > VIEWER_FOR_MS) return;
  const fleet = await getFleetServer(fleetServerId);
  if (!fleet) return;
  const [machines, publics] = await Promise.all([machineAddresses(), machinePublicAddresses()]);
  const lan = detectedAddress(fleet, machineAddressOf(machines, fleet));
  const publicHost = machineAddressOf(publics, fleet);
  if (!lan || !publicHost || !sameLan(address, lan.host)) return;
  await db.runAsync(
    `INSERT INTO cs2_lan_networks (public_host, web_ip, learned_at) VALUES (?, ?, ?)
     ON CONFLICT (public_host, web_ip) DO UPDATE SET learned_at = EXCLUDED.learned_at`,
    [publicHost, viewer.ip, Math.floor(Date.now() / 1000)]
  );
}

/** This web address was seen reaching the machine (by its public host) over LAN lately. */
async function learnedLan(
  publicHost: string,
  viewerIp: string | null | undefined
): Promise<boolean> {
  if (!viewerIp) return false;
  const row = await db
    .queryOneAsync<{ n: number }>(
      'SELECT 1 AS n FROM cs2_lan_networks WHERE public_host = ? AND web_ip = ? AND learned_at > ?',
      [publicHost, bare(viewerIp), Math.floor(Date.now() / 1000) - LEARNED_FOR_S]
    )
    .catch(() => null);
  return !!row;
}

/**
 * The LAN and public addresses of a match's server (when it has both and they differ), and
 * which one this viewer should use. Null when there is no choice to make.
 */
export async function connectChoice(
  cs2ServerId: string,
  viewerIp: string | null | undefined,
  /** The tournament's choice (settings.cs2.connectVia): one address only, or 'auto'. */
  mode: 'auto' | 'lan' | 'public' = 'auto'
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
  // The organizer decided: everyone gets that one address.
  if (mode !== 'auto') {
    return { options: options.filter((o) => o.kind === mode), recommended: mode };
  }
  const preferLan =
    (await settingsService.getSetting('connect_prefer_lan').catch(() => null)) === '1';
  return {
    options,
    recommended:
      preferLan ||
      (await onServerNetwork(viewerIp, publicHost)) ||
      (await learnedLan(publicHost, viewerIp))
        ? 'lan'
        : 'public',
  };
}
