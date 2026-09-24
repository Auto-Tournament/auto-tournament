/* global AbortController */
import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Alert,
  CircularProgress,
  Container,
  Stack,
  Chip,
  Button,
  Tooltip,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import { api } from '../utils/api';
import { onSocketReconnect } from '../utils/socketResync';
import { io, Socket } from 'socket.io-client';
import { PerformanceMetricsChart } from '../components/player/PerformanceMetricsChart';
import { MatchInfoCard } from '../components/team/MatchInfoCard';
import { PlayerMatchDetailsModal } from '../components/player/PlayerMatchDetailsModal';
import { useSoundSettings } from '../hooks/useSoundSettings';
import { MatchNotificationAudio } from '../components/match/MatchNotificationAudio';
import { TopNavBar } from '../components/layout/TopNavBar';
import { TournamentRulesAccordion } from '../components/tournament/TournamentRulesAccordion';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { OwnDiscordIdCard } from '../components/player/OwnDiscordIdCard';
import { OwnGamesCard } from '../components/games/OwnGamesCard';
import { ProfileHeader } from '../components/player/profile/ProfileHeader';
import { GameSwitch } from '../components/player/profile/GameSwitch';
import { StatsGrid, type ProfileStat } from '../components/player/profile/StatsGrid';
import { useGameCapabilities } from '../hooks/useGameCapabilities';
import { RatingChart } from '../components/player/profile/RatingChart';
import { RecentMatches, type RecentMatchEntry } from '../components/player/profile/RecentMatches';
import type { PlayerDetail } from '../types/api.types';
import { useAuth } from '../contexts/AuthContext';
import { useCurrentMatchStatus } from '../hooks/useCurrentMatchStatus';
import { useTranslation } from 'react-i18next';
import { useRoundLabel } from '../hooks/useRoundLabel';
import { ratingHistoryBaseline } from '../utils/eloProgression';
import type {
  Team,
  TeamMatchInfo,
  MatchConnectionStatus,
  MatchMapResult,
  Player as TeamPlayer,
} from '../types';
import { tokens, mono, radii } from '../theme/tokens';
import { teamProfilePath } from '../paths';

interface RatingHistoryEntry {
  id: number;
  /** Null when the tournament was deleted: the history (and rating) is kept. */
  matchSlug: string | null;
  eloBefore: number;
  eloAfter: number;
  eloChange: number;
  baseEloAfter?: number | null;
  statAdjustment?: number | null;
  templateId?: string | null;
  matchResult: 'win' | 'loss';
  createdAt: number;
}

interface MatchHistoryEntry {
  slug: string;
  round: number;
  matchNumber: number;
  status: string;
  completedAt: number;
  tournamentId?: number;
  team1Id?: string;
  team2Id?: string;
  winnerId?: string | null;
  /** Game id the match was played under (integrations registry key), e.g. 'cs2'. */
  game?: string | null;
  team1Name?: string | null;
  team1Tag?: string | null;
  team2Name?: string | null;
  team2Tag?: string | null;
  team: 'team1' | 'team2';
  wonMatch: boolean;
  adr?: number;
  totalDamage?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  headshots?: number;
  /** The match has a recorded demo to download. */
  hasDemo?: boolean;
}

function normalizeMatchForPlayerView(rawMatch: TeamMatchInfo, steamId: string): TeamMatchInfo {
  const playerId = steamId.toLowerCase();

  // Prefer config-based membership first (stable), then trust server-provided isTeam1.
  // Only fall back to live stats if config is missing/ambiguous.
  let playerSide: 'team1' | 'team2' | null = null;

  if (rawMatch.config) {
    const team1Players = rawMatch.config.team1?.players ?? [];
    const team2Players = rawMatch.config.team2?.players ?? [];
    const inTeam1 = team1Players.some((p) => p.steamid.toLowerCase() === playerId);
    const inTeam2 = team2Players.some((p) => p.steamid.toLowerCase() === playerId);
    if (inTeam1 && !inTeam2) {
      playerSide = 'team1';
    } else if (!inTeam1 && inTeam2) {
      playerSide = 'team2';
    }
  }

  // Fallback: trust the server‑provided isTeam1 flag.
  if (!playerSide) {
    playerSide = rawMatch.isTeam1 ? 'team1' : 'team2';
  }

  // Final fallback: detect from live stats (in case config is absent).
  if (!playerSide) {
    const stats = rawMatch.liveStats?.playerStats;
    if (stats) {
      const inTeam1 = stats.team1.some((p) => p.steamId?.toLowerCase() === playerId);
      const inTeam2 = stats.team2.some((p) => p.steamId?.toLowerCase() === playerId);
      if (inTeam1 && !inTeam2) {
        playerSide = 'team1';
      } else if (!inTeam1 && inTeam2) {
        playerSide = 'team2';
      }
    }
  }

  // If the player's team is already on the "team1" side, just ensure isTeam1 is true.
  if (playerSide === 'team1') {
    return {
      ...rawMatch,
      isTeam1: true,
    };
  }

  // Otherwise, swap sides so the player's team becomes team1 everywhere.
  const swappedConnectionStatus: MatchConnectionStatus | null | undefined =
    rawMatch.connectionStatus
      ? {
          ...rawMatch.connectionStatus,
          team1Connected: rawMatch.connectionStatus.team2Connected,
          team2Connected: rawMatch.connectionStatus.team1Connected,
          connectedPlayers: rawMatch.connectionStatus.connectedPlayers.map((connected) => ({
            ...connected,
            team: connected.team === 'team1' ? ('team2' as const) : ('team1' as const),
          })),
        }
      : rawMatch.connectionStatus;

  const swappedLiveStats = rawMatch.liveStats
    ? {
        ...rawMatch.liveStats,
        team1Score: rawMatch.liveStats.team2Score,
        team2Score: rawMatch.liveStats.team1Score,
        team1SeriesScore: rawMatch.liveStats.team2SeriesScore,
        team2SeriesScore: rawMatch.liveStats.team1SeriesScore,
        playerStats: rawMatch.liveStats.playerStats
          ? {
              team1: [...rawMatch.liveStats.playerStats.team2],
              team2: [...rawMatch.liveStats.playerStats.team1],
            }
          : rawMatch.liveStats.playerStats,
      }
    : rawMatch.liveStats;

  const swappedMapResults: MatchMapResult[] = rawMatch.mapResults.map((result): MatchMapResult => {
    const swappedWinner: MatchMapResult['winner'] =
      result.winner === 'team1'
        ? 'team2'
        : result.winner === 'team2'
        ? 'team1'
        : result.winner ?? null;

    const swappedWinnerTeam: MatchMapResult['winnerTeam'] =
      result.winnerTeam === 'team1'
        ? 'team2'
        : result.winnerTeam === 'team2'
        ? 'team1'
        : result.winnerTeam ?? null;

    return {
      ...result,
      team1Score: result.team2Score,
      team2Score: result.team1Score,
      winner: swappedWinner,
      winnerTeam: swappedWinnerTeam,
    };
  });

  const swappedConfig = rawMatch.config
    ? {
        ...rawMatch.config,
        team1: rawMatch.config.team2,
        team2: rawMatch.config.team1,
        expected_players_team1:
          rawMatch.config.expected_players_team2 ?? rawMatch.config.expected_players_team1,
        expected_players_team2:
          rawMatch.config.expected_players_team1 ?? rawMatch.config.expected_players_team2,
      }
    : rawMatch.config;

  return {
    ...rawMatch,
    isTeam1: true,
    team1: rawMatch.team2,
    team2: rawMatch.team1,
    opponent: rawMatch.team1 ?? null,
    connectionStatus: swappedConnectionStatus,
    liveStats: swappedLiveStats,
    mapResults: swappedMapResults,
    config: swappedConfig,
  };
}

