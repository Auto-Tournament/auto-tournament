/**
 * How many reverse proxies (Cloudflare Tunnel, nginx, Caddy, ...) in front of
 * the API are trusted for X-Forwarded-*: Express's `trust proxy` (index.ts)
 * and the fleet gateway's peer address (integrations/cs2/fleet/address.ts),
 * which sees the raw WebSocket upgrade rather than an Express request.
 * `TRUST_PROXY_HOPS` (a whole number, default 1).
 */
export function trustProxyHopsFrom(raw: string | undefined): number {
  const value = raw?.trim() ?? '';
  if (!/^\d+$/.test(value)) return 1;
  return Number(value);
}

export const TRUST_PROXY_HOPS = trustProxyHopsFrom(process.env.TRUST_PROXY_HOPS);
