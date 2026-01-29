import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../utils/api';
import { io } from 'socket.io-client';
import type { Match, MatchLiveStats, Tournament } from '../types';
import { useSnackbar } from '../contexts/SnackbarContext';

const LIVE_STATS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const getLiveStatsCacheKey = (tournamentId: number) => `mat:bracket:liveStats:v1:${tournamentId}`;
type CachedLiveStatsEntry = { liveStats: MatchLiveStats; cachedAt: number };

function readLiveStatsCache(tournamentId: number): Record<string, CachedLiveStatsEntry> {
  try {
    const raw = globalThis.localStorage.getItem(getLiveStatsCacheKey(tournamentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CachedLiveStatsEntry>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeLiveStatsCache(tournamentId: number, next: Record<string, CachedLiveStatsEntry>): void {
  try {
    globalThis.localStorage.setItem(getLiveStatsCacheKey(tournamentId), JSON.stringify(next));
  } catch {
    // best-effort only
  }
}

function pruneLiveStatsCache(
  tournamentId: number,
  nowMs: number
): Record<string, CachedLiveStatsEntry> {
  const cache = readLiveStatsCache(tournamentId);
  let changed = false;
  for (const [slug, entry] of Object.entries(cache)) {
    if (
      !entry ||
      typeof entry.cachedAt !== 'number' ||
      nowMs - entry.cachedAt > LIVE_STATS_CACHE_TTL_MS
    ) {
      delete cache[slug];
      changed = true;
    }
  }
  if (changed) {
    writeLiveStatsCache(tournamentId, cache);
  }
  return cache;
}

export const useBracket = () => {
  const { showSuccess, showError, showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tournament, setTournament] = useState<Tournament | null>(null);
  type BracketMatch = Match & { liveStats?: MatchLiveStats | null };
  const [matches, setMatches] = useState<BracketMatch[]>([]);
  const [totalRounds, setTotalRounds] = useState(0);
  const [starting, setStarting] = useState(false);
  const lastTournamentStatusRef = useRef<Tournament['status'] | null>(null);
  const tournamentIdRef = useRef<number | null>(null);

  /**
   * Load or reload the current bracket.
   *
   * When called with { silent: true }, this performs a background reload
   * without flipping the top-level `loading` flag. This avoids unmounting
   * the bracket page (and any open modals) on every websocket-driven
   * structural update while still keeping the data fresh.
   */
  const loadBracket = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    setError('');

    try {
      const response: {
        success: boolean;
        tournament?: Tournament;
        matches?: Match[];
        totalRounds?: number;
      } = await api.get('/api/tournament/bracket');

      if (response.success && response.tournament) {
        setTournament(response.tournament);
        tournamentIdRef.current = response.tournament.id;

        const nowMs = Date.now();
        const cache = pruneLiveStatsCache(response.tournament.id, nowMs);

        const rehydrated = (response.matches || []).map((m) => {
          // Only rehydrate liveStats for matches that are actually in progress.
          if (m.status !== 'loaded' && m.status !== 'live') {
            return m as BracketMatch;
          }
          const cached = cache[m.slug];
          if (!cached?.liveStats) return m as BracketMatch;
          return { ...(m as BracketMatch), liveStats: cached.liveStats };
        });

        setMatches(rehydrated);
        setTotalRounds(response.totalRounds || 0);
      } else {
        // No tournament yet - not an error, just empty state
        setTournament(null);
        tournamentIdRef.current = null;
        setMatches([]);
        setTotalRounds(0);
      }
    } catch (err) {
      const error = err as Error;
      // Handle 404 gracefully - tournament doesn't exist yet (empty state)
      if (error.message.includes('404') || error.message.includes('No tournament')) {
        setTournament(null);
        tournamentIdRef.current = null;
        setMatches([]);
        setTotalRounds(0);
      } else {
        // Real error - network issue, server error, etc.
        setError(error.message || 'Failed to load bracket');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const startTournament = async () => {
    setStarting(true);

    try {
      const baseUrl = window.location.origin;
      const response: {
        success: boolean;
        message?: string;
        allocated?: number;
      } = await api.post('/api/tournament/start', { baseUrl });

      if (response.success) {
        // Backend now starts allocation in the background and returns immediately.
        // Show whatever message the API provides; allocation progress will be
        // reflected via bracket + match websocket updates.
        if (typeof response.allocated === 'number') {
          showSuccess(
            response.message ||
              `Tournament started! ${response.allocated} match${
                response.allocated === 1 ? '' : 'es'
              } allocated to servers.`
          );
        } else {
          showSuccess(
            response.message ||
              'Tournament start requested. Servers will be allocated shortly.'
          );
        }
        await loadBracket();
      } else {
        showError(response.message || 'Failed to start tournament');
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to start tournament');
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    void loadBracket();

    const newSocket = io();

    const applyMatchPatch = (payload: Record<string, unknown>) => {
      if (!payload) return;
      const slug =
        (payload.slug as string | undefined) ||
        (payload.matchSlug as string | undefined) ||
        (payload.match && typeof payload.match === 'object'
          ? (payload.match as { slug?: string }).slug ?? undefined
          : undefined);

      if (!slug) {
        return;
      }

      setMatches((prev) => {
        if (!prev.length) return prev;
        const index = prev.findIndex((match) => match.slug === slug);
        if (index === -1) return prev;

        const current = prev[index];
        const next: BracketMatch = { ...current };
        let changed = false;

        let newStatus: Match['status'] | undefined;

        const status =
          (payload.status as Match['status'] | undefined) ??
          ((payload as { match_status?: string }).match_status as Match['status'] | undefined);
        if (status && status !== current.status) {
          next.status = status;
          newStatus = status;
          changed = true;
        }

        // When a match transitions into the completed state via websocket,
        // explicitly reset both scores back to 0-0 before applying the
        // final series result from the payload. This avoids transient
        // hybrids like "9-1" where only the winner's side was updated.
        if (newStatus === 'completed') {
          next.team1Score = 0;
          next.team2Score = 0;
        }

        const serverId =
          (payload.serverId as string | undefined) ||
          ((payload as { server_id?: string }).server_id ?? undefined);
        if (serverId !== undefined && serverId !== current.serverId) {
          next.serverId = serverId || undefined;
          changed = true;
        }

        const team1Score =
          (payload.team1Score as number | undefined) ||
          ((payload as { team1_score?: number }).team1_score ?? undefined);
        if (typeof team1Score === 'number' && team1Score !== current.team1Score) {
          next.team1Score = team1Score;
          changed = true;
        }

        const team2Score =
          (payload.team2Score as number | undefined) ||
          ((payload as { team2_score?: number }).team2_score ?? undefined);
        if (typeof team2Score === 'number' && team2Score !== current.team2Score) {
          next.team2Score = team2Score;
          changed = true;
        }

        // IMPORTANT: In bracket context, `team1Score/team2Score` represent the
        // series score (maps won). We must NOT overwrite them with current-map
        // round score from liveStats, otherwise bracket tiles show 8–5 etc.
        // Store liveStats separately so tooltips/details can still show rounds.
        const liveStats = (payload as {
          liveStats?: { team1Score?: number; team2Score?: number; team1SeriesScore?: number; team2SeriesScore?: number };
        }).liveStats;
        const effectiveStatus = newStatus ?? current.status;
        if (liveStats && effectiveStatus !== 'completed') {
          next.liveStats = liveStats as MatchLiveStats;
          changed = true;
        }

        // Persist the last known liveStats so a refresh can rehydrate them.
        const tournamentId = tournamentIdRef.current;
        if (tournamentId && liveStats && effectiveStatus !== 'completed') {
          const cache = readLiveStatsCache(tournamentId);
          cache[slug] = { liveStats: liveStats as MatchLiveStats, cachedAt: Date.now() };
          writeLiveStatsCache(tournamentId, cache);
        }

        // Once completed, clear any cached liveStats for this match.
        if (tournamentIdRef.current && effectiveStatus === 'completed') {
          const cache = readLiveStatsCache(tournamentIdRef.current);
          if (cache[slug]) {
            delete cache[slug];
            writeLiveStatsCache(tournamentIdRef.current, cache);
          }
        }

        const winnerId =
          (payload.winnerId as string | undefined) ||
          ((payload as { winner_id?: string }).winner_id ?? undefined);
        if (winnerId && (!current.winner || current.winner.id !== winnerId)) {
          const winnerTeam =
            current.team1?.id === winnerId
              ? current.team1
              : current.team2?.id === winnerId
              ? current.team2
              : undefined;
          if (winnerTeam) {
            next.winner = winnerTeam;
            changed = true;
          }
        }

        if (!changed) {
          return prev;
        }

        // Emit snackbars for key match lifecycle transitions
        if (newStatus === 'completed') {
          const winnerName = next.winner?.name;
          const label =
            next.team1 && next.team2 ? `${next.team1.name} vs ${next.team2.name}` : next.slug;
          showSuccess(
            winnerName
              ? `Match completed: ${label} – ${winnerName} won`
              : `Match completed: ${label}`
          );
        } else if (newStatus === 'live') {
          const label =
            next.team1 && next.team2 ? `${next.team1.name} vs ${next.team2.name}` : next.slug;
          showSnackbar(`Match is now live: ${label}`, 'info');
        }

        const clone = [...prev];
        clone[index] = next;
        return clone;
      });
    };

    const handleBracketUpdate = (event: Record<string, unknown>) => {
      if (!event) return;

      const action = event.action as string | undefined;
      const slug = event.matchSlug as string | undefined;
      const rawStatus = event.status as string | undefined;

      // Treat status as a **tournament** status only for explicit tournament‑level
      // actions. For match-level events (e.g. 'match_status') we must NOT
      // overwrite tournament.status, otherwise a single completed match would
      // look like the whole tournament finished.
      const isTournamentAction =
        action &&
        [
          'tournament_started',
          'tournament_reset',
          'tournament_restarted',
          'tournament_updated',
          'tournament_completed',
        ].includes(action);

      if (isTournamentAction && rawStatus) {
        const status = rawStatus as Tournament['status'];

        setTournament((prev) => (prev ? { ...prev, status } : prev));

        const prevStatus = lastTournamentStatusRef.current;
        // Only announce tournament completion once per transition into "completed"
        if (status === 'completed' && prevStatus !== 'completed') {
          showSuccess('Tournament completed! All matches are finished.');
        } else if (status === 'in_progress' && action === 'tournament_started') {
          // Guard against duplicate "tournament started" toasts as well
          if (prevStatus !== 'in_progress') {
            showSuccess('Tournament started – Round 1 is now live.');
          }
        }

        lastTournamentStatusRef.current = status;
      }

      const matchStatus = rawStatus as Match['status'] | undefined;

      const requiresFullReload = !action
        ? true
        : [
            'bracket_regenerated',
            'tournament_reset',
            'tournament_restarted',
            'tournament_updated',
            'tournament_completed',
            'tournament_started',
            // Structural changes that add/remove matches or change bracket occupants
            'round_advanced',
            'match_ready',
          ].includes(action) ||
          // When a match moves into the completed state, reload the full bracket
          // so scores, winners, and downstream matches (e.g. next round) are
          // fully up to date, even if some earlier websocket patches were partial.
          (action === 'match_status' && matchStatus === 'completed');

      if (requiresFullReload) {
        if (
          action === 'round_advanced' &&
          typeof (event as { roundNumber?: number }).roundNumber === 'number'
        ) {
          const roundNumber = (event as { roundNumber: number }).roundNumber;
          showSnackbar(`Round ${roundNumber} generated – matches are ready to allocate.`, 'info');
        }

        // Perform a background reload without toggling the global "loading"
        // flag so we don't unmount the bracket view (and any open modals)
        // every time a structural websocket event arrives.
        void loadBracket({ silent: true });
        return;
      }

      if (!slug) {
        return;
      }

      setMatches((prev) => {
        if (!prev.length) return prev;
        const index = prev.findIndex((match) => match.slug === slug);
        if (index === -1) return prev;

        const current = prev[index];
        const next: Match = { ...current };
        let changed = false;

        if (action === 'match_status') {
          const newStatus =
            (event.status as Match['status'] | undefined) ??
            (event.matchStatus as Match['status'] | undefined);
          if (newStatus && newStatus !== current.status) {
            next.status = newStatus;
            changed = true;
          }

          const updatedTeam1Score =
            (event.team1Score as number | undefined) ??
            (event as { team1_score?: number }).team1_score ??
            undefined;
          if (
            typeof updatedTeam1Score === 'number' &&
            updatedTeam1Score !== current.team1Score
          ) {
            next.team1Score = updatedTeam1Score;
            changed = true;
          }

          const updatedTeam2Score =
            (event.team2Score as number | undefined) ??
            (event as { team2_score?: number }).team2_score ??
            undefined;
          if (
            typeof updatedTeam2Score === 'number' &&
            updatedTeam2Score !== current.team2Score
          ) {
            next.team2Score = updatedTeam2Score;
            changed = true;
          }
        } else if (action === 'match_ready') {
          if (current.status !== 'ready') {
            next.status = 'ready';
            changed = true;
          }
        } else if (action === 'match_loaded') {
          if (current.status !== 'loaded') {
            next.status = 'loaded';
            changed = true;
          }
        } else if (action === 'match_restarted') {
          if (current.status !== 'loaded') {
            next.status = 'loaded';
            changed = true;
          }
        } else if (action === 'server_assigned' || action === 'match_allocated') {
          const serverId =
            (event.serverId as string | undefined) ??
            (event as { server_id?: string }).server_id ??
            undefined;
          if (serverId !== undefined && serverId !== current.serverId) {
            next.serverId = serverId || undefined;
            changed = true;
          }
        }

        if (!changed) return prev;

        if (action === 'server_assigned' || action === 'match_allocated') {
          const label =
            next.team1 && next.team2 ? `${next.team1.name} vs ${next.team2.name}` : next.slug;
          const id =
            (event.serverId as string | undefined) ??
            (event as { server_id?: string }).server_id ??
            undefined;
          showSnackbar(
            id ? `Allocated server ${id} to match ${label}` : `Allocated server to match ${label}`,
            'info'
          );
        }
        const clone = [...prev];
        clone[index] = next;
        return clone;
      });
    };

    newSocket.on('match:update', applyMatchPatch);
    newSocket.on('bracket:update', handleBracketUpdate);

    return () => {
      newSocket.off('match:update', applyMatchPatch);
      newSocket.off('bracket:update', handleBracketUpdate);
      newSocket.close();
    };
  }, [loadBracket, showSuccess, showSnackbar]);

  return {
    loading,
    error,
    tournament,
    matches,
    totalRounds,
    starting,
    loadBracket,
    startTournament,
  };
};
