/**
 * A match config as people who are not admins may see it: without
 * `cvars.tv_password`, the match's GOTV password (integrations/cs2/gotv.ts),
 * which only viewers allowed to watch get (GET /api/events/watch/:slug).
 * Admins keep it, and so does the config a server loads.
 */
export function withoutConfigSecrets<T>(config: T): T {
  if (!config || typeof config !== 'object') return config;
  const cvars = (config as { cvars?: unknown }).cvars;
  if (!cvars || typeof cvars !== 'object' || !('tv_password' in cvars)) return config;
  const rest: Record<string, unknown> = { ...(cvars as Record<string, unknown>) };
  delete rest.tv_password;
  return { ...config, cvars: rest };
}
