/**
 * `openMatchDetails(slug)`: how a game module opens a match
 * (DESIGN-module-client-api.md, decision 7). It opens the match room.
 *
 * Core mounts `MatchDetailsHost` once, near the app root, which registers
 * itself here. A module only asks for a match by slug.
 *
 * This file imports nothing on purpose: the SDK re-exports from it, and
 * importing the router or the registry here would make a cycle through every
 * bundled module.
 */

type MatchDetailsOpener = (slug: string) => Promise<void>;

let opener: MatchDetailsOpener | null = null;

/** Called by `MatchDetailsHost` on mount. Returns the unregister for its cleanup. */
export function registerMatchDetailsOpener(next: MatchDetailsOpener): () => void {
  opener = next;
  return () => {
    if (opener === next) opener = null;
  };
}

/**
 * Open the match room for `slug`. Rejects only when nothing is mounted to open it.
 */
export function openMatchDetails(slug: string): Promise<void> {
  if (!opener) {
    return Promise.reject(new Error('The match opener is not mounted'));
  }
  return opener(slug);
}
