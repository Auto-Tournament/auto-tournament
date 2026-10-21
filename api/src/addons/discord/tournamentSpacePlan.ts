/**
 * When a tournament's space on the Discord server (tournamentSpace.ts) is
 * made and removed, kept apart from the database so it can be checked on its own.
 */

/** How long a finished tournament's space stays. */
export const KEEP_AFTER_S = 3 * 24 * 60 * 60;

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
