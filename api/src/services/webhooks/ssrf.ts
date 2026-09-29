/**
 * SSRF protection for webhook target URLs.
 *
 * A webhook URL is typed by an admin, but the request is made by the platform
 * from inside its network, so a URL pointing at 127.0.0.1, the Docker network
 * or a cloud metadata endpoint would turn the webhook feature into a way to
 * reach those. So:
 *
 * - only http(s), no user:password@ in the URL;
 * - the host is resolved at delivery time, every address it resolves to is
 *   checked, and the request goes to the checked address (the socket's
 *   `lookup` is pinned to it), so DNS rebinding between check and connect
 *   does not help;
 * - public addresses are always allowed. Private ranges (RFC 1918, CGNAT,
 *   IPv6 ULA) and loopback only with the admin setting "Allow webhooks to
 *   private and local addresses" (`webhooks_allow_private_targets`), which a
 *   LAN event needs when its website runs on the LAN;
 * - link-local (169.254.0.0/16 — cloud metadata lives there — and fe80::/10),
 *   multicast, unspecified and reserved ranges are never allowed.
 *
 * Only the webhook *target* is checked. Addresses inside the payload (a LAN
 * game server's IP in `connect`) are data and are sent as they are.
 */

import dns from 'dns';
import net from 'net';

export type AddressClass = 'public' | 'private' | 'loopback' | 'link_local' | 'reserved';

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inV4(ip: number, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

function classifyV4(ip: string): AddressClass {
  const n = ipv4ToInt(ip);
  if (inV4(n, '127.0.0.0/8')) return 'loopback';
  if (inV4(n, '169.254.0.0/16')) return 'link_local';
  if (inV4(n, '10.0.0.0/8') || inV4(n, '172.16.0.0/12') || inV4(n, '192.168.0.0/16')) return 'private';
  if (inV4(n, '100.64.0.0/10')) return 'private'; // CGNAT
  if (inV4(n, '198.18.0.0/15')) return 'private'; // benchmarking, used on some LANs
  if (
    inV4(n, '0.0.0.0/8') ||
    inV4(n, '192.0.0.0/24') ||
    inV4(n, '192.0.2.0/24') ||
    inV4(n, '198.51.100.0/24') ||
    inV4(n, '203.0.113.0/24') ||
    inV4(n, '224.0.0.0/4') ||
    inV4(n, '240.0.0.0/4')
  ) {
    return 'reserved';
  }
  return 'public';
}

/** Expand an IPv6 literal to its 8 groups. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // Embedded IPv4 tail (::ffff:1.2.3.4).
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const n = ipv4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) =>
    parseInt(g, 16)
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function classifyV6(ip: string): AddressClass {
  const g = ipv6Groups(ip);
  if (!g) return 'reserved';
  const allZeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible): the IPv4 rules apply.
  if (allZeroUpTo(5) && (g[5] === 0xffff || (g[5] === 0 && (g[6] !== 0 || g[7] > 1)))) {
    return classifyV4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }
  // 64:ff9b::/96 NAT64: the embedded IPv4 address decides.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return classifyV4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }
  if (allZeroUpTo(7) && g[7] === 1) return 'loopback';
  if (allZeroUpTo(8)) return 'reserved';
  if ((g[0] & 0xffc0) === 0xfe80) return 'link_local';
  if ((g[0] & 0xfe00) === 0xfc00) return 'private';
  if ((g[0] & 0xff00) === 0xff00) return 'reserved'; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return 'reserved'; // documentation
  return 'public';
}

export function classifyAddress(ip: string): AddressClass {
  if (net.isIPv4(ip)) return classifyV4(ip);
  if (net.isIPv6(ip)) return classifyV6(ip);
  return 'reserved';
}

export function isAddressAllowed(cls: AddressClass, allowPrivate: boolean): boolean {
  if (cls === 'public') return true;
  if (cls === 'private' || cls === 'loopback') return allowPrivate;
  return false;
}

export class WebhookTargetError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_url' | 'blocked_address' | 'dns_failed'
  ) {
    super(message);
    this.name = 'WebhookTargetError';
  }
}

const PRIVATE_HINT =
  'Private and local addresses are blocked unless "Allow webhooks to private and local addresses" is on in Settings → Webhooks (for LAN events).';

/**
 * Syntax and literal-address checks, no DNS. Throws WebhookTargetError.
 * Returns the parsed URL.
 */
export function checkWebhookUrlSyntax(raw: unknown, allowPrivate: boolean): URL {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new WebhookTargetError('url is required', 'invalid_url');
  }
  const value = raw.trim();
  if (value.length > 2048) throw new WebhookTargetError('url is longer than 2048 characters', 'invalid_url');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebhookTargetError('url is not a valid absolute URL', 'invalid_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WebhookTargetError('url must be http:// or https://', 'invalid_url');
  }
  if (url.username || url.password) {
    throw new WebhookTargetError('url must not contain a user name or password', 'invalid_url');
  }
  const host = hostOf(url);
  if (!host) throw new WebhookTargetError('url has no host', 'invalid_url');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!allowPrivate) throw new WebhookTargetError(`${host} is a local address. ${PRIVATE_HINT}`, 'blocked_address');
  } else if (net.isIP(host)) {
    const cls = classifyAddress(host);
    if (!isAddressAllowed(cls, allowPrivate)) {
      throw new WebhookTargetError(
        cls === 'private' || cls === 'loopback'
          ? `${host} is a ${cls} address. ${PRIVATE_HINT}`
          : `${host} is a ${cls.replace('_', '-')} address and is never allowed as a webhook target`,
        'blocked_address'
      );
    }
  }
  return url;
}

/** The URL's host without IPv6 brackets. */
export function hostOf(url: URL): string {
  const h = url.hostname;
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

export interface ResolvedTarget {
  address: string;
  family: 4 | 6;
}

export type Lookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: Lookup = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/**
 * Resolve the URL's host and check every address. Returns the address to
 * connect to. Throws WebhookTargetError.
 */
export async function resolveWebhookTarget(
  url: URL,
  allowPrivate: boolean,
  lookup: Lookup = defaultLookup
): Promise<ResolvedTarget> {
  const host = hostOf(url);
  checkWebhookUrlSyntax(url.toString(), allowPrivate);
  if (net.isIP(host)) {
    return { address: host, family: net.isIPv6(host) ? 6 : 4 };
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host);
  } catch (error) {
    throw new WebhookTargetError(
      `could not resolve ${host}: ${error instanceof Error ? error.message : String(error)}`,
      'dns_failed'
    );
  }
  if (addresses.length === 0) throw new WebhookTargetError(`${host} did not resolve`, 'dns_failed');
  for (const a of addresses) {
    const cls = classifyAddress(a.address);
    if (!isAddressAllowed(cls, allowPrivate)) {
      throw new WebhookTargetError(
        cls === 'private' || cls === 'loopback'
          ? `${host} resolves to ${a.address}, a ${cls} address. ${PRIVATE_HINT}`
          : `${host} resolves to ${a.address}, a ${cls.replace('_', '-')} address, which is never allowed`,
        'blocked_address'
      );
    }
  }
  const first = addresses[0];
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}
