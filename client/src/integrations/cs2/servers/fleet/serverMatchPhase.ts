/**
 * What the Servers page says a server's match is doing (pure, for tests): the
 * server's own phase first; "Veto" only while the match is still pending (a
 * match that skips the veto, such as shuffle, never reads "Veto", #616).
 */

export interface ServerMatch {
  slug: string;
  team1: string;
  team2: string;
  score: [number, number] | null;
  map: string | null;
  mapNumber: number | null;
  maps: number;
  phase: 'veto' | 'warmup' | 'knife' | 'live' | 'post' | null;
}

export interface MatchResponse {
  success: boolean;
  match?: {
    slug: string;
    team1?: { name?: string } | null;
    team2?: { name?: string } | null;
    team1MapScore?: number | null;
    team2MapScore?: number | null;
    currentMap?: string | null;
    mapNumber?: number | null;
    maps?: string[];
    matchPhase?: string | null;
    status?: string;
    vetoing?: boolean;
    vetoCompleted?: boolean;
  };
}

export function toServerMatch(m: NonNullable<MatchResponse['match']>): ServerMatch {
  // What the server says it is doing comes first. A veto happens while the
  // match is still pending; a match that skips it (shuffle) is ready with
  // vetoCompleted false and must not read "Veto" while players join.
  const phase =
    m.matchPhase === 'warmup' || m.matchPhase === 'knife' || m.matchPhase === 'live'
      ? m.matchPhase
      : m.matchPhase === 'post_match'
        ? 'post'
        : m.vetoing || (m.status === 'pending' && m.vetoCompleted === false)
          ? 'veto'
          : null;
  const s1 = m.team1MapScore;
  const s2 = m.team2MapScore;
  return {
    slug: m.slug,
    team1: m.team1?.name ?? '',
    team2: m.team2?.name ?? '',
    score: typeof s1 === 'number' && typeof s2 === 'number' ? [s1, s2] : null,
    map: m.currentMap ?? null,
    mapNumber: typeof m.mapNumber === 'number' ? m.mapNumber : null,
    maps: m.maps?.length ?? 0,
    phase,
  };
}
