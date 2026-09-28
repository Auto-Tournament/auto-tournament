/**
 * "Who is an admin may have changed": a signal from the player service to
 * whoever mirrors the admin list elsewhere (CS2's Ready Up fleet pushes it to
 * every game server as `admins.set`).
 *
 * Core cannot import an integration, so the integration subscribes here. The
 * signal is a hint, not a diff: listeners re-read the list themselves, and
 * may be called for changes that turn out not to matter (a renamed
 * non-admin). Listeners must not throw; a failure is logged and ignored.
 */

import { log } from '../utils/logger';

type Listener = () => void | Promise<void>;

const listeners = new Set<Listener>();

export function onAdminListMaybeChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyAdminListMaybeChanged(): void {
  for (const listener of listeners) {
    try {
      const result = listener();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error: unknown) => {
          log.warn(`[Admins] admin list listener failed: ${(error as Error).message}`);
        });
      }
    } catch (error) {
      log.warn(`[Admins] admin list listener failed: ${(error as Error).message}`);
    }
  }
}
