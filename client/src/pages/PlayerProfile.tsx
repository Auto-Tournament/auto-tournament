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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Tooltip,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { api } from '../utils/api';
import { io, Socket } from 'socket.io-client';
import { ELOProgressionChart } from '../components/player/ELOProgressionChart';
import { PerformanceMetricsChart } from '../components/player/PerformanceMetricsChart';
import { MatchInfoCard } from '../components/team/MatchInfoCard';
import { PlayerMatchDetailsModal } from '../components/player/PlayerMatchDetailsModal';
import { useSoundSettings } from '../hooks/useSoundSettings';
import { MatchNotificationAudio } from '../components/match/MatchNotificationAudio';
import { PlayerNavBar } from '../components/layout/PlayerNavBar';
import { TournamentRulesAccordion } from '../components/tournament/TournamentRulesAccordion';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { PlayerName } from '../components/player/PlayerName';
import type { PlayerDetail } from '../types/api.types';
import { useAuth } from '../contexts/AuthContext';
import type {
  Team,
  TeamMatchInfo,
  MatchConnectionStatus,
  MatchMapResult,
  Player as TeamPlayer,
} from '../types';

interface RatingHistoryEntry {
  id: number;
  matchSlug: string;
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
}

function normalizeMatchForPlayerView(rawMatch: TeamMatchInfo, steamId: string): TeamMatchInfo {
  const playerId = steamId.toLowerCase();

  // Try to detect which side this player is on from live stats first (most reliable in‑match).
  let playerSide: 'team1' | 'team2' | null = null;
  const stats = rawMatch.liveStats?.playerStats;
  if (stats) {
    const inTeam1 = stats.team1.some((p) => p.steamId === steamId);
    const inTeam2 = stats.team2.some((p) => p.steamId === steamId);
    if (inTeam1 && !inTeam2) {
      playerSide = 'team1';
    } else if (!inTeam1 && inTeam2) {
      playerSide = 'team2';
    }
  }

  // Fallback to config players if live stats don't contain this player yet.
  if (!playerSide && rawMatch.config) {
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

  // Final fallback: trust the server‑provided isTeam1 flag.
  if (!playerSide) {
    playerSide = rawMatch.isTeam1 ? 'team1' : 'team2';
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
  const { steamId } = useParams<{ steamId: string }>();
  const [player, setPlayer] = useState<PlayerDetail | null>(null);
  const [ratingHistory, setRatingHistory] = useState<RatingHistoryEntry[]>([]);
  const [matchHistory, setMatchHistory] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentMatch, setCurrentMatch] = useState<TeamMatchInfo | null>(null);
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
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
  const { playerSteamId } = useAuth();

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
      map.set(entry.matchSlug, entry.eloAfter);
    }
    return map;
  }, [ratingHistory]);

  const loadPlayerData = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!steamId) return;

    if (!silent) {
      setLoading(true);
    }
    setError('');

    try {
      // Load aggregated player summary (details + history + matches + basic stats)
      const summaryResponse = await api.get<{
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
          match_slug: string;
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
        }>;
      }>(`/api/players/${steamId}/summary`);

      if (!summaryResponse.success || !summaryResponse.player) {
        setError('Player not found');
        setPlayer(null);
        setRatingHistory([]);
        setMatchHistory([]);
        return;
      }

      setPlayer(summaryResponse.player);
      document.title = `${summaryResponse.player.name} - Player Profile`;

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
        }))
      );

      // Load current or upcoming match (for connect info)
      try {
        const currentMatchResponse = await api.get<{
          success: boolean;
          player: { id: string; name: string; avatar?: string };
          hasMatch: boolean;
          tournamentStatus?: string;
          match?: TeamMatchInfo;
        }>(`/api/players/${steamId}/current-match`);

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
      setError('Failed to load player data');
      console.error(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (steamId) {
      loadPlayerData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steamId]);

  // Lazily create a shared Socket.IO connection for this page once per mount.
  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io();
    }

    const socket = socketRef.current;

    // React to high‑level tournament / bracket events (e.g. server_assigned,
    // match_loaded) by refreshing the player data. This keeps the page in sync
    // even if the match (or its server) is created after the player page is opened.
    const handleBracketOrTournamentUpdate = (event?: { action?: string | null }) => {
      if (!event || !event.action) {
        return;
      }

      const refreshActions = new Set([
        'tournament_reset',
        'tournament_restarted',
        'bracket_regenerated',
        'match_loaded',
        'match_restarted',
        'server_assigned',
        'match_allocated',
        // Also refresh when rounds advance or match statuses change so the
        // player's ELO, match history, and "current match" card stay in sync
        // without requiring a manual page reload.
        'round_advanced',
        'match_status',
      ]);

      if (refreshActions.has(event.action)) {
        void loadPlayerData({ silent: true });
      }
    };

    socket.on('bracket:update', handleBracketOrTournamentUpdate);
    socket.on('tournament:update', handleBracketOrTournamentUpdate);

    // Additionally, refresh the player summary whenever any match completes.
    // This ensures ELO, rating history, and match history update immediately
    // after the player's match finishes, even if there is no longer a
    // "currentMatch" slug to subscribe to.
    const handleAnyMatchUpdate = (data?: { status?: string | null }) => {
      if (!data || data.status !== 'completed') {
        return;
      }
      void loadPlayerData({ silent: true });
    };

    socket.on('match:update', handleAnyMatchUpdate);

    return () => {
      if (!socket) return;
      socket.off('bracket:update', handleBracketOrTournamentUpdate);
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
      void loadPlayerData({ silent: true });
    };

    socket.on('match:update', handleUpdate);
    socket.on(`match:update:${slug}`, handleUpdate);

    return () => {
      if (!socket) return;
      socket.off('match:update', handleUpdate);
      socket.off(`match:update:${slug}`, handleUpdate);
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
        }>('/api/tournament/server-availability');

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

  const getRoundLabel = (round: number) => {
    if (round === 1) return 'Round 1';
    if (round === 2) return 'Round 2';
    if (round === 3) return 'Quarterfinals';
    if (round === 4) return 'Semifinals';
    if (round === 5) return 'Finals';
    return `Round ${round}`;
  };

  if (loading) {
    return (
      <Box minHeight="100vh" bgcolor="background.default">
        <PlayerNavBar />
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

  if (error || !player) {
    return (
      <Box minHeight="100vh" bgcolor="background.default">
        <PlayerNavBar />
        <Container maxWidth="sm">
          <Box py={6}>
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <Alert severity="warning" sx={{ mb: 2 }} data-testid="player-not-found-error">
                  {error || 'No player is registered for this Steam ID yet.'}
                </Alert>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  If you just logged in with Steam, ask a tournament admin to register you or create
                  a player with this Steam ID.
                </Typography>
                <Button variant="outlined" component={RouterLink} to="/player">
                  Back to Find Player
                </Button>
              </CardContent>
            </Card>
          </Box>
        </Container>
      </Box>
    );
  }

  // Use first recorded rating as a more intuitive "starting" point rather than
  // the raw DB seed (which might be a calibration value like 3000).
  const effectiveStartingElo =
    ratingHistory.length > 0
      ? ratingHistory[ratingHistory.length - 1].eloAfter
      : player.startingElo;

  // Baseline for the history table: true initial rating before the first match.
  const baselineRating =
    ratingHistory.length > 0
      ? ratingHistory[ratingHistory.length - 1].eloBefore
      : player.startingElo;
  const winRate =
    uniqueMatchHistory.length > 0
      ? (uniqueMatchHistory.filter((m) => m.wonMatch).length / uniqueMatchHistory.length) * 100
      : 0;
  const wins = uniqueMatchHistory.filter((m) => m.wonMatch).length;
  const losses = uniqueMatchHistory.length - wins;
  const averageAdr =
    uniqueMatchHistory.length > 0
      ? uniqueMatchHistory.reduce((sum, m) => sum + (m.adr || 0), 0) / uniqueMatchHistory.length
      : 0;

  // Use the most recent match's tournament for leaderboard link (if available)
  const latestTournamentId = uniqueMatchHistory.find((m) => m.tournamentId)?.tournamentId;
  const hasAnyMatches = uniqueMatchHistory.length > 0;
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
    if (m.adr === undefined) continue;
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
      bgcolor="background.default"
      data-testid="public-player-page"
    >
      <PlayerNavBar />
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
          {/* Local navigation (kept minimal; main links live in the navbar) */}
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle2" color="text.secondary">
              Player profile
            </Typography>
            {playerSteamId === steamId && (
              <Chip color="primary" size="small" label="This is you" />
            )}
          </Box>

          {/* Player Header */}
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3}>
                <Box display="flex" alignItems="center" gap={3}>
                  <PlayerAvatar
                    id={player.id}
                    name={player.name}
                    avatarUrl={player.avatar}
                    size={80}
                    isAdmin={player.isAdmin}
                  />
                  <Box flex={1}>
                    <PlayerName
                      name={player.name}
                      isAdmin={player.isAdmin}
                      variant="h4"
                      sx={{ fontWeight: 700, mb: 0.5 }}
                      data-testid="public-player-name"
                    />
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Steam ID: {player.id}
                    </Typography>
                    <Box display="flex" gap={2} mt={2} flexWrap="wrap" alignItems="center">
                      <Tooltip title="Skill Rating is based on OpenSkill. Around 1500 is a typical starting rating; higher is better.">
                        <Chip
                          data-testid="public-player-elo"
                          label={`Skill Rating: ${player.currentElo}`}
                          color="primary"
                          sx={{ fontWeight: 600, fontSize: '1rem' }}
                        />
                      </Tooltip>
                      {latestTournamentId && (
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<EmojiEventsIcon />}
                          onClick={() =>
                            window.open(`/tournament/${latestTournamentId}/leaderboard`, '_blank')
                          }
                        >
                          View Tournament Leaderboard
                        </Button>
                      )}
                      {allocationCountdown.nextAllocationInSeconds !== null &&
                        allocationCountdown.nextAllocationInSeconds > 0 && (
                          <Typography variant="body2" color="text.secondary">
                            Next servers allocated in{' '}
                            <strong>
                              {Math.max(0, allocationCountdown.nextAllocationInSeconds)}s
                            </strong>
                          </Typography>
                        )}
                    </Box>
                  </Box>
                </Box>
                {player.isAdmin && (
                  <Chip
                    label="ADMIN"
                    color="error"
                    size="small"
                    sx={{
                      fontWeight: 700,
                      borderRadius: 1,
                      alignSelf: 'flex-start',
                    }}
                  />
                )}
              </Box>
            </CardContent>
          </Card>

          {currentMatch && (
            <TournamentRulesAccordion
              format={rulesFormatForPlayer}
              maxRounds={rulesMaxRoundsForPlayer}
              overtimeMode={rulesOvertimeModeForPlayer}
              overtimeSegments={rulesOvertimeSegmentsForPlayer}
            />
          )}

          {/* Current / Upcoming Match (connect info) */}
          {currentMatch ? (
            <MatchInfoCard
              match={currentMatch}
              team={currentTeam}
              tournamentStatus={currentTournamentStatus}
              vetoCompleted={currentMatch.veto?.status === 'completed'}
              matchFormat={(currentMatch.matchFormat as 'bo1' | 'bo3' | 'bo5') || 'bo1'}
              onVetoComplete={async () => {
                setTimeout(() => {
                  void loadPlayerData({ silent: true });
                }, 1000);
              }}
              getRoundLabel={getRoundLabel}
              highlightPlayerId={player.id}
            />
          ) : (
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <SportsEsportsIcon sx={{ fontSize: 56, color: 'text.secondary', mb: 2 }} />
                {tournamentIsCompleted && hasAnyMatches ? (
                  <>
                    <Typography variant="body1" color="text.secondary">
                      Tournament finished – you have no more matches.
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      Final record: {wins} win{wins === 1 ? '' : 's'} / {losses} loss
                      {losses === 1 ? '' : 'es'} in this tournament.
                    </Typography>
                  </>
                ) : tournamentIsActive && hasAnyMatches ? (
                  <>
                    <Typography variant="body1" color="text.secondary">
                      No upcoming match scheduled for you right now.
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      The tournament is still in progress, but your matches are complete.
                    </Typography>
                  </>
                ) : (
                  <>
                    <Typography variant="body1" color="text.secondary">
                      No active match right now
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      Once the next round is generated and your match is ready, it will appear here
                      with server connect info.
                    </Typography>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stats Overview */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Matches Played
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {uniqueMatchHistory.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Win Rate
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {winRate.toFixed(1)}%
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Wins / Losses
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {wins} / {losses}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Average ADR
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {averageAdr > 0 ? averageAdr.toFixed(1) : 'N/A'}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Recent form and performance highlights */}
          {hasAnyMatches && (
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} gutterBottom textAlign="center">
                  Recent Form & Highlights
                </Typography>

                {/* ADR highlights centered above timeline */}
                <Box display="flex" justifyContent="center" gap={4} mb={3} flexWrap="wrap">
                  {bestAdrMatch && (
                    <Box textAlign="center">
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Best Match (ADR)
                      </Typography>
                      <Typography variant="body2">
                        {bestAdrMatch.adr?.toFixed(1)} ADR in {getRoundLabel(bestAdrMatch.round)}
                      </Typography>
                    </Box>
                  )}
                  {worstAdrMatch && (
                    <Box textAlign="center">
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Toughest Match (ADR)
                      </Typography>
                      <Typography variant="body2">
                        {worstAdrMatch.adr?.toFixed(1)} ADR in {getRoundLabel(worstAdrMatch.round)}
                      </Typography>
                    </Box>
                  )}
                </Box>

                {/* Full-width recent form timeline */}
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Recent Form (last {maxRecentTimelineMatches} matches)
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
                              ? match.team2Name || 'Opponent'
                              : match.team1Name || 'Opponent';
                            const vsLabel = `vs ${opponentName}`;
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
                                // Always use dark text for readability on bright win/loss colors
                                color: 'common.black',
                                fontSize: 14,
                                fontWeight: 700,
                                boxShadow: isPlayed ? 1 : 0,
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
                      No matches yet
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          )}

          {/* Skill Rating Progression Chart */}
          {ratingHistory.length > 0 && player && (
            <ELOProgressionChart
              history={ratingHistory.map((entry) => ({
                eloBefore: entry.eloBefore,
                baseEloAfter: entry.baseEloAfter ?? null,
                createdAt: entry.createdAt,
              }))}
              currentElo={player.currentElo}
              startingElo={effectiveStartingElo}
            />
          )}

          {/* Performance Metrics Chart */}
          {uniqueMatchHistory.length > 0 && (
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

          {/* Rating History */}
          {/* Match History */}
          {uniqueMatchHistory.length > 0 && (
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  Match History
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell align="left">Round</TableCell>
                        <TableCell>Opponent</TableCell>
                        <TableCell align="right">Kills</TableCell>
                        <TableCell align="right">Deaths</TableCell>
                        <TableCell align="right">Assists</TableCell>
                        <TableCell align="right">HS%</TableCell>
                        <TableCell align="right">DMG</TableCell>
                        <TableCell align="right">Rating</TableCell>
                        <TableCell>Result</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {uniqueMatchHistory.slice(0, 10).map((match) => {
                        const isTeam1 = match.team === 'team1';
                        const opponentName = isTeam1
                          ? match.team2Name || 'Opponent'
                          : match.team1Name || 'Opponent';

                        return (
                          <TableRow
                            key={match.slug}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() => setSelectedMatch(match)}
                          >
                            <TableCell align="left">#{match.round}</TableCell>
                            <TableCell>
                              <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
                                vs {opponentName}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              {typeof match.kills === 'number' ? match.kills : 'N/A'}
                            </TableCell>
                            <TableCell align="right">
                              {typeof match.deaths === 'number' ? match.deaths : 'N/A'}
                            </TableCell>
                            <TableCell align="right">
                              {typeof match.assists === 'number' ? match.assists : 'N/A'}
                            </TableCell>
                            <TableCell align="right">
                              {typeof match.kills === 'number' &&
                              typeof match.headshots === 'number' &&
                              match.kills > 0
                                ? `${Math.round((match.headshots / match.kills) * 100)}%`
                                : 'N/A'}
                            </TableCell>
                            <TableCell align="right">
                              {typeof match.totalDamage === 'number'
                                ? match.totalDamage.toLocaleString()
                                : 'N/A'}
                            </TableCell>
                            <TableCell align="right">
                              {ratingBySlug.has(match.slug)
                                ? ratingBySlug.get(match.slug)
                                : 'N/A'}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={match.wonMatch ? 'Win' : 'Loss'}
                                size="small"
                                color={match.wonMatch ? 'success' : 'error'}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {/* Baseline row (non-clickable) */}
                      <TableRow hover={false} sx={{ cursor: 'default' }}>
                        <TableCell align="left">
                          <Typography variant="body2" color="text.secondary" noWrap>
                            Baseline
                          </Typography>
                        </TableCell>
                        <TableCell>—</TableCell>
                        <TableCell align="right">—</TableCell>
                        <TableCell align="right">—</TableCell>
                        <TableCell align="right">—</TableCell>
                        <TableCell align="right">—</TableCell>
                        <TableCell align="right">—</TableCell>
                        <TableCell align="right">
                          <strong>{baselineRating}</strong>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            —
                          </Typography>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
                {uniqueMatchHistory.length > 10 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 1, display: 'block' }}
                  >
                    Showing last 10 matches. Total: {uniqueMatchHistory.length}
                  </Typography>
                )}
              </CardContent>
            </Card>
          )}

          {uniqueMatchHistory.length === 0 && ratingHistory.length === 0 && (
            <Card>
              <CardContent>
                <Box textAlign="center" py={4}>
                  <SportsEsportsIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="body1" color="text.secondary">
                    No match history yet
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
