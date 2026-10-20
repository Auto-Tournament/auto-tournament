/**
 * When a tournament's space on the Discord server (tournamentSpace.ts) is
 * made and removed, and its channel's name, kept apart from the database so
 * they can be checked on their own.
 */

/** How long a finished tournament's space stays. */
export const KEEP_AFTER_S = 3 * 24 * 60 * 60;

// Letters NFKD does not split into a base letter and an accent.
const LETTERS: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe' };

/** "Winter LAN 2026!" -> "winter-lan-2026": a text channel's name (pure). */
export function channelSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[øæœ]/g, (c) => LETTERS[c] ?? c)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return slug || 'tournament';
}

/** Which spaces to make, keep and remove now (pure): running and recently finished stay. */
export function spacePlan(
  tournaments: Array<{ id: number; status: string; completedAt: number | null }>,
  spaces: number[],
  now: number
): { make: number[]; remove: number[] } {
  const keep = new Set(
    tournaments
      .filter(
        (t) =>
          t.status === 'in_progress' ||
          (t.status === 'completed' && (t.completedAt ?? now) > now - KEEP_AFTER_S)
      )
      .map((t) => t.id)
  );
  const running = tournaments.filter((t) => t.status === 'in_progress').map((t) => t.id);
  return {
    make: running.filter((id) => !spaces.includes(id)),
    remove: spaces.filter((id) => !keep.has(id)),
  };
}
