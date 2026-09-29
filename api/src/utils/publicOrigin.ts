import type { Request } from 'express';

/**
 * The origin (scheme://host[:port]) the platform is reached at, for absolute
 * URLs handed to other machines: the fleet enrollment `ws_url`, the
 * `csm link <url>` command, match config links.
 *
 * In order:
 *  1. `FRONTEND_BASE_URL`, when it is set to something other than a loopback
 *     address. It is the admin's own statement of where the site lives, so it
 *     beats anything inferred from the request. The Docker compose file
 *     defaults it to `http://localhost:3069`, which is useless to another
 *     machine, so a loopback value is ignored.
 *  2. The request: `req.protocol` (honours `X-Forwarded-Proto` from the
 *     proxy hop Express trusts, config/trustProxy.ts) and its Host header.
 *     Behind a TLS proxy this is only right if every hop passes
 *     `X-Forwarded-Proto: https` through — the in-container Caddy does for
 *     private-range peers (docker/Caddyfile `trusted_proxies`).
 */
export function configuredPublicOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.FRONTEND_BASE_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (isLoopbackHost(url.hostname)) return null;
  return url.origin;
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    h === '0.0.0.0' ||
    /^127\./.test(h)
  );
}

/** Where the request says the platform is: scheme from `req.protocol`, host from Host. */
export function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

/** The public origin, `http(s)://host[:port]`. */
export function publicOrigin(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  return configuredPublicOrigin(env) ?? requestOrigin(req);
}

/** The public origin as a WebSocket origin: https → wss, http → ws. */
export function publicWsOrigin(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  return publicOrigin(req, env).replace(/^http/, 'ws');
}
