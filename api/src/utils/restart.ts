/**
 * Restarting the platform from the admin UI ("Restart now" on the Modules
 * page, after a module update that waits for a restart).
 *
 * The process cannot start itself again: it shuts down cleanly and exits 0,
 * and its supervisor — Docker's `restart: unless-stopped` in the shipped
 * compose files — brings it back. Without a supervisor an exit is just a
 * stop, so the restart is only offered when one is there: inside the Docker
 * image in production, unless `AT_RESTART_SUPERVISED=false` says otherwise
 * (or `true` vouches for another supervisor, such as systemd).
 */

import fs from 'fs';
import { log } from './logger';

type Shutdown = (reason: string) => void;

let shutdown: Shutdown | null = null;
let restarting = false;

/** The server's graceful shutdown (close HTTP, sockets, pool; exit 0). Set at boot. */
export function registerShutdown(fn: Shutdown): void {
  shutdown = fn;
}

/** Whether a restart can be asked for here, and if not, why. */
export function restartSupport(): { supported: boolean; reason: string | null } {
  const flag = (process.env.AT_RESTART_SUPERVISED ?? '').trim().toLowerCase();
  const manual = 'Restart Auto Tournament yourself (for example `docker compose restart auto-tournament`).';
  if (flag === 'false') {
    return { supported: false, reason: `AT_RESTART_SUPERVISED=false: nothing would bring this server back. ${manual}` };
  }
  if (!shutdown) return { supported: false, reason: `The server is still starting. ${manual}` };
  if (flag === 'true') return { supported: true, reason: null };
  if (process.env.NODE_ENV !== 'production' || !fs.existsSync('/.dockerenv')) {
    return {
      supported: false,
      reason: `This server does not run in the Docker image, so nothing would bring it back. ${manual}`,
    };
  }
  return { supported: true, reason: null };
}

/** Shut down on the next tick (after the 202 went out). False when not supported or already under way. */
export function scheduleRestart(actor: string | null): boolean {
  if (restarting || !restartSupport().supported || !shutdown) return false;
  restarting = true;
  const run = shutdown;
  log.warn(`[SYSTEM] Restart requested${actor ? ` by ${actor}` : ''}; shutting down for the supervisor to start again`);
  setTimeout(() => run('restart requested from the admin UI'), 250);
  return true;
}