export default function PlayerProfile() {
  type AssignedTeam = {
    id: string;
    name: string;
    tag?: string;
    players: Array<{ steamId: string; name: string; avatar?: string }>;
  };

  const { steamId } = useParams<{ steamId: string }>();
  const [player, setPlayer] = useState<PlayerDetail | null>(null);
  const [ratingHistory, setRatingHistory] = useState<RatingHistoryEntry[]>([]);
  const [matchHistory, setMatchHistory] = useState<MatchHistoryEntry[]>([]);
  const [games, setGames] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentMatch, setCurrentMatch] = useState<TeamMatchInfo | null>(null);
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [assignedTeam, setAssignedTeam] = useState<AssignedTeam | null>(null);
  const [currentTournamentStatus, setCurrentTournamentStatus] = useState<string>('setup');
  const [selectedMatch, setSelectedMatch] = useState<MatchHistoryEntry | null>(null);
  const [allocationCountdown, setAllocationCountdown] = useState<{
    nextAllocationInSeconds: number | null;
    gracePeriodSeconds: number;
  }>({
    nextAllocationInSeconds: null,
    gracePeriodSeconds: 300,
  });
  const socketRef = useRef<Socket | null>(null);
  const { playerSteamId, hasPlayerRecord, impersonation } = useAuth();
  const { t } = useTranslation();
  const getRoundLabel = useRoundLabel();
  // Kills, deaths, assists, headshots, damage and the demo link are things the
  // game measured. A game that measures none of them has no column of N/A to
  // show — it has no column (3.0 phase D, PR D10).
  const {
    capabilities: gameCapabilities,
    integration: gameIntegration,
    tournamentId: gameTournamentId,
  } = useGameCapabilities();
  const showGameStats = gameCapabilities.playerStats;
  const showDemos = gameCapabilities.demos;
  const { matchSlug: statusMatchSlug } = useCurrentMatchStatus(
    steamId && playerSteamId === steamId ? steamId : null
  );
  const lastRefetchedMatchSlugRef = useRef<string | null>(null);
  const silentRefreshTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const loadAbortControllerRef = useRef<AbortController | null>(null);

  // Shared sound settings (persisted via localStorage)
  const { isMuted, volume, soundFile } = useSoundSettings();

  // Deduplicate matches by slug to avoid double-counting wins/losses if stats rows are duplicated.
  const uniqueMatchHistory: MatchHistoryEntry[] = React.useMemo(() => {
    const bySlug = new Map<string, MatchHistoryEntry>();
    for (const match of matchHistory) {
      if (!bySlug.has(match.slug)) {
        bySlug.set(match.slug, match);
      }
    }
    return Array.from(bySlug.values());
  }, [matchHistory]);

  // Lightweight lookup so we can map rating history rows (by matchSlug) to the
  // final rating for that match when rendering the Match History table.
  const ratingBySlug = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of ratingHistory) {
      if (entry.matchSlug) map.set(entry.matchSlug, entry.eloAfter);
    }
    return map;
  }, [ratingHistory]);

  const loadPlayerData = React.useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!steamId) return;

    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      // Cancel any in-flight refresh so socket bursts don't race and apply stale data.
      if (loadAbortControllerRef.current) {
        loadAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      loadAbortControllerRef.current = controller;

      type PlayerSummaryResponse = {
        success: boolean;
        player: PlayerDetail;
        stats?: {
          matchesPlayed: number;
          wins: number;
          losses: number;
          winRate: number;
          averageAdr: number;
          recentForm: string;
        };
        ratingHistory: Array<{
          match_slug: string | null;
          elo_before: number;
          elo_after: number;
          elo_change: number;
          base_elo_after?: number | null;
          stat_adjustment?: number | null;
          template_id?: string | null;
          match_result: 'win' | 'loss';
          created_at: number;
        }>;
        matches: Array<{
          slug: string;
          round: number;
          match_number: number;
          status: string;
          completed_at: number;
          tournamentId?: number;
          team1_id?: string;
          team2_id?: string;
          winner_id?: string | null;
          game?: string | null;
          team1_name?: string | null;
          team1_tag?: string | null;
          team2_name?: string | null;
          team2_tag?: string | null;
          team: 'team1' | 'team2';
          won_match: boolean;
          adr?: number;
          total_damage?: number;
          kills?: number;
          deaths?: number;
          assists?: number;
          headshots?: number;
          has_demo?: boolean;
        }>;
        games?: Array<{ id: string; name: string }>;
      };

      // Load aggregated player summary (details + history + matches + basic stats)
      const summaryResponse = (await api.fetch(`/api/players/${steamId}/summary`, {
        method: 'GET',
        signal: controller.signal,
      })) as PlayerSummaryResponse;

      if (!summaryResponse.success || !summaryResponse.player) {
        setError(t('playerPage.playerNotFound'));
        setPlayer(null);
        setRatingHistory([]);
        setMatchHistory([]);
        setAssignedTeam(null);
        setGames([]);
        setSelectedGameId(null);
        return;
      }

      setPlayer(summaryResponse.player);
      document.title = t('playerPage.pageTitle', { name: summaryResponse.player.name });

      // Resolve team membership (used for "My Team" even when player has no current match)
      try {
        const teamResp = (await api.fetch(`/api/players/${steamId}/team`, {
          method: 'GET',
          signal: controller.signal,
        })) as {
          success: boolean;
          team: AssignedTeam | null;
        };
        if (teamResp?.success) {
          setAssignedTeam(teamResp.team ?? null);
        } else {
          setAssignedTeam(null);
        }
      } catch {
        // Best-effort: don't fail the page if team lookup fails
        setAssignedTeam(null);
      }

      // Rating history
      setRatingHistory(
        (summaryResponse.ratingHistory || []).map((entry, index) => ({
          id: index,
          matchSlug: entry.match_slug,
          eloBefore: entry.elo_before,
          eloAfter: entry.elo_after,
          eloChange: entry.elo_change,
          baseEloAfter: entry.base_elo_after ?? null,
          statAdjustment: entry.stat_adjustment ?? null,
          templateId: entry.template_id ?? null,
          matchResult: entry.match_result,
          createdAt: entry.created_at,
        }))
      );

      // Match history
      setMatchHistory(
        (summaryResponse.matches || []).map((m) => ({
          slug: m.slug,
          round: m.round,
          matchNumber: m.match_number,
          status: m.status,
          completedAt: m.completed_at,
          tournamentId: m.tournamentId,
          team1Id: m.team1_id,
          team2Id: m.team2_id,
          winnerId: m.winner_id,
          game: m.game,
          team1Name: m.team1_name,
          team1Tag: m.team1_tag,
          team2Name: m.team2_name,
          team2Tag: m.team2_tag,
          team: m.team,
          wonMatch: m.won_match,
          adr: m.adr,
          totalDamage: m.total_damage,
          kills: m.kills,
          deaths: m.deaths,
          assists: m.assists,
          headshots: m.headshots,
          hasDemo: m.has_demo === true,
        }))
      );

      const loadedGames = summaryResponse.games || [];
      setGames(loadedGames);
      setSelectedGameId((prev) =>
        prev && loadedGames.some((g) => g.id === prev) ? prev : loadedGames[0]?.id ?? null
      );

      // Load current or upcoming match (for connect info)
      try {
        const currentMatchResponse = (await api.fetch(`/api/players/${steamId}/current-match`, {
          method: 'GET',
          signal: controller.signal,
        })) as {
          success: boolean;
          player: { id: string; name: string; avatar?: string };
          hasMatch: boolean;
          tournamentStatus?: string;
          match?: TeamMatchInfo;
        };

        if (
          currentMatchResponse.success &&
          currentMatchResponse.hasMatch &&
          currentMatchResponse.match
        ) {
          const rawMatch = currentMatchResponse.match;

          // Normalize match data so that, from the player's perspective on this page,
          // their own team is always treated as "team1" / left side in scoreboards and
          // performance tables. We derive the correct side by checking where this
          // steamId appears in live stats or config, and then swap both metadata and
          // live stats/map results if needed.
          const normalizedMatch: TeamMatchInfo = normalizeMatchForPlayerView(rawMatch, steamId);

          setCurrentMatch(normalizedMatch);
          setCurrentTournamentStatus(currentMatchResponse.tournamentStatus || 'setup');

          const yourTeam = normalizedMatch.team1 || null;
          const configPlayers =
            normalizedMatch.config?.team1?.players?.map(
              (p): TeamPlayer => ({ steamId: p.steamid, name: p.name })
            ) || [];

          setCurrentTeam(
            yourTeam
              ? {
                  id: yourTeam.id,
                  name: yourTeam.name,
                  tag: yourTeam.tag,
                  players: configPlayers,
                }
              : null
          );
        } else {
          setCurrentMatch(null);
          setCurrentTeam(null);
        }
      } catch {
        // Current match info is optional
        setCurrentMatch(null);
        setCurrentTeam(null);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Swallow aborts: a newer refresh has been scheduled.
        return;
      }
      setError(t('playerPage.loadFailed'));
      console.error(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  },
    [steamId, t]
  );

  const handleVetoComplete = React.useCallback(() => {
    // Give the backend a moment to persist veto completion + derived match state.
    window.setTimeout(() => {
      void loadPlayerData({ silent: true });
    }, 1000);
  }, [loadPlayerData]);

  const scheduleSilentRefresh = React.useCallback(() => {
    if (unmountedRef.current) return;
    if (silentRefreshTimerRef.current) return;
    // Preserve scroll position across "silent" refreshes so real-time updates
    // (and snackbars triggered by them) don't yank the user to the top.
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    // Coalesce bursts of websocket events into a single refresh to avoid UI "flashing".
    silentRefreshTimerRef.current = window.setTimeout(() => {
      silentRefreshTimerRef.current = null;
      void loadPlayerData({ silent: true }).finally(() => {
        // Restore on next paint(s) after DOM updates settle.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (typeof window !== 'undefined') {
              window.scrollTo({ top: scrollY, behavior: 'auto' });
            }
          });
        });
      });
    }, 150);
  }, [loadPlayerData]);

  useEffect(() => {
    if (!steamId) return;
    loadPlayerData();
    lastRefetchedMatchSlugRef.current = null;
    return () => {
      if (loadAbortControllerRef.current) {
        loadAbortControllerRef.current.abort();
        loadAbortControllerRef.current = null;
      }
    };
  }, [steamId, loadPlayerData]);

  // When match-status reports an active match (e.g. waiting_veto) and we're viewing our own
  // profile, refetch so current-match and veto UI appear without reload.
  useEffect(() => {
    if (!steamId || playerSteamId !== steamId) return;
    if (!statusMatchSlug) {
      lastRefetchedMatchSlugRef.current = null;
      return;
    }
    // Only refresh when match-status reveals a *different* match slug than the one we have.
    // Status changes (e.g. waiting_veto -> your_turn_veto) should not force a full page refresh.
    if (currentMatch?.slug && currentMatch.slug === statusMatchSlug) {
      return;
    }
    if (lastRefetchedMatchSlugRef.current === statusMatchSlug) return;
    lastRefetchedMatchSlugRef.current = statusMatchSlug;
    scheduleSilentRefresh();
  }, [steamId, playerSteamId, statusMatchSlug, currentMatch?.slug, scheduleSilentRefresh]);

  // Lazily create a shared Socket.IO connection for this page once per mount.
  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io();
    }

    const socket = socketRef.current;

    // React to high‑level tournament / bracket events (e.g. server_assigned,
    // match_loaded) by refreshing the player data. This keeps the page in sync
    // even if the match (or its server) is created after the player page is opened.
    const handleBracketOrTournamentUpdate = (event?: { action?: string | null; status?: string | null }) => {
      if (!event || !event.action) {
        // If we ever emit status-only updates without an action, treat them as refresh-worthy.
        if (event && typeof event.status === 'string' && event.status.trim() !== '') {
          scheduleSilentRefresh();
        }
        return;
      }

      const refreshActions = new Set([
        'tournament_reset',
        'tournament_started',
        'tournament_restarted',
        'tournament_completed',
        'bracket_regenerated',
        'match_loaded',
        'match_restarted',
        'server_assigned',
        'match_allocated',
        // Also refresh when rounds advance or match statuses change so the
        // player's ELO, match history, and "current match" card stay in sync
        // without requiring a manual page reload.
        'round_advanced',
      ]);

      if (refreshActions.has(event.action)) {
        scheduleSilentRefresh();
      }
    };

    // Every bracket event is a change to some match's state (ready, server
    // assigned, needs a decision, reallocated...). Filtering them against an
    // allowlist silently dropped the ones nobody had added yet (match_ready,
    // match_status, match_reallocated), so refresh on all of them; the
    // refresh is debounced.
    const handleBracketUpdate = () => scheduleSilentRefresh();

    socket.on('bracket:update', handleBracketUpdate);
    socket.on('tournament:update', handleBracketOrTournamentUpdate);
    // Events sent while the socket was down are gone; refetch on reconnect.
    const offReconnect = onSocketReconnect(socket, scheduleSilentRefresh);

    // Additionally, refresh the player summary whenever any match completes.
    // This ensures ELO, rating history, and match history update immediately
    // after the player's match finishes, even if there is no longer a
    // "currentMatch" slug to subscribe to.
    const handleAnyMatchUpdate = (data?: { status?: string | null }) => {
      if (!data || data.status !== 'completed') {
        return;
      }
      scheduleSilentRefresh();
    };

    socket.on('match:update', handleAnyMatchUpdate);

    return () => {
      unmountedRef.current = true;
      if (silentRefreshTimerRef.current) {
        window.clearTimeout(silentRefreshTimerRef.current);
        silentRefreshTimerRef.current = null;
      }
      if (!socket) return;
      offReconnect();
      socket.off('bracket:update', handleBracketUpdate);
      socket.off('tournament:update', handleBracketOrTournamentUpdate);
      socket.off('match:update', handleAnyMatchUpdate);
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to websocket match updates for the current match slug so that
  // server status, veto progress, and live stats stay in sync with the Team
  // Match page behaviour.
  useEffect(() => {
    const slug = currentMatch?.slug;
    if (!slug || !socketRef.current) {
      return;
    }

    const socket = socketRef.current;

    const handleUpdate = (data: { slug?: string }) => {
      if (!data.slug || data.slug !== slug) return;
      // Re‑fetch player data so currentMatch (and its nested server/veto/live
      // info) stay in lockstep with the team view.
      scheduleSilentRefresh();
    };

    socket.on('match:update', handleUpdate);
    socket.on(`match:update:${slug}`, handleUpdate);
    // Veto updates can happen without a match status change (especially at the
    // moment veto becomes available). Keep the player page in sync.
    socket.on(`veto:update:${slug}`, scheduleSilentRefresh);

    return () => {
      if (!socket) return;
      socket.off('match:update', handleUpdate);
      socket.off(`match:update:${slug}`, handleUpdate);
      socket.off(`veto:update:${slug}`, scheduleSilentRefresh);
      // Keep the socket open for reuse across slug changes; it will be fully
      // disconnected when there is no active match above.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatch?.slug]);

  // Poll allocation status periodically so players can see when the next servers
  // will be assigned for upcoming rounds/matches.
  useEffect(() => {
    const loadAllocationStatus = async () => {
      try {
        const availability = await api.get<{
          success: boolean;
          availableServerCount: number;
          gracePeriodSeconds?: number;
          nextAllocationInSeconds?: number | null;
        }>('/api/tournament/allocation-status');

        if (availability.success) {
          setAllocationCountdown({
            gracePeriodSeconds: availability.gracePeriodSeconds ?? 300,
            nextAllocationInSeconds:
              typeof availability.nextAllocationInSeconds === 'number'
                ? availability.nextAllocationInSeconds
                : null,
          });
        }
      } catch (err) {
        console.error('Failed to load allocation status for Player page:', err);
      }
    };

    void loadAllocationStatus();
    const interval = setInterval(() => {
      void loadAllocationStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Local per‑second countdown tick for this page
  useEffect(() => {
    if (
      allocationCountdown.nextAllocationInSeconds === null ||
      allocationCountdown.nextAllocationInSeconds <= 0
    ) {
      return;
    }

    const timer = setInterval(
      () =>
        setAllocationCountdown((prev) => ({
          ...prev,
          nextAllocationInSeconds:
            prev.nextAllocationInSeconds !== null && prev.nextAllocationInSeconds > 0
              ? prev.nextAllocationInSeconds - 1
              : 0,
        })),
      1000
    );

    return () => clearInterval(timer);
  }, [allocationCountdown.nextAllocationInSeconds]);


  if (loading) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="md">
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            minHeight="400px"
            py={6}
          >
            <CircularProgress />
          </Box>
        </Container>
      </Box>
    );
  }

  const isOwnUnregistered =
    steamId &&
    playerSteamId &&
    steamId === playerSteamId &&
    hasPlayerRecord === false;

  if (error || !player) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="sm">
          <Box py={6}>
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                {isOwnUnregistered ? (
                  <>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      {t('notRegistered.title')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                      {t('notRegistered.description')}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={2}
                      justifyContent="center"
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <Button
                        variant="contained"
                        component={RouterLink}
                        to="/player"
                        startIcon={<PersonSearchIcon />}
                        data-testid="player-profile-find-players"
                      >
                        {t('notRegistered.findPlayers')}
                      </Button>
                      <Button
                        variant="outlined"
                        component={RouterLink}
                        to="/tournament/1/leaderboard"
                        startIcon={<LeaderboardIcon />}
                        data-testid="player-profile-leaderboard"
                      >
                        {t('notRegistered.leaderboard')}
                      </Button>
                    </Stack>
                  </>
                ) : (
                  <>
                    <Alert severity="warning" sx={{ mb: 2 }} data-testid="player-not-found-error">
                      {t('playerPage.playerNotFound')}
                    </Alert>
                    <Button
                      variant="outlined"
                      component={RouterLink}
                      to="/player"
                      data-testid="player-profile-back-to-find"
                    >
                      {t('playerPage.backToFindPlayer')}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </Box>
        </Container>
      </Box>
    );
  }

  // Baseline row matches the "Starting ELO" the chart shows (see utils/eloProgression).
  const wins = uniqueMatchHistory.filter((m) => m.wonMatch).length;
  const losses = uniqueMatchHistory.length - wins;

  // Use the most recent match's tournament for leaderboard link (if available)
  const latestTournamentId = uniqueMatchHistory.find((m) => m.tournamentId)?.tournamentId;
  // What the tournament's module shows in place of the columns this page
  // leaves out, when its game measures nothing itself: manual reporting lists
  // the custom fields the tournament asked reporters for. CS2 leaves the slot
  // empty — its numbers are the rest of this page. Only for a player who has
  // played: someone with no matches has no part in those totals.
  const TournamentStatsView = gameIntegration.tournamentStatsView;
  const hasAnyMatches = uniqueMatchHistory.length > 0;

  // --- New profile header/stats/rating-chart/recent-matches section ---
  // Matches for whichever game the switch above has selected. Rows recorded
  // before the `game` column existed (or without a game module wired up to
  // stamp it) fall back to 'cs2', matching the API's own default.
  const FALLBACK_GAME_ID = 'cs2';
  const gameFilteredMatches = selectedGameId
    ? uniqueMatchHistory.filter((m) => (m.game || FALLBACK_GAME_ID) === selectedGameId)
    : uniqueMatchHistory;

  const profileMatchCount = gameFilteredMatches.length;
  const profileWins = gameFilteredMatches.filter((m) => m.wonMatch).length;
  const profileWinRatePct =
    profileMatchCount > 0 ? Math.round((profileWins / profileMatchCount) * 100) : null;

  const adrSamples = gameFilteredMatches.filter((m) => typeof m.adr === 'number');
  const profileAvgAdr =
    adrSamples.length > 0
      ? adrSamples.reduce((sum, m) => sum + (m.adr as number), 0) / adrSamples.length
      : null;

  const kdSamples = gameFilteredMatches.filter(
    (m) => typeof m.kills === 'number' && typeof m.deaths === 'number'
  );
  const totalKills = kdSamples.reduce((sum, m) => sum + (m.kills as number), 0);
  const totalDeaths = kdSamples.reduce((sum, m) => sum + (m.deaths as number), 0);
  const profileKd = kdSamples.length > 0 && totalDeaths > 0 ? totalKills / totalDeaths : null;

  // Rating change over the same last-N-matches window the rating chart plots.
  const ratingChartWindow = 20;
  const sortedRatingHistoryAsc = [...ratingHistory].sort((a, b) => a.createdAt - b.createdAt);
  const recentRatingHistory = sortedRatingHistoryAsc.slice(-ratingChartWindow);
  const profileRatingChange =
    player && recentRatingHistory.length > 0
      ? player.currentElo - recentRatingHistory[0].eloBefore
      : undefined;

  const profileStats: ProfileStat[] = player
    ? [
        {
          key: 'rating',
          label: t('playerPage.stats.rating'),
          value: String(player.currentElo),
          change: profileRatingChange,
        },
        { key: 'matches', label: t('playerPage.stats.matches'), value: String(profileMatchCount) },
        ...(profileWinRatePct !== null
          ? [{ key: 'win-rate', label: t('playerPage.stats.winRate'), value: `${profileWinRatePct}%` }]
          : []),
        ...(showGameStats && profileAvgAdr !== null
          ? [{ key: 'adr', label: t('playerPage.stats.adr'), value: profileAvgAdr.toFixed(1) }]
          : []),
        ...(showGameStats && profileKd !== null
          ? [{ key: 'kd', label: t('playerPage.stats.kd'), value: profileKd.toFixed(2) }]
          : []),
        // TITLES (tournaments won) intentionally omitted: not derivable from
        // existing data without new backend logic, and we never show a made-up
        // number.
      ]
    : [];

  const profileGames = games;

  const headerTeamName = assignedTeam?.name || currentTeam?.name;
  const headerTeam = headerTeamName
    ? {
        id: assignedTeam?.id || currentTeam?.id,
        name: headerTeamName,
        tag: assignedTeam?.tag || currentTeam?.tag,
      }
    : null;

  const isOwnProfile = !!steamId && playerSteamId === steamId && !impersonation;

  const recentMatchEntries: RecentMatchEntry[] = gameFilteredMatches.map((m) => {
    const isTeam1 = m.team === 'team1';
    const opponentName = isTeam1
      ? m.team2Name || t('playerPage.opponent')
      : m.team1Name || t('playerPage.opponent');
    return {
      slug: m.slug,
      wonMatch: m.wonMatch,
      opponentName,
      roundLabel: getRoundLabel(m.round),
      ratingAfter: ratingBySlug.get(m.slug),
      // Only a game that records demos, and only a match that has one: no
      // download button that leads nowhere.
      hasDemo: showDemos && m.hasDemo === true,
      ...(showGameStats ? { kills: m.kills, deaths: m.deaths } : {}),
    };
  });
  // The rating trend starts at the player's starting rating, so the first
  // match already draws a line (the old ELO chart did the same).
  const ratingChartHistory =
    ratingHistory.length > 0
      ? [
          {
            eloAfter: ratingHistoryBaseline(player.startingElo),
            createdAt: Math.min(...ratingHistory.map((e) => e.createdAt)) - 1,
          },
          ...ratingHistory.map((entry) => ({ eloAfter: entry.eloAfter, createdAt: entry.createdAt })),
        ]
      : [];
  // --- end new profile section ---

  const tournamentIsActive = currentTournamentStatus === 'in_progress';
  const tournamentIsCompleted = currentTournamentStatus === 'completed';

  // Compute sound triggers for the player's current match
  const playerMatchFormat =
    (currentMatch?.matchFormat as 'bo1' | 'bo3' | 'bo5' | undefined) || 'bo1';
  const playerVetoCompleted =
    currentMatch?.round === 0 ? true : currentMatch?.veto?.status === 'completed';
  const isEligibleFormatForSound = ['bo1', 'bo3', 'bo5'].includes(playerMatchFormat);
  const vetoReadyForPlayer =
    !!currentMatch &&
    currentTournamentStatus === 'in_progress' &&
    currentMatch.status === 'pending' &&
    !playerVetoCompleted &&
    isEligibleFormatForSound &&
    currentMatch.veto?.status !== 'completed';
  const serverReadyForPlayer =
    !!currentMatch &&
    Boolean(currentMatch.server) &&
    (currentMatch.status === 'loaded' || currentMatch.status === 'live');

  // Tournament rules configuration for the "About this tournament" accordion on the player page.
  const rulesFormatForPlayer = playerMatchFormat;
  const rulesMaxRoundsForPlayer = currentMatch?.config?.maxRounds;
  const rulesOvertimeModeForPlayer = currentMatch?.config?.overtimeMode;
  const rulesOvertimeSegmentsForPlayer = currentMatch?.config?.overtimeSegments;

  // Recent form timeline: last N matches as W/L, ordered oldest -> newest so it
  // visually progresses like Round 1, Round 2, Round 3, ...
  const maxRecentTimelineMatches = 20;
  const recentMatches = [...uniqueMatchHistory].sort(
    (a, b) => (a.completedAt || 0) - (b.completedAt || 0)
  );
  const recentTimelineMatches = recentMatches.slice(-maxRecentTimelineMatches);

  // Best and toughest matches by ADR
  let bestAdrMatch: MatchHistoryEntry | null = null;
  let worstAdrMatch: MatchHistoryEntry | null = null;
  for (const m of recentMatches) {
    // No ADR, or 0 (a result set by an admin or reported by hand records no
    // damage): not a "best" or "toughest" match, just no data.
    if (typeof m.adr !== 'number' || m.adr <= 0) continue;
    if (!bestAdrMatch || (bestAdrMatch.adr ?? 0) < m.adr) {
      bestAdrMatch = m;
    }
    if (!worstAdrMatch || (worstAdrMatch.adr ?? Infinity) > m.adr) {
      worstAdrMatch = m;
    }
  }

  return (
    <Box
      minHeight="100vh"
      bgcolor="transparent"
      data-testid="public-player-page"
    >
      <TopNavBar />
      <Container maxWidth="md">
        <Box py={6}>
        <Stack spacing={3}>
          <MatchNotificationAudio
            vetoReady={vetoReadyForPlayer}
            serverReady={serverReadyForPlayer}
            isMuted={isMuted}
            volume={volume}
            soundFile={soundFile}
          />
          {/* Public profile header: avatar, name, plays/joined, team, edit link */}
          <ProfileHeader
            playerId={player.id}
            name={player.name}
            avatarUrl={player.avatar}
            isAdmin={player.isAdmin}
            joinedAt={player.createdAt}
            team={headerTeam}
            isOwnProfile={isOwnProfile}
          />

          <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
            {latestTournamentId && (
              <Button
                data-testid="profile-tournament-leaderboard"
                variant="outlined"
                size="small"
                startIcon={<EmojiEventsIcon />}
                onClick={() => window.open(`/tournament/${latestTournamentId}/leaderboard`, '_blank')}
              >
                {t('playerPage.viewTournamentLeaderboard')}
              </Button>
            )}
            {allocationCountdown.nextAllocationInSeconds !== null &&
              allocationCountdown.nextAllocationInSeconds > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('playerPage.nextServersAllocated', {
                    seconds: Math.max(0, allocationCountdown.nextAllocationInSeconds),
                  })}
                </Typography>
              )}
          </Box>

          {/* The player's current match (veto, connect) comes first: it is
              what the nav bar's "Your turn in veto" button brings them here
              for, and below the stats and settings cards it was five screens
              down on a phone. */}
          {currentMatch && (
            <>
              <TournamentRulesAccordion
                format={rulesFormatForPlayer}
                maxRounds={rulesMaxRoundsForPlayer}
                overtimeMode={rulesOvertimeModeForPlayer}
                overtimeSegments={rulesOvertimeSegmentsForPlayer}
              />
              <MatchInfoCard
                match={currentMatch}
                team={currentTeam}
                tournamentStatus={currentTournamentStatus}
                vetoCompleted={currentMatch.veto?.status === 'completed'}
                matchFormat={(currentMatch.matchFormat as 'bo1' | 'bo3' | 'bo5') || 'bo1'}
                onVetoComplete={handleVetoComplete}
                getRoundLabel={getRoundLabel}
                highlightPlayerId={player.id}
                // Only allow veto and server controls on the player page when the
                // signed‑in Steam ID matches the profile being viewed. Teammates
                // visiting this URL can still *see* the page, but cannot drive
                // the veto or connect for someone else.
                viewerIsTeamMemberOverride={playerSteamId === steamId}
              />
            </>
          )}

          {/* Per-game switch: which game's stats/rating/matches are shown below. */}
          <GameSwitch
            games={profileGames}
            selectedId={selectedGameId ?? ''}
            onSelect={setSelectedGameId}
          />

          {/* Stats: RATING (+change), MATCHES, WIN RATE, and ADR, K/D for a
              game that measures them. TITLES omitted (not derivable from
              existing data). Tiles without real data are never rendered — see
              profileStats above. */}
          <StatsGrid stats={profileStats} />

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Card>
                <CardContent>
                  <Typography variant="h5" component="h2" gutterBottom>
                    {t('playerPage.ratingChart.sectionTitle')}
                  </Typography>
                  <RatingChart
                    history={ratingChartHistory}
                  />
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={1}>
                <Typography variant="h5" component="h2">
                  {t('playerPage.recentMatches.title')}
                </Typography>
              </Box>
              <RecentMatches
                matches={recentMatchEntries}
                showStatsNote={showGameStats}
                onSelect={(slug) => {
                  const match = uniqueMatchHistory.find((m) => m.slug === slug);
                  if (match) setSelectedMatch(match);
                }}
              />
            </Grid>
          </Grid>

          {/* Self-service contact details: only on the viewer's own profile, and not
              while an admin impersonates (playerSteamId is then the impersonated
              player, and the API refuses the request anyway). */}
          {steamId && playerSteamId === steamId && !impersonation && (
            <>
              <OwnGamesCard />
              <OwnDiscordIdCard steamId={steamId} />
            </>
          )}

          {!currentMatch && (
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <SportsEsportsIcon sx={{ fontSize: 56, color: 'text.secondary', mb: 2 }} />
                {tournamentIsCompleted && hasAnyMatches ? (
                  <>
                    <Typography variant="body1" color="text.secondary">
                      {t('playerPage.tournamentFinishedNoMatches')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      {t('playerPage.finalRecord', { wins, losses })}
                    </Typography>
                  </>
                ) : tournamentIsActive && hasAnyMatches ? (
                  <>
                    <Typography variant="body1" color="text.secondary">
                      {t('playerPage.noUpcomingMatch')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      {t('playerPage.noUpcomingHint')}
                    </Typography>
                  </>
                ) : (
                  <>
                    <Typography variant="body1" color="text.secondary">
                      {t('playerPage.noActiveMatch')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      {t('playerPage.noActiveHint')}
                    </Typography>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Recent form and performance highlights: kept as detailed sections
              below the new stats grid above (see StatsGrid), rather than
              dropped — they show highlights (best/toughest ADR match) and a
              longer W/L timeline the new compact tiles don't cover. */}
          {hasAnyMatches && (
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} gutterBottom textAlign="center">
                  {t('playerPage.recentFormHighlights')}
                </Typography>

                {/* ADR highlights centered above timeline. A match of a game
                    that measures no damage has no ADR — not an "N/A" one. */}
                {showGameStats && (
                <Box display="flex" justifyContent="center" gap={4} mb={3} flexWrap="wrap">
                  {bestAdrMatch && (
                    <Box textAlign="center">
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        {t('playerPage.bestAdr')}
                      </Typography>
                      <Typography variant="body2">
                        {t('playerPage.bestAdrIn', {
                          adr:
                            typeof bestAdrMatch.adr === 'number'
                              ? bestAdrMatch.adr.toFixed(1)
                              : 'N/A',
                          round: getRoundLabel(bestAdrMatch.round),
                        })}
                      </Typography>
                    </Box>
                  )}
                  {worstAdrMatch && (
                    <Box textAlign="center">
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        {t('playerPage.toughestAdr')}
                      </Typography>
                      <Typography variant="body2">
                        {t('playerPage.bestAdrIn', {
                          adr:
                            typeof worstAdrMatch.adr === 'number'
                              ? worstAdrMatch.adr.toFixed(1)
                              : 'N/A',
                          round: getRoundLabel(worstAdrMatch.round),
                        })}
                      </Typography>
                    </Box>
                  )}
                </Box>
                )}

                {/* Full-width recent form timeline */}
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {t('playerPage.recentForm', { count: maxRecentTimelineMatches })}
                  </Typography>
                  {recentTimelineMatches.length > 0 ? (
                    <Box position="relative" mt={2} px={1}>
                      {/* Centered horizontal timeline */}
                      <Box
                        sx={{
                          position: 'absolute',
                          top: '50%',
                          left: 0,
                          right: 0,
                          height: 2,
                          bgcolor: 'divider',
                          transform: 'translateY(-50%)',
                        }}
                      />
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        position="relative"
                        width="100%"
                      >
                        {Array.from({ length: maxRecentTimelineMatches }).map((_, index) => {
                          const match = recentTimelineMatches[index];
                          const isPlayed = !!match;
                          const isWin = match?.wonMatch ?? false;
                          const color = isPlayed
                            ? isWin
                              ? 'success.main'
                              : 'error.main'
                            : 'action.disabledBackground';
                          const label = isPlayed ? (isWin ? 'W' : 'L') : '';

                          const handleClick = () => {
                            if (match) {
                              setSelectedMatch(match);
                            }
                          };

                          let tooltipTitle: string | undefined;
                          if (match) {
                            const isTeam1 = match.team === 'team1';
                            const opponentName = isTeam1
                              ? match.team2Name || t('playerPage.opponent')
                              : match.team1Name || t('playerPage.opponent');
                            const vsLabel = `${t('teamMatchHistory.vs')} ${opponentName}`;
                            tooltipTitle = `${vsLabel} — ${getRoundLabel(match.round)}`;
                          }

                          const bubble = (
                            <Box
                              key={match ? match.slug : `empty-${index}`}
                              onClick={isPlayed ? handleClick : undefined}
                              sx={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                bgcolor: color,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                // Dark ink on the bright win/loss colours
                                color: tokens.color.accentInk,
                                ...mono,
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: isPlayed ? 'pointer' : 'default',
                              }}
                            >
                              {label}
                            </Box>
                          );

                          return tooltipTitle ? (
                            <Tooltip key={match.slug} title={tooltipTitle}>
                              {bubble}
                            </Tooltip>
                          ) : (
                            bubble
                          );
                        })}
                      </Box>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('playerPage.noMatchesYet')}
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          )}

          {/* Performance Metrics Chart. Kills, deaths, assists and ADR over
              time — nothing to plot for a game that measures none of them. */}
          {showGameStats && uniqueMatchHistory.length > 0 && (
            <PerformanceMetricsChart
              matchHistory={uniqueMatchHistory.map((match) => ({
                adr: match.adr,
                kills: match.kills,
                deaths: match.deaths,
                assists: match.assists,
                createdAt: match.completedAt || 0,
              }))}
            />
          )}

          {TournamentStatsView && gameTournamentId !== null && hasAnyMatches && (
            <TournamentStatsView tournamentId={gameTournamentId} />
          )}

          {(assignedTeam || (currentTeam && currentTeam.players?.length)) && (
            <Card data-testid="public-player-my-team">
              <CardContent>
                <Box
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  gap={2}
                  flexWrap="wrap"
                  mb={2}
                >
                  <Typography variant="h6" fontWeight={600}>
                    {t('playerPage.myTeam')}
                  </Typography>
                  {(assignedTeam?.id || currentTeam?.id) &&
                    (assignedTeam?.id || currentTeam?.id) !== 'team1' &&
                    (assignedTeam?.id || currentTeam?.id) !== 'team2' && (
                      <Chip
                        size="small"
                        variant="outlined"
                        color="secondary"
                        label={t('playerPage.openTeam', {
                          team: `${assignedTeam?.tag || currentTeam?.tag ? `[${assignedTeam?.tag || currentTeam?.tag}] ` : ''}${
                            assignedTeam?.name || currentTeam?.name || ''
                          }`,
                        })}
                        component={RouterLink}
                        to={teamProfilePath((assignedTeam?.id || currentTeam?.id) as string)}
                        clickable
                        sx={{ fontWeight: 600 }}
                      />
                    )}
                </Box>

                <Grid container spacing={2}>
                  {(assignedTeam?.players ||
                    currentTeam?.players?.map((p) => ({
                      steamId: p.steamId,
                      name: p.name,
                      avatar: (p as unknown as { avatar?: string }).avatar,
                    })) ||
                    []
                  ).map((p) => (
                    <Grid key={p.steamId} size={{ xs: 12, sm: 6 }}>
                      <Box
                        component={RouterLink}
                        to={`/player/${p.steamId}`}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 2,
                          textDecoration: 'none',
                          color: 'inherit',
                          p: 1,
                          borderRadius: radii.sm,
                          '&:hover': {
                            bgcolor: 'action.hover',
                          },
                        }}
                      >
                        <PlayerAvatar
                          id={p.steamId}
                          name={p.name}
                          avatarUrl={p.avatar}
                          size={36}
                          isAdmin={false}
                        />
                        <Box flex={1} minWidth={0}>
                          <Typography variant="body2" fontWeight={700} noWrap>
                            {p.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {p.steamId}
                          </Typography>
                        </Box>
                        {/* playerSteamId is the viewer's Steam ID (the impersonated player
                            while impersonating), so an admin looking at someone else's
                            profile does not see "You" on that player. */}
                        {!!playerSteamId && p.steamId === playerSteamId && (
                          <Chip size="small" color="primary" label={t('playerPage.you')} />
                        )}
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          )}

          {uniqueMatchHistory.length === 0 && ratingHistory.length === 0 && (
            <Card>
              <CardContent>
                <Box textAlign="center" py={4}>
                  <SportsEsportsIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="body1" color="text.secondary">
                    {t('playerPage.noMatchHistory')}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          )}
          {selectedMatch && (
            <PlayerMatchDetailsModal
              open={!!selectedMatch}
              matchSlug={selectedMatch.slug}
              round={selectedMatch.round}
              matchNumber={selectedMatch.matchNumber}
              onClose={() => setSelectedMatch(null)}
            />
          )}
        </Stack>
        </Box>
      </Container>
    </Box>
  );
}
