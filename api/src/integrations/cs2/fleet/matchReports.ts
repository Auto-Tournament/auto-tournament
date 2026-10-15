/**
 * The last match each fleet server reported (a state.patch or state.snapshot naming it), with
 * the time. failover.ts reads it after a server comes back: Ready Up says hello before it
 * restores a match it kept locally, and reports the match a moment later.
 */

const lastReport = new Map<string, { slug: string; atMs: number }>();

export function noteMatchReport(serverId: string, slug: string | null | undefined): void {
  if (slug) lastReport.set(serverId, { slug, atMs: Date.now() });
}

/** The server reported `slug` at or after `sinceMs`. */
export function reportedSince(serverId: string, slug: string, sinceMs: number): boolean {
  const r = lastReport.get(serverId);
  return !!r && r.slug === slug && r.atMs >= sinceMs;
}
