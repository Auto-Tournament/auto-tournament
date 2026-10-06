import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getAdminTournamentScope, setAdminTournamentScope } from '../utils/api';
import { resetCurrentTournamentId } from '../hooks/useTournamentList';

/** A tournament as `GET /api/tournaments` lists it. */
export interface TournamentListItem {
  id: number;
  name: string;
  game: string;
  type: string;
  format: string;
  status: string;
  description: string | null;
  bannerUrl: string | null;
  entries: number;
  maxEntries: number | null;
  registrationOpen: boolean;
  registrationClosesAt: number | null;
  startsAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  winner: { id: string; name: string; tag?: string } | null;
  featured: boolean;
  archived: boolean;
  draft: boolean;
  /** While it runs: the lowest round not finished (its stage). */
  currentRound?: number | null;
  /** Players per team, when set. */
  teamSize?: number | null;
}

interface AdminTournamentState {
  /** The tournament the admin pages act on (sent as X-Tournament-Id). */
  selectedId: number | null;
  tournaments: TournamentListItem[];
  featuredId: number | null;
  /** The id a new tournament gets: selecting it opens Create on the setup page. */
  nextId: number | null;
  loading: boolean;
  select: (id: number) => void;
  reload: () => Promise<void>;
  /** Bumps when the selection changes; the admin pages remount on it. */
  version: number;
}

const Ctx = createContext<AdminTournamentState | null>(null);

/**
 * Which tournament the admin area is about. Several can exist (Vikunja
 * 1840); the admin picks one in the rail and every admin request names it.
 * The pick survives reloads; a pick that no longer exists falls back to the
 * featured tournament.
 */
export function AdminTournamentProvider({ children }: { children: React.ReactNode }) {
  const [selectedId, setSelectedId] = useState<number | null>(getAdminTournamentScope());
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([]);
  const [featuredId, setFeaturedId] = useState<number | null>(null);
  const [nextId, setNextId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const select = useCallback((id: number) => {
    setAdminTournamentScope(id);
    setSelectedId(id);
    setVersion((v) => v + 1);
  }, []);

  const reload = useCallback(async () => {
    try {
      const r = await api.get<{ tournaments: TournamentListItem[]; featuredId: number; nextId?: number }>('/api/tournaments');
      setTournaments(r.tournaments ?? []);
      setFeaturedId(r.featuredId ?? null);
      setNextId(r.nextId ?? null);
      resetCurrentTournamentId();
      const current = getAdminTournamentScope();
      const known = (r.tournaments ?? []).some((t) => t.id === current) || current === r.nextId;
      if (!current || !known) {
        setAdminTournamentScope(r.featuredId ?? null);
        setSelectedId(r.featuredId ?? null);
      }
    } catch {
      // Not an admin (or offline): the API's featured tournament stands.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(
    () => ({ selectedId, tournaments, featuredId, nextId, loading, select, reload, version }),
    [selectedId, tournaments, featuredId, nextId, loading, select, reload, version]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminTournament(): AdminTournamentState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdminTournament outside AdminTournamentProvider');
  return ctx;
}

/** The same, or null outside the admin area. */
export function useOptionalAdminTournament(): AdminTournamentState | null {
  return useContext(Ctx);
}
