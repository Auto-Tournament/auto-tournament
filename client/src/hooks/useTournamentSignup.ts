import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from './useSocket';
import { onSocketReconnect } from '../utils/socketResync';

export interface SignupWindow {
  registrationOpen: boolean;
  registrationClosesAt: string | null;
  maxTeams: number | null;
  checkInOpensAt: string | null;
  checkInClosesAt: string | null;
}

export type ReadinessProblem = 'noAccount' | 'noGame';

export interface LineupPlayer {
  steamId: string;
  name: string;
  avatar: string | null;
  role: 'starter' | 'sub';
  rating: number | null;
  problems: ReadinessProblem[];
  checkedInAt: number | null;
}

export interface Registration {
  /** A starter left mid-tournament: pick a sub before this (epoch seconds), else null. */
  lineupGapDeadline?: number | null;
  teamId: string;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  registeredAt: number;
  rating: number | null;
  lineup: LineupPlayer[];
}

export interface EligibleTeam {
  id: string;
  name: string;
  tag: string | null;
  role: 'owner' | 'captain';
  members: Array<{
    steamId: string;
    name: string;
    avatar: string | null;
    rating: number | null;
    hasAccount: boolean;
    /** Has the tournament's game on their profile; null when unknown. */
    hasGame?: boolean | null;
    owner?: boolean;
    captain?: boolean;
  }>;
}

export interface TournamentSignupState {
  window: SignupWindow | null;
  registrations: Registration[];
  /** Teams the signed-in player can sign up (owner or captain). */
  eligibleTeams: EligibleTeam[];
  /** The signed-in player's Steam ID. */
  steamId: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** When a window opens or closes, as a phase of the day. */
export type SignupPhase = 'none' | 'open' | 'closed' | 'checkIn' | 'checkInDone';

export function signupPhase(window: SignupWindow | null, now: number): SignupPhase {
  if (!window) return 'none';
  const at = (iso: string | null) => (iso ? new Date(iso).getTime() : null);
  const checkInOpens = at(window.checkInOpensAt);
  const checkInCloses = at(window.checkInClosesAt);
  if (checkInOpens !== null && now >= checkInOpens) {
    return checkInCloses !== null && now >= checkInCloses ? 'checkInDone' : 'checkIn';
  }
  if (!window.registrationOpen) return 'none';
  const closes = at(window.registrationClosesAt);
  return closes !== null && now >= closes ? 'closed' : 'open';
}

/**
 * Sign-up and check-in for the tournament page: the windows and the signed-up
 * teams (public), and the teams the signed-in player can sign up. Reloads on
 * every tournament update.
 */
export function useTournamentSignup(tournamentId: number): TournamentSignupState {
  const { playerSteamId } = useAuth();
  const socket = useSocket();
  const [window, setWindow] = useState<SignupWindow | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [eligibleTeams, setEligibleTeams] = useState<EligibleTeam[]>([]);
  const [steamId, setSteamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api.get<{ window: SignupWindow; registrations: Registration[] }>(
        `/api/tournament-signup/${tournamentId}`
      );
      setWindow(data.window ?? null);
      setRegistrations(data.registrations ?? []);
      if (playerSteamId) {
        const me = await api
          .get<{ steamId: string; teams: EligibleTeam[] }>(`/api/tournament-signup/${tournamentId}/me`)
          .catch(() => null);
        setEligibleTeams(me?.teams ?? []);
        setSteamId(me?.steamId ?? playerSteamId);
      } else {
        setEligibleTeams([]);
        setSteamId(null);
      }
    } catch {
      // The page works without sign-up; keep what is on screen.
    } finally {
      setLoading(false);
    }
  }, [tournamentId, playerSteamId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const refresh = () => void reload();
    socket.on('tournament:update', refresh);
    const off = onSocketReconnect(socket, refresh);
    return () => {
      off();
      socket.off('tournament:update', refresh);
    };
  }, [socket, reload]);

  return { window, registrations, eligibleTeams, steamId, loading, reload };
}

/** The signed-up team the viewer belongs to: in its lineup, or its owner or captain. */
export function viewerRegistration(state: TournamentSignupState): Registration | null {
  const { registrations, steamId, eligibleTeams } = state;
  if (!steamId) return null;
  return (
    registrations.find((r) => r.lineup.some((p) => p.steamId === steamId)) ??
    registrations.find((r) => eligibleTeams.some((t) => t.id === r.teamId)) ??
    null
  );
}

/** Remind a lineup player what to fix before check-in (a line in the team's chat). */
export async function remindLineupPlayer(tournamentId: number, teamId: string, steamId: string): Promise<void> {
  const res = await fetch(`/api/tournament-signup/${tournamentId}/remind`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, steamId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}
