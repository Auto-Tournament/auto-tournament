/**
 * Which browser origins may open a Socket.IO connection. With neither
 * FRONTEND_BASE_URL nor CORS_ORIGIN set (or CORS_ORIGIN=*), any. Otherwise a
 * handshake that carries an Origin must come from one of those, or from the
 * host the request was made to (LAN or IP access). No Origin at all is a
 * non-browser client and passes.
 */

type Headers = { host?: string; 'x-forwarded-host'?: string | string[] };

function originOf(url: string): string | null {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return u.origin === 'null' ? null : u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** The configured browser origins, or null when any origin is allowed. */
export function configuredSocketOrigins(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const cors = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (cors.includes('*')) return null;
  const list = [env.FRONTEND_BASE_URL?.trim() ?? '', ...cors]
    .filter(Boolean)
    .map(originOf)
    .filter((o): o is string => !!o);
  return list.length > 0 ? [...new Set(list)] : null;
}

export function socketOriginAllowed(
  origin: string | undefined,
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const allowed = configuredSocketOrigins(env);
  if (!allowed) return true;
  if (origin === undefined || origin === '') return true;
  const o = originOf(origin);
  if (!o || !origin.includes('://')) return false;
  if (allowed.includes(o)) return true;
  const host = new URL(o).host;
  const forwarded = headers['x-forwarded-host'];
  const hosts = [headers.host, ...(Array.isArray(forwarded) ? forwarded : [forwarded])]
    .flatMap((h) => (h ?? '').split(','))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.includes(host);
}
