/**
 * `openMatchDetails(slug)`: how a game module opens the match details dialog
 * (DESIGN-module-client-api.md, decision 7).
 *
 * Core owns the dialog and mounts it once, near the app root
 * (`MatchDetailsHost`), which registers itself here. A module only asks for a
 * match by slug; `MatchDetailsModal`'s props are not public API.
 *
 * This file imports nothing on purpose: the SDK re-exports from it, and
 * pulling the 1,400-line dialog (which reads the integration registry) into
 * the SDK's import graph would make a cycle through every bundled module.
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
 * Open the match details dialog for `slug`.
 *
 * Resolves once the match is loaded and the dialog is showing; rejects when
 * the match cannot be loaded, so the caller can say why in its own words.
 */
export function openMatchDetails(slug: string): Promise<void> {
  if (!opener) {
    return Promise.reject(new Error('The match details dialog is not mounted'));
  }
  return opener(slug);
}
