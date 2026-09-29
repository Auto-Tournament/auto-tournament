/**
 * "Something about this match may have changed."
 *
 * A signal, not an event: listeners re-read the match themselves. It is raised
 * from the two places every match change already passes through — the socket
 * broadcast (`emitMatchUpdate`) and the live score (`matchLiveStatsService`) —
 * so a listener sees every path (RCON events, fleet events, admin actions,
 * allocation) without each of them having to know it exists.
 *
 * The integrator webhooks (services/webhooks) listen here. Kept dependency
 * free so the socket service and the live stats service can import it without
 * a cycle.
 */

export interface MatchChangeRef {
  slug?: string | null;
  id?: number | null;
  /** The match row is gone (`emitMatchUpdate({ slug, deleted: true })`). */
  deleted?: boolean;
}

type Listener = (ref: MatchChangeRef) => void;

const listeners = new Set<Listener>();

export function onMatchChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function matchChanged(ref: MatchChangeRef): void {
  if (!ref.slug && (ref.id === undefined || ref.id === null)) return;
  for (const listener of listeners) {
    try {
      listener(ref);
    } catch {
      // A listener's failure is its own; the broadcast carries on.
    }
  }
}
