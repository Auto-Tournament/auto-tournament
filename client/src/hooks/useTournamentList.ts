import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { catalogSlugFor } from '../integrations/registry';
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
   * when known. Undefined for a game this instance has no catalogue row for.
   */
  game?: string;
  status: Tournament['status'];
  type: Tournament['type'];
  format: Tournament['format'];
  teamCount: number;
  teamSize?: number;
  /** Epoch ms: the first schedule row, or when it started. */
  startsAt?: number;
  /** Epoch ms it finished, once completed. */
  completedAt?: number;
  /** Who runs it (the event page's organizer line). */
  organizer?: string;
  location?: string;
  isLive: boolean;
  /** Matches live or loading right now. */
  liveMatchCount?: number;
  winner?: { id: string; name: string; tag?: string } | null;
}

/** The public leaderboard's extras next to the tournament. */
interface LeaderboardExtras {
  liveMatchCount?: number;
}

/** Epoch ms of the first schedule row, or of the start; undefined when neither is known. */
function startTime(tournament: Tournament): number | undefined {
  const scheduled = (tournament.settings?.schedule ?? [])
    .map((item) => new Date(item.at).getTime())
    .filter((time) => Number.isFinite(time));
  if (scheduled.length > 0) return Math.min(...scheduled);
  return tournament.started_at ? tournament.started_at * 1000 : undefined;
}

interface UseTournamentListResult {
  tournaments: TournamentSummary[];
  loading: boolean;
  error: string;
}

/**
 * 3.0 hosts exactly one tournament row, always this id (see
 * `LEGACY_TOURNAMENT_ID` in `api/src/utils/tournamentRow.ts` — the one place
 * allowed to know it on the backend). The top bar's Teams and Leaderboards
 * links read it too, so this stays the client's one copy. It's needed here
 * because `GET /api/tournament` is admin-only; the per-id leaderboard route
 * is the one tournament endpoint that answers for anonymous visitors, so it's what "the existing public
 * endpoint" in this hook's job is. 3.1's `GET /api/tournaments` drops the
 * need for a known id entirely.
 */
export const CURRENT_TOURNAMENT_ID = 1;

function toSummary(tournament: Tournament, extras: LeaderboardExtras = {}): TournamentSummary {
  return {
    id: tournament.id,
    name: tournament.name,
    // The row's own game, as a catalogue slug. It was hard-coded to CS2 while
    // that was the only game a tournament could be for; from 3.0 phase D it
    // can be any of them (PR D9).
    game: catalogSlugFor(tournament.game),
    status: tournament.status,
    type: tournament.type,
    format: tournament.format,
    teamCount: tournament.teamIds?.length ?? 0,
    teamSize: tournament.teamSize,
    startsAt: startTime(tournament),
    completedAt: tournament.completed_at ? tournament.completed_at * 1000 : undefined,
    organizer: tournament.settings?.organizer?.trim() || undefined,
    location: tournament.settings?.location,
    isLive: tournament.status === 'in_progress',
    liveMatchCount: extras.liveMatchCount,
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
      const response = await api.get<
        { success: boolean; tournament?: Tournament } & LeaderboardExtras
      >(`/api/tournament/${CURRENT_TOURNAMENT_ID}/leaderboard`);
      setTournaments(response.tournament ? [toSummary(response.tournament, response)] : []);
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
