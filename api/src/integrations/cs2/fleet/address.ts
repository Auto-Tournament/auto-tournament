/**
 * The address players `connect` to on a Ready Up fleet server (FLEET.md
 * §6.1, "Connect address").
 *
 * `hello.host.hostname` is the machine's name (`gethostname`, e.g. "cs2") and
 * usually does not resolve for players, so it is never the connect host. In
 * order:
 *
 * 1. The admin's override on the link (`cs2_servers.host_override = 1`;
 *    ./link.ts). Nothing below touches it.
 * 2. `hello.host.public_addr` (fleet.cfg `public_addr`, `+ip`,
 *    `net_public_adr`), unless it is a private / loopback IP while the link's
 *    peer address is public: a server behind NAT reports the address it binds
 *    to, players need the one the platform sees.
 * 3. The WebSocket (or enrollment) peer address, after the reverse proxy hops
 *    the app trusts (`TRUST_PROXY_HOPS`, the same setting as Express's
 *    `trust proxy`). On a LAN a private address is what players use.
 *
 * Pure functions; ./link.ts stores the result on the linked cs2_servers row.
 */

import type { IncomingMessage } from 'http';
import { isIP } from 'net';
import { TRUST_PROXY_HOPS } from '../../../config/trustProxy';
import type { HostInfo } from './protocol/v1';

export const DEFAULT_GAME_PORT = 27015;

export interface ParsedAddr {
  host: string;
  port: number | null;
}

export type ConnectSource = 'override' | 'public_addr' | 'peer';

export interface ConnectAddress {
  host: string;
  port: number;
  source: ConnectSource;
}

function validPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/** A host name or IP literal players can type after `connect` (no scheme, path or spaces). */
export function isValidConnectHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (isIP(host)) return true;
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*\.?$/.test(host);
}

/**
 * "host", "host:port", "[v6]", "[v6]:port" or a bare IPv6 address. null when
 * it is none of those, or a wildcard (0.0.0.0, ::).
 */
export function parseAddr(raw: string | null | undefined): ParsedAddr | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  let host: string;
  let portText: string | null = null;
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(s);
  if (bracket) {
    host = bracket[1];
    portText = bracket[2] ?? null;
    if (isIP(host) !== 6) return null;
  } else if (isIP(s) === 6) {
    host = s;
  } else {
    const m = /^([^:]+)(?::(\d+))?$/.exec(s);
    if (!m) return null;
    host = m[1];
    portText = m[2] ?? null;
  }
  host = unmapV4(host);
  if (!isValidConnectHost(host) || host === '0.0.0.0' || host === '::') return null;
  let port: number | null = null;
  if (portText !== null) {
    port = Number(portText);
    if (!validPort(port)) return null;
  }
  return { host, port };
}

/** "::ffff:1.2.3.4" → "1.2.3.4". */
export function unmapV4(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1] : ip;
}

/**
 * Loopback, RFC 1918, CGNAT, link-local and IPv6 ULA / link-local addresses,
 * and "localhost". Other host names count as public (they are what an admin
 * chose to publish).
 */
export function isPrivateOrLoopback(host: string): boolean {
  const h = unmapV4(host.toLowerCase());
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    return (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (v === 6) {
    return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  return false;
}

/**
 * The client address of an HTTP request (the WebSocket upgrade), the way
 * Express computes `req.ip` with `trust proxy` = `hops`: the socket address,
 * then X-Forwarded-For from right to left, trusting `hops` proxies.
 */
export function peerAddressOf(req: IncomingMessage, hops: number = TRUST_PROXY_HOPS): string | null {
  const socketAddr = req.socket?.remoteAddress ?? null;
  const addrs: string[] = socketAddr ? [socketAddr] : [];
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff.join(',') : xff;
  if (raw && socketAddr) {
    const chain = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .reverse();
    addrs.push(...chain);
  }
  if (addrs.length === 0) return null;
  const pick = addrs[Math.min(Math.max(0, hops), addrs.length - 1)];
  const ip = unmapV4(pick);
  return isIP(ip) ? ip : null;
}

/**
 * Where players connect, from what the server reported (`host`, its hello or
 * enrollment) and the link's peer address. null when neither says anything
 * usable (never the machine's hostname).
 */
export function chooseConnectAddress(
  host: Pick<HostInfo, 'public_addr' | 'game_port'> | null | undefined,
  peerAddr: string | null | undefined
): ConnectAddress | null {
  const reported = parseAddr(host?.public_addr);
  const peerIp = peerAddr ? unmapV4(peerAddr.trim()) : '';
  const peer = peerIp && isIP(peerIp) && peerIp !== '0.0.0.0' && peerIp !== '::' ? peerIp : null;
  const gamePort = host?.game_port && validPort(host.game_port) ? host.game_port : DEFAULT_GAME_PORT;
  const port = reported?.port ?? gamePort;
  if (reported) {
    if (peer && isPrivateOrLoopback(reported.host) && !isPrivateOrLoopback(peer)) {
      return { host: peer, port, source: 'peer' };
    }
    return { host: reported.host, port, source: 'public_addr' };
  }
  if (peer) return { host: peer, port, source: 'peer' };
  return null;
}

/** `host:port` for `connect` (IPv6 in brackets). */
export function formatConnectAddress(host: string, port: number): string {
  return `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}
