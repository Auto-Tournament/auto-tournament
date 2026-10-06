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
  /** The front page's big card (one at a time). */
  featured?: boolean;
  /** Finished and off the front page's lists; its page stays. */
  archived?: boolean;
  description?: string | null;
  bannerUrl?: string | null;
  registrationOpen?: boolean;
  /** Teams signed up (players for a shuffle), against the cap when there is one. */
  entries?: number;
  maxEntries?: number | null;
}

/** A tournament as `GET /api/tournaments` lists it. */
interface ListedTournament {
  id: number;
  name: string;
  game: string;
  type: Tournament['type'];
  format: Tournament['format'];
  status: Tournament['status'];
  description: string | null;
  bannerUrl: string | null;
  entries: number;
  maxEntries: number | null;
  registrationOpen: boolean;
  startsAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  winner: { id: string; name: string; tag?: string } | null;
  featured: boolean;
  archived: boolean;
  draft: boolean;
}

function fromListed(t: ListedTournament): TournamentSummary {
  return {
    id: t.id,
    name: t.name,
    game: catalogSlugFor(t.game),
    status: t.status,
    type: t.type,
    format: t.format,
    teamCount: t.entries,
    startsAt: t.startsAt ? t.startsAt * 1000 : undefined,
    completedAt: t.completedAt ? t.completedAt * 1000 : undefined,
    isLive: t.status === 'in_progress',
    winner: t.winner,
    featured: t.featured,
    archived: t.archived,
    description: t.description,
    bannerUrl: t.bannerUrl,
    registrationOpen: t.registrationOpen,
    entries: t.entries,
    maxEntries: t.maxEntries,
  };
}



interface UseTournamentListResult {
  tournaments: TournamentSummary[];
  loading: boolean;
  error: string;
}

/**
 * 3.0 runs one tournament at a time. It was always id 1; since a finished
 * tournament can be archived (it keeps its results at its id), the current
 * one is whatever `GET /api/tournament/current-id` says. Asked once per page
 * load; `resetCurrentTournamentId()` after archiving asks again. 3.1's
 * `GET /api/tournaments` drops the need for a known id entirely.
 */
let currentIdRequest: Promise<number> | null = null;

export function fetchCurrentTournamentId(): Promise<number> {
  currentIdRequest ??= api
    .get<{ success: boolean; id: number }>('/api/tournament/current-id')
    .then((r) => (Number.isInteger(r.id) && r.id > 0 ? r.id : 1))
    .catch(() => {
      currentIdRequest = null;
      return 1;
    });
  return currentIdRequest;
}

/** Forget the current id, so the next ask reads it again (after archiving a tournament). */
export function resetCurrentTournamentId(): void {
  currentIdRequest = null;
}

/** The current tournament's id: 1 until the answer arrives. */
export function useCurrentTournamentId(): number {
  const [id, setId] = useState(1);
  useEffect(() => {
    let cancelled = false;
    void fetchCurrentTournamentId().then((value) => !cancelled && setId(value));
    return () => {
      cancelled = true;
    };
  }, []);
  return id;
}


/**
 * The tournaments this instance runs, shaped for list views: every one but
 * the drafts, newest first (`GET /api/tournaments`).
 */
export function useTournamentList(): UseTournamentListResult {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Every tournament, newest first; drafts stay on the admin pages.
      const response = await api.get<{ success: boolean; tournaments?: ListedTournament[] }>('/api/tournaments');
      setTournaments((response.tournaments ?? []).filter((t) => !t.draft).map(fromListed));
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
