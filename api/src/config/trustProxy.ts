/**
 * How many reverse proxies (Cloudflare Tunnel, nginx, Caddy, ...) in front of
 * the API are trusted for X-Forwarded-*: Express's `trust proxy` (index.ts)
 * and the fleet gateway's peer address (integrations/cs2/fleet/address.ts),
 * which sees the raw WebSocket upgrade rather than an Express request.
 */
export const TRUST_PROXY_HOPS = 1;
