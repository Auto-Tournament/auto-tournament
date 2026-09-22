import type { MatchLiveStats } from '../types';


type MatchMapResultLike = {
  mapNumber?: number | null;
  team1Score: number;
  team2Score: number;
  winnerTeam?: 'team1' | 'team2' | 'none' | null;
};

type MatchLikeForScores = {
  status?: string | null;
  team1Score?: number | null;
  team2Score?: number | null;
  /** Maps won, as returned by the API. */
  team1SeriesScore?: number | null;
  team2SeriesScore?: number | null;
  /** Current map rounds, as returned by the API (null when not in progress). */
  team1MapScore?: number | null;
  team2MapScore?: number | null;
  mapNumber?: number | null;
  mapResults?: MatchMapResultLike[] | null;
};

export function deriveSeriesScore(
  match: MatchLikeForScores,
  liveStats?: Pick<MatchLiveStats, 'team1SeriesScore' | 'team2SeriesScore'> | null
): { team1: number; team2: number; source: 'mapResults' | 'liveStats' | 'match' | 'default' } {
  const results = match.mapResults ?? null;
  if (Array.isArray(results) && results.length > 0) {
    const derived = results.reduce(
      (acc, r) => {
        // An explicit winner counts even when rounds are level (damage tiebreak).
        if (r.winnerTeam === 'team1') acc.team1 += 1;
        else if (r.winnerTeam === 'team2') acc.team2 += 1;
        else if (
          r.winnerTeam !== 'none' &&
          typeof r.team1Score === 'number' &&
          typeof r.team2Score === 'number'
        ) {
          if (r.team1Score > r.team2Score) acc.team1 += 1;
          else if (r.team2Score > r.team1Score) acc.team2 += 1;
        }
        return acc;
      },
      { team1: 0, team2: 0 }
    );
    return { ...derived, source: 'mapResults' };
  }

  if (typeof match.team1SeriesScore === 'number' && typeof match.team2SeriesScore === 'number') {
    return { team1: match.team1SeriesScore, team2: match.team2SeriesScore, source: 'match' };
  }

  if (
    liveStats &&
    typeof liveStats.team1SeriesScore === 'number' &&
    typeof liveStats.team2SeriesScore === 'number'
  ) {
    return {
      team1: liveStats.team1SeriesScore ?? 0,
      team2: liveStats.team2SeriesScore ?? 0,
      source: 'liveStats',
    };
  }

  // Only trust the match-level scores as SERIES score when match is completed.
  // During live play, these fields are often repurposed for current map rounds by websocket overlays.
  if (match.status === 'completed') {
    const team1 = typeof match.team1Score === 'number' ? match.team1Score : 0;
    const team2 = typeof match.team2Score === 'number' ? match.team2Score : 0;
    return { team1, team2, source: 'match' };
  }

  return { team1: 0, team2: 0, source: 'default' };
}

export function deriveCurrentMapScore(
  match: MatchLikeForScores,
  liveStats?: (Pick<MatchLiveStats, 'team1Score' | 'team2Score'> & { status?: string }) | null,
  options?: { mapNumber?: number | null }
): {
  team1: number;
  team2: number;
  source: 'liveStats' | 'match' | 'mapResults' | 'default';
  warmup?: boolean;
} {
  if (
    liveStats &&
    match.status !== 'completed' &&
    typeof liveStats.team1Score === 'number' &&
    typeof liveStats.team2Score === 'number'
  ) {
    // Between maps the live stats still hold the finished map's rounds until
    // the next map goes live; during warmup the current map has no score yet.
    if (liveStats.status === 'warmup') {
      return { team1: 0, team2: 0, source: 'liveStats', warmup: true };
    }
    return {
      team1: liveStats.team1Score ?? 0,
      team2: liveStats.team2Score ?? 0,
      source: 'liveStats',
    };
  }

  if (
    match.status !== 'completed' &&
    typeof match.team1MapScore === 'number' &&
    typeof match.team2MapScore === 'number'
  ) {
    return { team1: match.team1MapScore, team2: match.team2MapScore, source: 'match' };
  }

  // When completed, prefer per-map round score from the selected mapResult (if present).
  if (match.status === 'completed') {
    const desiredMapNumber =
      typeof options?.mapNumber === 'number'
        ? options.mapNumber
        : typeof match.mapNumber === 'number'
          ? match.mapNumber
          : null;

    const results = match.mapResults ?? null;
    if (Array.isArray(results) && results.length > 0) {
      const picked =
        typeof desiredMapNumber === 'number'
          ? results.find((r) => r.mapNumber === desiredMapNumber)
          : null;
      const fallback = results[results.length - 1];
      const r = picked ?? fallback;
      return { team1: r.team1Score, team2: r.team2Score, source: 'mapResults' };
    }
  }

  return { team1: 0, team2: 0, source: 'default' };
}

