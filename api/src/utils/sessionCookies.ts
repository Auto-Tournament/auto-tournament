import type { IncomingMessage } from 'http';
import { isIP } from 'net';
import type { Untrusted } from './untrusted';

/** The session cookie lives as long as the signed player cookie. */
export const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type HostSource = Partial<Pick<IncomingMessage, 'headers'>> & { hostname?: Untrusted };

/**
 * The lowercase host a request came on, without port or IPv6 brackets. Works on
 * an Express request and on a raw IncomingMessage (the socket handshake).
 */
export function requestHost(req: HostSource): string {
  let host = typeof req.hostname === 'string' ? req.hostname : '';
  if (!host) {
    const header = req.headers?.host;
    host = typeof header === 'string' ? header : '';
    host = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  }
  return host.replace(/^\[|\]$/g, '').toLowerCase();
}

/** Whether a browser on `hostname` would send a cookie with `Domain=domain`. */
export function hostMatchesCookieDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Whether the request gets the host-only session cookie: it came on an IP
 * address or on a host that is not FRONTEND_BASE_URL's (or a subdomain of it),
 * where a cookie for that domain would be dropped by the browser.
 */
export function useHostOnlySession(req: HostSource, cookieDomain: string | undefined): boolean {
  const host = requestHost(req);
  if (!host) return false;
  if (isIP(host) !== 0) return true;
  return !!cookieDomain && !hostMatchesCookieDomain(host, cookieDomain);
}

/**
 * A function that logs `warn` once when an https deployment sees a request as
 * plain http with no X-Forwarded-Proto: its Secure session cookie cannot be set.
 */
export function createInsecureSessionWarner(
  warn: (message: string) => void
): (req: HostSource & { secure?: boolean }, secureExpected: boolean) => void {
  let warned = false;
  return (req, secureExpected) => {
    if (warned || !secureExpected || req.secure === true) return;
    const forwarded = req.headers?.['x-forwarded-proto'];
    const proto = String(Array.isArray(forwarded) ? forwarded[0] : (forwarded ?? ''))
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (proto === 'https') return;
    warned = true;
    warn(
      'FRONTEND_BASE_URL is https but a request arrived as plain http without X-Forwarded-Proto: the Secure session cookie cannot be set and admin sign-in will fail. Make the reverse proxy send X-Forwarded-Proto (for the bundled Caddy: list the proxy in TRUSTED_PROXIES).'
    );
  };
}
