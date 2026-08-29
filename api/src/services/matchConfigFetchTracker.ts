/**
 * Records when a game server actually fetched a match's config JSON.
 *
 * Loading a match is a two-step handshake: MAT sends `matchzy_loadmatch_url`
 * over RCON, and MatchZy then fetches that URL. RCON only tells us the command
 * was delivered - it says nothing about whether the plugin accepted it. MatchZy
 * refuses for several reasons ("a match is already setup", GOTV disabled, a
 * malformed config), and those refusals do not share a common wording, so
 * pattern-matching the RCON reply will always miss cases.
 *
 * The fetch is the one unambiguous signal: if the config was never requested,
 * the plugin did not load the match, whatever the RCON reply said.
 *
 * In-memory on purpose. This only has to answer "did the fetch arrive in the
 * seconds after we sent the load command", so it does not need to survive a
 * restart, and a restart mid-load would fail the load anyway.
 */

const lastFetchBySlug = new Map<string, number>();

/** Slugs are bounded in practice, but do not let a long-lived process grow without limit. */
const MAX_TRACKED_SLUGS = 500;

export const matchConfigFetchTracker = {
  /** Call when the match config JSON has been served to someone. */
  record(slug: string): void {
    if (lastFetchBySlug.size >= MAX_TRACKED_SLUGS && !lastFetchBySlug.has(slug)) {
      // Drop the oldest entry. Map preserves insertion order.
      const oldest = lastFetchBySlug.keys().next();
      if (!oldest.done) lastFetchBySlug.delete(oldest.value);
    }
    lastFetchBySlug.set(slug, Date.now());
  },

  /** Most recent fetch of this slug's config, or null if it has never been fetched. */
  lastFetchedAt(slug: string): number | null {
    return lastFetchBySlug.get(slug) ?? null;
  },

  /**
   * Wait for the config to be fetched after `since`.
   *
   * @returns true if a fetch arrived within the timeout.
   */
  async waitForFetch(slug: string, since: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const fetchedAt = lastFetchBySlug.get(slug);
      if (fetchedAt !== undefined && fetchedAt >= since) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  },

  /** Test seam. */
  reset(): void {
    lastFetchBySlug.clear();
  },
};
