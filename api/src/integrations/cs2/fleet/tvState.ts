/**
 * GOTV state of each fleet server, as Ready Up's tv plugin reports it
 * (`tv.v1`): `hello.tv` on every connect, `state.snapshot.tv`, and
 * `server.tv` when it changes (at most every 5 s). Kept in memory: a restart
 * of the platform drops the sockets, and every reconnect sends a hello.
 * The admin match page shows it (routes/manageMatch.ts). Never the password.
 */
import type { TvState } from './protocol/v1';
import { registerInboundHandler } from './inbound';

const states = new Map<string, { tv: TvState; at: number }>();

export function setTvState(fleetServerId: string, tv: TvState | undefined | null): void {
  if (tv && typeof tv === 'object') states.set(fleetServerId, { tv, at: Date.now() });
}

export function getTvState(fleetServerId: string): { tv: TvState; at: number } | null {
  return states.get(fleetServerId) ?? null;
}

let unregister: (() => void) | null = null;

export function startTvState(): void {
  if (unregister) return;
  unregister = registerInboundHandler('server.tv', {
    // Checked against the server.tv schema by the gateway first.
    handle: async (ctx, env) => setTvState(ctx.serverId, env.payload as TvState),
  });
}

export function stopTvState(): void {
  unregister?.();
  unregister = null;
}
