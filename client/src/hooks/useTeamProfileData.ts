import { useCallback, useEffect, useState } from 'react';
import type {
  Team,
  TeamStats,
  TeamStanding,
  TeamMatchInfo,
  TeamMatchHistory,
} from '../types';
import type { TeamTournamentInfo } from '../components/team/profile/TeamTournaments';

/**
 * Data for the public team profile page (`/t/team/:teamId`).
 *
 * Deliberately composed from the same public, already-audited endpoints the
 * team match page uses (`/api/team/:id/match`, `/stats`, `/history`) rather
 * than a new aggregate endpoint: those three already return only roster
 * fields safe for a spectator (steamId, name, avatar, live ELO — never a
 * Discord ID, see `player-discord-id.spec.ts`), and already carry everything
 * this page shows: roster, current-match/tournament status, standing and
 * recent results.
 */

interface UseTeamProfileDataResult {
  team: Team | null;
  hasMatch: boolean;
  match: TeamMatchInfo | null;
  tournament: TeamTournamentInfo | null;
  stats: TeamStats | null;
  standing: TeamStanding | null;
  recentResults: TeamMatchHistory[];
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

export function useTeamProfileData(teamId: string | undefined): UseTeamProfileDataResult {
  const [team, setTeam] = useState<Team | null>(null);
  const [hasMatch, setHasMatch] = useState(false);
  const [match, setMatch] = useState<TeamMatchInfo | null>(null);
  const [tournament, setTournament] = useState<TeamTournamentInfo | null>(null);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [standing, setStanding] = useState<TeamStanding | null>(null);
  const [recentResults, setRecentResults] = useState<TeamMatchHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const matchResponse = await fetch(`/api/team/${teamId}/match`);
      if (matchResponse.status === 404) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      if (!matchResponse.ok) {
        throw new Error('Failed to load team');
      }
      const matchData = await matchResponse.json();
      if (!matchData.success) {
        throw new Error('Failed to load team');
      }

      setTeam(matchData.team);
      setHasMatch(!!matchData.hasMatch);
      setMatch(matchData.hasMatch ? matchData.match : null);

      const [statsResponse, historyResponse] = await Promise.all([
        fetch(`/api/team/${teamId}/stats`),
        fetch(`/api/team/${teamId}/history?limit=5`),
      ]);

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        if (statsData.success) {
          setStats(statsData.stats ?? null);
          setStanding(statsData.standing ?? null);
          setTournament(statsData.tournament ?? null);
        }
      }

      if (historyResponse.ok) {
        const historyData = await historyResponse.json();
        if (historyData.success) {
          setRecentResults(historyData.matches ?? []);
        }
      }
    } catch (err) {
      console.error('Failed to load team profile:', err);
      setError('Failed to load team. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    team,
    hasMatch,
    match,
    tournament,
    stats,
    standing,
    recentResults,
    loading,
    notFound,
    error,
  };
}
