import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import type { Socket } from 'socket.io-client';
import { scopedSocket } from '../utils/sharedSocket';
import { onSocketReconnect } from '../utils/socketResync';

/** One side of the viewer's match: name, tag and logo. */
export interface MatchupSide {
  name: string | null;
  tag: string | null;
  logoUrl: string | null;
}

export type MatchStatusValue =
  'none' | 'your_turn_veto' | 'waiting_veto' | 'veto_soon' | 'waiting_server' | 'match_ready';

interface MatchStatusResult {
  status: MatchStatusValue;
  matchSlug: string | null;
  /** "Team A vs Team B", when the match config names both teams. */
  matchName: string | null;
  label: string | null;
  /** Which side of the current match the viewer is on (veto phase only). */
  viewerTeam: 'team1' | 'team2' | null;
  /** Number of veto actions taken so far (veto phase only). */
  vetoActionCount: number | null;
  /** Team that made the most recent veto action (veto phase only). */
  lastVetoActionTeam: 'team1' | 'team2' | null;
  /** `veto_soon`: when the veto opens (ISO), after the break between matches. */
  opensAt: string | null;
  /** The tournament has no veto: `veto_soon` counts down to the match itself. */
  vetoOff: boolean;
  /** The viewer's team and the opponent, for the next-match dialog. */
  matchup: { you: MatchupSide; opponent: MatchupSide } | null;
  loading: boolean;
  refetch: () => void;
}

export function useCurrentMatchStatus(playerSteamId: string | null): MatchStatusResult {
  const [status, setStatus] = useState<MatchStatusValue>('none');
  const [matchSlug, setMatchSlug] = useState<string | null>(null);
  const [matchName, setMatchName] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [viewerTeam, setViewerTeam] = useState<'team1' | 'team2' | null>(null);
  const [vetoActionCount, setVetoActionCount] = useState<number | null>(null);
  const [lastVetoActionTeam, setLastVetoActionTeam] = useState<'team1' | 'team2' | null>(null);
  const [opensAt, setOpensAt] = useState<string | null>(null);
  const [vetoOff, setVetoOff] = useState(false);
  const [matchup, setMatchup] = useState<MatchStatusResult['matchup']>(null);
  // Loading until the first fetch: a navbar mounted by a page change must not
  // take the initial 'none' as the previous status and toast the fetched one.
  const [loading, setLoading] = useState(Boolean(playerSteamId));
  const socketRef = useRef<Socket | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const fetchStatus = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!playerSteamId) {
        setStatus('none');
        setMatchSlug(null);
        setMatchName(null);
        setLabel(null);
        setViewerTeam(null);
        setVetoActionCount(null);
        setLastVetoActionTeam(null);
        return;
      }

      if (!options?.silent) {
        setLoading(true);
      }
      try {
        const res = await api.get<{
          success: boolean;
          status?: MatchStatusValue;
          matchSlug?: string | null;
          matchName?: string | null;
          label?: string | null;
          viewerTeam?: 'team1' | 'team2' | null;
          vetoActionCount?: number | null;
          lastVetoActionTeam?: 'team1' | 'team2' | null;
          opensAt?: string | null;
          vetoOff?: boolean;
          matchup?: MatchStatusResult['matchup'];
        }>('/api/players/me/match-status');

        if (res?.success) {
          setStatus((res.status as MatchStatusValue) ?? 'none');
          setMatchSlug(res.matchSlug ?? null);
          setMatchName(res.matchName ?? null);
          setLabel(res.label ?? null);
          setViewerTeam(res.viewerTeam ?? null);
          setVetoActionCount(typeof res.vetoActionCount === 'number' ? res.vetoActionCount : null);
          setLastVetoActionTeam(res.lastVetoActionTeam ?? null);
          setOpensAt(res.opensAt ?? null);
          setVetoOff(res.vetoOff === true);
          setMatchup(res.matchup ?? null);
        }
      } catch {
        setStatus('none');
        setMatchSlug(null);
        setMatchName(null);
        setLabel(null);
        setViewerTeam(null);
        setVetoActionCount(null);
        setLastVetoActionTeam(null);
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [playerSteamId]
  );

  useEffect(() => {
    void fetchStatus();
  }, [playerSteamId, fetchStatus]);

  // Real-time updates: veto actions, match and bracket changes and the
  // player's matchmaking events refetch match-status at once (no polling).
  useEffect(() => {
    if (!playerSteamId) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }

    if (!socketRef.current) {
      socketRef.current = scopedSocket();
    }
    const socket = socketRef.current;

    const scheduleSilentRefetch = () => {
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void fetchStatus({ silent: true });
      }, 50);
    };

    // Any veto update can affect whose turn it is (and thus match-status labels);
    // a match loading, going live or ending, a bracket advancing and the
    // player's own matchmaking change which match is theirs. No timer.
    const events = ['veto:update', 'match:update', 'bracket:update', 'mm:changed'];
    for (const event of events) socket.on(event, scheduleSilentRefetch);
    socket.emit('player:subscribe');
    const onConnect = () => socket.emit('player:subscribe');
    socket.on('connect', onConnect);
    const offReconnect = onSocketReconnect(socket, scheduleSilentRefetch);

    return () => {
      offReconnect();
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      for (const event of events) socket.off(event, scheduleSilentRefetch);
      socket.off('connect', onConnect);
      // Keep socket open for reuse; it will be closed when playerSteamId becomes null.
    };
  }, [playerSteamId, fetchStatus]);

  return {
    status,
    matchSlug,
    matchName,
    label,
    viewerTeam,
    vetoActionCount,
    lastVetoActionTeam,
    opensAt,
    vetoOff,
    matchup,
    loading,
    refetch: () => fetchStatus(),
  };
}
