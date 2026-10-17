/**
 * A match config as people who are not admins may see it. GOTV is public
 * (anyone can watch, with a delay), so its password (`cvars.tv_password`,
 * integrations/cs2/gotv.ts) stays, except when the match broadcasts with no
 * delay (`tv_delay` 0): then a viewer could ghost for a team, and only admins
 * and the config a server loads get it.
 */
export function withoutConfigSecrets<T>(config: T): T {
  if (!config || typeof config !== 'object') return config;
  const cvars = (config as { cvars?: unknown }).cvars;
  if (!cvars || typeof cvars !== 'object' || !('tv_password' in cvars)) return config;
  if (!liveGotv(cvars as Record<string, unknown>)) return config;
  const rest: Record<string, unknown> = { ...(cvars as Record<string, unknown>) };
  delete rest.tv_password;
  return { ...config, cvars: rest };
}

/** GOTV with no delay: `tv_delay` set to 0. Absent is the server's own delay (105). */
export function liveGotv(cvars: Record<string, unknown> | undefined): boolean {
  const delay = cvars?.tv_delay;
  return delay !== undefined && delay !== null && delay !== '' && Number(delay) === 0;
}
