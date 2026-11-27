/**
 * One match as the profile shows it (Overview's rating chart, the Matches
 * tab's list): the player's side first in every score.
 */
export interface ProfileMatch {
  /** React key: the slug, or the rating history row's own key for a deleted match. */
  key: string;
  /** Null when the match is gone (its tournament was deleted). */
  slug: string | null;
  /** Unix seconds. */
  at: number;
  won: boolean;
  /** The other team, when the match is still here. */
  opponent: { id: string | null; name: string } | null;
  /** "vs Baltic Five", or the stored label of a deleted match. */
  title: string;
  tournament: { id: number; name: string } | null;
  /** The round ("Final"), or the tournament's name when it is not linked. */
  detail: string;
  /** The maps played, in order (empty when none were recorded). */
  maps: string[];
  /** The player's side first: rounds on one map, maps won in a series. */
  score: [number, number] | null;
  kills?: number;
  deaths?: number;
  assists?: number;
  headshots?: number;
  adr?: number;
  /** The rating after this match, and the change, when it was rated. */
  eloAfter?: number;
  eloChange?: number;
  hasDemo: boolean;
}

/** A recorded map's score, in the stored team1 / team2 order. */
export interface StoredMap {
  name: string | null;
  team1Score: number;
  team2Score: number;
  winner: string | null;
}

/** Map names and the player's-side-first score of a match's stored maps. */
export function mapsAndScore(
  maps: StoredMap[] | undefined,
  side: 'team1' | 'team2'
): { maps: string[]; score: [number, number] | null } {
  const list = maps ?? [];
  const names = list.map((m) => m.name).filter((n): n is string => !!n);
  if (list.length === 0) return { maps: names, score: null };
  if (list.length === 1) {
    const m = list[0];
    return {
      maps: names,
      score: side === 'team1' ? [m.team1Score, m.team2Score] : [m.team2Score, m.team1Score],
    };
  }
  // A series: maps won each.
  const won = (team: string) =>
    list.filter((m) => {
      if (m.winner) return m.winner === team;
      return team === 'team1' ? m.team1Score > m.team2Score : m.team2Score > m.team1Score;
    }).length;
  const other = side === 'team1' ? 'team2' : 'team1';
  return { maps: names, score: [won(side), won(other)] };
}

/** "Mirage" for one map, "Mirage · Inferno" for a series. */
export function mapLabel(maps: string[]): string {
  return maps.map(prettyMap).join(' · ');
}

/** de_dust2 -> Dust II, de_mirage -> Mirage; anything else as stored. */
export function prettyMap(map: string): string {
  const special: Record<string, string> = { de_dust2: 'Dust II', de_dust: 'Dust' };
  if (special[map]) return special[map];
  const stem = map.replace(/^(de|cs|ar|dz|gd)_/, '');
  if (stem === map && !/^[a-z0-9_]+$/.test(map)) return map;
  return stem
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
