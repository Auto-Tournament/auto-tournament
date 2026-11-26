/**
 * Teammate colours: the colour a player has on their team's radar, scoreboard
 * and above their head in CS2. A player picks theirs on the account page
 * (players.teammate_color); a team's owner or captain can set one per member
 * for that team's matches (team_members.color), which wins. Ready Up writes it
 * over CS2's own pick (match.assign `color`, fleet.so).
 */
export const TEAMMATE_COLORS = ['blue', 'green', 'yellow', 'orange', 'purple'] as const;
export type TeammateColor = (typeof TEAMMATE_COLORS)[number];

export function isTeammateColor(value: unknown): value is TeammateColor {
  return typeof value === 'string' && (TEAMMATE_COLORS as readonly string[]).includes(value);
}
