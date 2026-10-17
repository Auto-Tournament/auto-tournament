/**
 * The name a match notice carries ("Alpha vs Bravo"). A match whose teams are
 * not known yet (a later Swiss round, a final waiting on its semis) has none:
 * nothing is announced for it, and a notice that was stored with "TBD" in it
 * is filled from the match as it is now, or hidden while it still has no teams.
 */

/** A stored name with a placeholder side in it ("TBD vs TBD", "Alpha vs TBD"). */
export function hasTbdSide(name: unknown): boolean {
  return typeof name === 'string' && /(^|\s)TBD(\s|$)/i.test(name);
}

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s && !/^TBD$/i.test(s) ? s : null;
};

/** "A vs B" once both teams are known, else null. */
export function matchNoticeName(
  team1: string | null | undefined,
  team2: string | null | undefined
): string | null {
  const a = clean(team1);
  const b = clean(team2);
  return a && b ? `${a} vs ${b}` : null;
}

/** A side's name from the match's stored config (matches without a team row, e.g. matchmaking). */
export function configTeamName(config: string | null, side: 'team1' | 'team2'): string | null {
  try {
    const parsed = JSON.parse(config ?? '{}') as Record<string, { name?: unknown } | undefined>;
    const name = parsed[side]?.name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

/** The events whose bold lead is the match's name (match_soon's lead is the tournament). */
export const MATCH_NAMED_EVENTS = ['match_ready', 'veto_turn'];
