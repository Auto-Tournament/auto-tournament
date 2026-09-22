import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { Tournament } from '../types';

/**
 * A tournament, shaped for list views (Home's "your tournaments" / "open for
 * your games", and Browse) rather than for the single-tournament admin pages.
 */
export interface TournamentSummary {
  id: number;
  /** Not populated until tournaments have URLs of their own (3.1). */
  slug?: string;
  name: string;
  /**
   * Catalog slug of the game this tournament is for (e.g. `counter-strike-2`),
   * when known. Optional because a 3.1 tournament could be for any catalog
   * game, but today every tournament this instance runs is CS2.
   */
  game?: string;
  status: Tournament['status'];
  type: Tournament['type'];
  format: Tournament['format'];
  teamCount: number;
  teamSize?: number;
  startsAt?: number;
  location?: string;
  isLive: boolean;
  liveMatchCount?: number;
  winner?: { id: string; name: string; tag?: string } | null;
}

interface UseTournamentListResult {
  tournaments: TournamentSummary[];
  loading: boolean;
  error: string;
}

/**
 * 3.0 hosts exactly one tournament row, always this id (see
 * `LEGACY_TOURNAMENT_ID` in `api/src/utils/tournamentRow.ts` — the one place
 * allowed to know it on the backend). The nav bar's leaderboard link already
 * relies on the same fact. It's needed here because `GET /api/tournament` is
 * admin-only; the per-id leaderboard route is the one tournament endpoint
 * that answers for anonymous visitors, so it's what "the existing public
 * endpoint" in this hook's job is. 3.1's `GET /api/tournaments` drops the
 * need for a known id entirely.
 */
const CURRENT_TOURNAMENT_ID = 1;

function toSummary(tournament: Tournament): TournamentSummary {
  return {
    id: tournament.id,
    name: tournament.name,
    // This instance only ever runs CS2 tournaments today; 3.1 tournaments
    // carry their own catalog game id and this falls away.
    game: 'counter-strike-2',
    status: tournament.status,
    type: tournament.type,
    format: tournament.format,
    teamCount: tournament.teamIds?.length ?? 0,
    teamSize: tournament.teamSize,
    location: tournament.settings?.location,
    isLive: tournament.status === 'in_progress',
    winner: tournament.winner ?? null,
  };
}

/**
 * The tournaments this instance knows about, shaped for list views.
 *
 * 3.1: switch to GET /api/tournaments (plural) — pages don't change. Today
 * there is exactly one tournament row per instance and no admin-free way to
 * ask for it directly, so this fetches it through the public per-tournament
 * leaderboard route (the same one `usePublicTournamentOverview` uses, and
 * the same "not found comes back as a 500 whose message says so" quirk that
 * hook already works around) and returns an array of 0 or 1 entries.
 * Callers (Home, Browse) are written against the array so that swap is the
 * only thing that has to change.
 */
export function useTournamentList(): UseTournamentListResult {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<{ success: boolean; tournament?: Tournament }>(
        `/api/tournament/${CURRENT_TOURNAMENT_ID}/leaderboard`
      );
      setTournaments(response.tournament ? [toSummary(response.tournament)] : []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const isNotFound = message.includes('404') || message.toLowerCase().includes('not found');
      if (!isNotFound) {
        setError(message);
      }
      setTournaments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { tournaments, loading, error };
}
