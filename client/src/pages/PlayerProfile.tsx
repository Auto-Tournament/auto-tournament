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
  Button,
} from '@mui/material';
import { RankingIcon, UserFocusIcon } from '@phosphor-icons/react';
import { api } from '../utils/api';
import { onSocketReconnect } from '../utils/socketResync';
import { io, Socket } from 'socket.io-client';
import { MatchInfoCard } from '../components/team/MatchInfoCard';
import { PlayerMatchDetailsModal } from '../components/player/PlayerMatchDetailsModal';
import { useSoundSettings } from '../hooks/useSoundSettings';
import { MatchNotificationAudio } from '../components/match/MatchNotificationAudio';
import { TopNavBar } from '../components/layout/TopNavBar';
import { OwnDiscordIdCard } from '../components/player/OwnDiscordIdCard';
import { OwnGamesCard } from '../components/games/OwnGamesCard';
import { ProfileHeader } from '../components/player/profile/ProfileHeader';
import { GameSwitch } from '../components/player/profile/GameSwitch';
import { FactGrid, Panel, SectionHead, type Fact } from '../components/common/ui';
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
import { textSize, tokens } from '../theme/tokens';
import { paths } from '../paths';
import { pageTitle } from '../utils/pageTitle';

interface RatingHistoryEntry {
  /** Stable per row: the slug, or the row's position for a deleted match. */
  key: string;
  /** Null when the tournament was deleted: the history (and rating) is kept. */
  matchSlug: string | null;
  /** "Team A vs Team B", stored on the row so it outlives the match. */
  matchLabel: string | null;
  tournamentName: string | null;
  /** The game the match was played under; null for old rows of deleted matches. */
  game: string | null;
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

/**
 * Rows recorded before the `game` column existed (or without a game module
 * wired up to stamp it) count under CS2, matching the API's own default.
 */
const FALLBACK_GAME_ID = 'cs2';

/** How many matches the rating chart plots, and the rating change covers. */
const RATING_CHART_WINDOW = 20;

/**
 * Public player profile (`/player/:steamId`), the 3.0 draft's `profile.html`:
 * header, game switch, one joined stat grid, then Rating and Recent matches in
 * two columns.
 *
 * The stats are the player's across the whole site in the selected game: the
 * match history, plus the rated matches of deleted tournaments that only the
 * rating history still has. Counting the stats rows alone showed "0 matches"
 * for a player whose tournament had been deleted.
 *
 * The player's own current match (veto, connect) stays at the top of their own
 * view only: the nav bar's match button brings them here for it. Nobody else
 * sees it, and nobody sees a countdown or an empty "no match" card.
 */
export default function PlayerProfile() {
  type AssignedTeam = {
    id: string;
    name: string;
    tag?: string;
    role?: 'captain' | 'member' | null;
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

  // Rating history rows by match slug: the rating after the match, and the
  // tournament's name, for the recent-matches rows.
  const ratingBySlug = React.useMemo(() => {
    const map = new Map<string, RatingHistoryEntry>();
    for (const entry of ratingHistory) {
      if (entry.matchSlug) map.set(entry.matchSlug, entry);
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
        ratingHistory: Array<{
          match_slug: string | null;
          match_label?: string | null;
          tournament_name?: string | null;
          game?: string | null;
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

      // Load aggregated player summary (details + history + matches)
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
      document.title = pageTitle(t('playerPage.pageTitle', { name: summaryResponse.player.name }));

      // The team for the header chip, even when the player has no current match.
      try {
        const teamResp = (await api.fetch(`/api/players/${steamId}/team`, {
          method: 'GET',
          signal: controller.signal,
        })) as {
          success: boolean;
          team: AssignedTeam | null;
        };
        setAssignedTeam(teamResp?.success ? teamResp.team ?? null : null);
      } catch {
        // Best-effort: don't fail the page if team lookup fails
        setAssignedTeam(null);
      }

      setRatingHistory(
        (summaryResponse.ratingHistory || []).map((entry, index) => ({
          key: entry.match_slug ?? `archived-${index}`,
          matchSlug: entry.match_slug,
          matchLabel: entry.match_label ?? null,
          tournamentName: entry.tournament_name ?? null,
          game: entry.game ?? null,
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

      // The current or upcoming match (veto, connect): only the player's own
      // view shows it, so only that view asks.
      if (playerSteamId !== steamId) {
        setCurrentMatch(null);
        setCurrentTeam(null);
        return;
      }
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
          // Normalize match data so that, from the player's perspective on this page,
          // their own team is always treated as "team1" / left side in scoreboards and
          // performance tables.
          const normalizedMatch: TeamMatchInfo = normalizeMatchForPlayerView(
            currentMatchResponse.match,
            steamId
          );

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
    [steamId, playerSteamId, t]
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
        // player's rating, match history, and own match stay in sync
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

    // Additionally, refresh the player summary whenever any match completes,
    // so the rating and match history update right after the player's match
    // finishes, even if there is no longer a current match to subscribe to.
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
  // server status, veto progress, and live stats stay in sync with the team
  // match page.
  useEffect(() => {
    const slug = currentMatch?.slug;
    if (!slug || !socketRef.current) {
      return;
    }

    const socket = socketRef.current;

    const handleUpdate = (data: { slug?: string }) => {
      if (!data.slug || data.slug !== slug) return;
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatch?.slug]);

  if (loading) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="lg">
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
                        startIcon={<UserFocusIcon />}
                        data-testid="player-profile-find-players"
                      >
                        {t('notRegistered.findPlayers')}
                      </Button>
                      <Button
                        variant="outlined"
                        component={RouterLink}
                        to="/tournament/1/leaderboard"
                        startIcon={<RankingIcon />}
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

  // The viewer is this player (an admin impersonating them included): only
  // then is their current match, with its veto and connect, on the page.
  const viewerIsPlayer = !!steamId && playerSteamId === steamId;
  // Their own profile, as themselves: the edit link and the self-service cards.
  const isOwnProfile = viewerIsPlayer && !impersonation;

  // Use the most recent match's tournament for the leaderboard link (if any).
  const latestTournamentId = uniqueMatchHistory.find((m) => m.tournamentId)?.tournamentId;
  // What the tournament's module shows in place of the columns this page
  // leaves out, when its game measures nothing itself: manual reporting lists
  // the custom fields the tournament asked reporters for. CS2 leaves the slot
  // empty — its numbers are the rest of this page. Only for a player who has
  // played: someone with no matches has no part in those totals.
  const TournamentStatsView = gameIntegration.tournamentStatsView;
  const hasAnyMatches = uniqueMatchHistory.length > 0;

  // --- Stats for the selected game, across the whole site ------------------
  const inSelectedGame = (game: string | null | undefined) =>
    !selectedGameId || (game || FALLBACK_GAME_ID) === selectedGameId;
  const gameFilteredMatches = uniqueMatchHistory.filter((m) => inSelectedGame(m.game));
  // Rated matches whose match row is gone (the tournament was deleted): no
  // stats row is left for them, but they were played, won or lost.
  const knownSlugs = new Set(uniqueMatchHistory.map((m) => m.slug));
  const archivedMatches = ratingHistory.filter(
    (entry) => (!entry.matchSlug || !knownSlugs.has(entry.matchSlug)) && inSelectedGame(entry.game)
  );

  const profileMatchCount = gameFilteredMatches.length + archivedMatches.length;
  const profileWins =
    gameFilteredMatches.filter((m) => m.wonMatch).length +
    archivedMatches.filter((entry) => entry.matchResult === 'win').length;
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
  const sortedRatingHistoryAsc = [...ratingHistory].sort((a, b) => a.createdAt - b.createdAt);
  const recentRatingHistory = sortedRatingHistoryAsc.slice(-RATING_CHART_WINDOW);
  const profileRatingChange =
    recentRatingHistory.length > 0 ? player.currentElo - recentRatingHistory[0].eloBefore : 0;

  // RATING (+change), MATCHES, WIN RATE, and ADR and K/D for a game that
  // measures them. TITLES is left out: no record of tournaments won survives
  // on the site, and the grid never shows a made-up number.
  const profileStats: Fact[] = [
    {
      key: 'rating',
      'data-testid': 'public-player-elo',
      label: t('playerPage.stats.rating'),
      value: (
        <>
          {player.currentElo}
          {profileRatingChange !== 0 && (
            <Box
              component="small"
              sx={{
                fontFamily: 'inherit',
                fontSize: textSize.xs,
                fontWeight: 500,
                ml: 0.75,
                color: profileRatingChange > 0 ? tokens.color.live : tokens.color.ban,
              }}
            >
              {profileRatingChange > 0 ? '+' : ''}
              {profileRatingChange}
            </Box>
          )}
        </>
      ),
    },
    {
      key: 'matches',
      'data-testid': 'profile-stat-matches',
      label: t('playerPage.stats.matches'),
      value: profileMatchCount,
    },
    ...(profileWinRatePct !== null
      ? [
          {
            key: 'win-rate',
            'data-testid': 'profile-stat-win-rate',
            label: t('playerPage.stats.winRate'),
            value: `${profileWinRatePct}%`,
          },
        ]
      : []),
    ...(showGameStats && profileAvgAdr !== null
      ? [
          {
            key: 'adr',
            'data-testid': 'profile-stat-adr',
            label: t('playerPage.stats.adr'),
            value: profileAvgAdr.toFixed(1),
          },
        ]
      : []),
    ...(showGameStats && profileKd !== null
      ? [
          {
            key: 'kd',
            'data-testid': 'profile-stat-kd',
            label: t('playerPage.stats.kd'),
            value: profileKd.toFixed(2),
          },
        ]
      : []),
  ];

  const headerTeamName = assignedTeam?.name || currentTeam?.name;
  const headerTeam = headerTeamName
    ? {
        id: assignedTeam?.id || currentTeam?.id,
        name: headerTeamName,
        tag: assignedTeam?.tag || currentTeam?.tag,
        role: assignedTeam?.role ?? null,
      }
    : null;

  // Recent matches: the match history, and the archived rated matches with
  // the labels their history rows kept, newest first.
  const recentMatchEntries: RecentMatchEntry[] = [
    ...gameFilteredMatches.map((m) => {
      const isTeam1 = m.team === 'team1';
      const opponentName = isTeam1
        ? m.team2Name || t('playerPage.opponent')
        : m.team1Name || t('playerPage.opponent');
      const rating = ratingBySlug.get(m.slug);
      return {
        at: m.completedAt || rating?.createdAt || 0,
        entry: {
          key: m.slug,
          slug: m.slug,
          wonMatch: m.wonMatch,
          title: `${t('teamMatchHistory.vs')} ${opponentName}`,
          detail: [rating?.tournamentName, getRoundLabel(m.round)].filter(Boolean).join(' · '),
          ratingAfter: rating?.eloAfter,
          // Only a game that records demos, and only a match that has one: no
          // download button that leads nowhere.
          hasDemo: showDemos && m.hasDemo === true,
          ...(showGameStats ? { kills: m.kills, deaths: m.deaths } : {}),
        } satisfies RecentMatchEntry,
      };
    }),
    ...archivedMatches.map((entry) => ({
      at: entry.createdAt,
      entry: {
        key: entry.key,
        slug: null,
        wonMatch: entry.matchResult === 'win',
        title: entry.matchLabel || t('playerPage.opponent'),
        detail: entry.tournamentName || '',
        ratingAfter: entry.eloAfter,
      } satisfies RecentMatchEntry,
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .map(({ entry }) => entry);

  // The rating trend starts at the player's starting rating, so the first
  // match already draws a line.
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

  // Sound cues for the player's own current match.
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

  const ownMatch = viewerIsPlayer ? currentMatch : null;

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="public-player-page">
      <TopNavBar />
      <Container maxWidth="lg">
        <Box sx={{ py: { xs: 4, md: 6 } }}>
          {ownMatch && (
            <MatchNotificationAudio
              vetoReady={vetoReadyForPlayer}
              serverReady={serverReadyForPlayer}
              isMuted={isMuted}
              volume={volume}
              soundFile={soundFile}
            />
          )}

          <ProfileHeader
            playerId={player.id}
            name={player.name}
            avatarUrl={player.avatar}
            isAdmin={player.isAdmin}
            joinedAt={player.createdAt}
            team={headerTeam}
            isOwnProfile={isOwnProfile}
          />

          {/* The player's own match (veto, connect), first: it is what the
              nav bar's match button brings them here for. */}
          {ownMatch && (
            <Box component="section" aria-labelledby="profile-own-match" sx={{ mt: 6 }}>
              <SectionHead id="profile-own-match" title={t('playerPage.yourMatch')} />
              <MatchInfoCard
                match={ownMatch}
                team={currentTeam}
                tournamentStatus={currentTournamentStatus}
                vetoCompleted={ownMatch.veto?.status === 'completed'}
                matchFormat={(ownMatch.matchFormat as 'bo1' | 'bo3' | 'bo5') || 'bo1'}
                onVetoComplete={handleVetoComplete}
                getRoundLabel={getRoundLabel}
                highlightPlayerId={player.id}
                viewerIsTeamMemberOverride
              />
            </Box>
          )}

          {/* Which game the stats below describe. */}
          <Box sx={{ mt: 6, mb: 3 }}>
            <GameSwitch
              games={games}
              selectedId={selectedGameId ?? ''}
              onSelect={setSelectedGameId}
            />
          </Box>

          {/* auto-fit: the tiles there are fill the row, with no empty cells
              after them when a game measures fewer than six things. */}
          <FactGrid
            items={profileStats}
            aria-label={t('playerPage.stats.label')}
            data-testid="profile-stats-grid"
            sx={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}
          />

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.4fr) minmax(0, 1fr)' },
              gap: 4,
              mt: 6,
              alignItems: 'start',
            }}
          >
            <Box component="section" aria-labelledby="profile-rating">
              <SectionHead
                id="profile-rating"
                title={t('playerPage.ratingChart.sectionTitle')}
                action={
                  <Typography component="span" sx={{ color: tokens.color.muted, fontSize: textSize.sm }}>
                    {t('playerPage.ratingChart.window', { count: RATING_CHART_WINDOW })}
                  </Typography>
                }
              />
              <Panel sx={{ p: 3 }}>
                <RatingChart history={ratingChartHistory} limit={RATING_CHART_WINDOW} />
              </Panel>
            </Box>

            <Box component="section" aria-labelledby="profile-recent">
              <SectionHead
                id="profile-recent"
                title={t('playerPage.recentMatches.title')}
                link={
                  latestTournamentId
                    ? {
                        to: paths.tournamentLeaderboard.replace(':id', String(latestTournamentId)),
                        label: t('playerPage.recentMatches.leaderboard'),
                        'data-testid': 'profile-tournament-leaderboard',
                      }
                    : undefined
                }
              />
              <RecentMatches
                matches={recentMatchEntries}
                showStatsNote={showGameStats && gameFilteredMatches.length > 0}
                onSelect={(slug) => {
                  const match = uniqueMatchHistory.find((m) => m.slug === slug);
                  if (match) setSelectedMatch(match);
                }}
              />
            </Box>
          </Box>

          {TournamentStatsView && gameTournamentId !== null && hasAnyMatches && (
            <Box sx={{ mt: 6 }}>
              <TournamentStatsView tournamentId={gameTournamentId} />
            </Box>
          )}

          {/* Self-service contact details: only on the viewer's own profile, and not
              while an admin impersonates (playerSteamId is then the impersonated
              player, and the API refuses the request anyway). */}
          {isOwnProfile && steamId && (
            <Stack spacing={3} sx={{ mt: 6 }}>
              <OwnGamesCard />
              <OwnDiscordIdCard steamId={steamId} />
            </Stack>
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
        </Box>
      </Container>
    </Box>
  );
}
