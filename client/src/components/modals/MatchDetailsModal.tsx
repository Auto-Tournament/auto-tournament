import React, { useEffect, useState, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  Stack,
  Divider,
  Grid,
  Card,
  CardContent,
  Snackbar,
  Alert,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import GroupsIcon from '@mui/icons-material/Groups';
import MapIcon from '@mui/icons-material/Map';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LinkIcon from '@mui/icons-material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CodeIcon from '@mui/icons-material/Code';
import {
  formatDate,
  formatDuration,
  getStatusColor,
  getStatusLabel,
  getDetailedStatusLabel,
  getStatusExplanation,
} from '../../utils/matchUtils';
import { usePlayerConnections } from '../../hooks/usePlayerConnections';
import { useLiveStats } from '../../hooks/useLiveStats';
import { useTeamLinkCopy } from '../../hooks/useTeamLinkCopy';
import { getTeamMatchUrl } from '../../utils/teamLinks';
import { getPlayerPageUrl } from '../../utils/playerLinks';
import AdminMatchControls from '../admin/AdminMatchControls';
import { PlayerRoster } from '../match/PlayerRoster';
import { AddBackupPlayer } from '../admin/AddBackupPlayer';
import { getMapData, getMapDisplayName } from '../../constants/maps';
import { getPhaseDisplay } from '../../types/matchPhase.types';
import type { Match, PlayersResponse } from '../../types';
import { useTournamentStatus } from '../../hooks/useTournamentStatus';
import { MapChipList } from '../match/MapChipList';
import { MapDemoDownloads } from '../match/MapDemoDownloads';
import { FadeInImage } from '../common/FadeInImage';
import { api } from '../../utils/api';
import ConfirmDialog from './ConfirmDialog';
import { isShuffleMatch, isVetoDisabledForMatch } from '../../utils/matchFlags';
import { normalizeConfigPlayers } from '../../utils/playerUtils';
import { PlayerAvatar } from '../player/PlayerAvatar';

interface MatchDetailsModalProps {
  match: Match | null;
  matchNumber: number;
  roundLabel: string;
  onClose: () => void;
  onDeleted?: (slug: string) => void;
}

const InnerMatchDetailsModal: React.FC<Required<MatchDetailsModalProps>> = ({
  match,
  matchNumber,
  roundLabel,
  onClose,
  onDeleted,
}) => {
  const [matchTimer, setMatchTimer] = useState<number>(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configJson, setConfigJson] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [playerEloIndex, setPlayerEloIndex] = useState<Record<string, number> | null>(null);

  // Player connection status
  const { status: connectionStatus } = usePlayerConnections(match?.slug || null);
  const { stats: liveStats } = useLiveStats(match?.slug || null);

  // Team link copy with toast
  const { copyLink, ToastNotification } = useTeamLinkCopy();

  const { status: tournamentStatus } = useTournamentStatus();
  const isManualMatch = match?.round === 0;
  // Manual matches are independent of the global tournament lifecycle. For them
  // we pass `undefined` as tournamentStarted so status copy stays neutral and
  // never shows "WAITING FOR TOURNAMENT TO START".
  const tournamentHasStarted =
    tournamentStatus === 'in_progress' || tournamentStatus === 'completed';
  const tournamentStarted = isManualMatch ? undefined : tournamentHasStarted;

  // When inspecting shuffle matches, lazily load player ratings so we can
  // surface approximate team ELOs for admins to sanity-check balance.
  useEffect(() => {
    if (!match) return;
    if (!isShuffleMatch(match)) return;
    if (playerEloIndex) return;

    let cancelled = false;

    const loadPlayers = async () => {
      try {
        const resp = await api.get<PlayersResponse>('/api/players');
        if (!resp || !resp.success) return;
        if (cancelled) return;

        const index: Record<string, number> = {};
        for (const p of resp.players) {
          if (typeof p.currentElo === 'number' && Number.isFinite(p.currentElo)) {
            index[p.id] = p.currentElo;
          }
        }
        setPlayerEloIndex(index);
      } catch (err) {
        // Best-effort only; if this fails we simply omit the ELO summary.
        console.error('Failed to load players for team ELO display in MatchDetailsModal', err);
      }
    };

    void loadPlayers();

    return () => {
      cancelled = true;
    };
  }, [match, playerEloIndex]);

  // Calculate derived series wins before early return (React hooks rule).
  // For completed matches, use the persisted series score. While a series is
  // still in progress, prefer live series scores or count finished maps from
  // mapResults so we show e.g. "1 - 0" when entering Map 2, but never "regress"
  // below the DB-enriched series score (e.g. 0-2 from the bracket).
  const derivedSeriesWins = useMemo(() => {
    if (!match) {
      return { team1: 0, team2: 0 };
    }

    const dbSeriesTeam1 = typeof match.team1Score === 'number' ? match.team1Score : 0;
    const dbSeriesTeam2 = typeof match.team2Score === 'number' ? match.team2Score : 0;
    const hasSeriesOnMatch = dbSeriesTeam1 > 0 || dbSeriesTeam2 > 0;

    // Completed series: trust the DB-enriched series score.
    if (match.status === 'completed' && hasSeriesOnMatch) {
      return {
        team1: dbSeriesTeam1,
        team2: dbSeriesTeam2,
      };
    }

    // Live / in-progress series: prefer live series scores from the snapshot, but
    // never show a score lower than what we already have on the match object.
    // This keeps the modal consistent with the bracket view (which reads DB scores).
    if (
      liveStats &&
      (typeof liveStats.team1SeriesScore === 'number' ||
        typeof liveStats.team2SeriesScore === 'number')
    ) {
      const liveTeam1 = liveStats.team1SeriesScore ?? 0;
      const liveTeam2 = liveStats.team2SeriesScore ?? 0;
      return {
        team1: Math.max(dbSeriesTeam1, liveTeam1),
        team2: Math.max(dbSeriesTeam2, liveTeam2),
      };
    }

    // If we have a DB series score on the match, use it as a baseline even if
    // the series is still technically in progress.
    if (hasSeriesOnMatch) {
      return {
        team1: dbSeriesTeam1,
        team2: dbSeriesTeam2,
      };
    }

    // Fallback: derive from finished maps we have in match.mapResults.
    if (match.mapResults && match.mapResults.length > 0) {
      return match.mapResults.reduce(
        (acc, result) => {
          if (result.team1Score > result.team2Score) {
            acc.team1 += 1;
          } else if (result.team2Score > result.team1Score) {
            acc.team2 += 1;
          }
          return acc;
        },
        { team1: 0, team2: 0 }
      );
    }

    // Last resort: no series score and no map results yet.
    return { team1: 0, team2: 0 };
  }, [match, liveStats]);

  const handleDelete = async () => {
    if (!match) return;
    setConfirmDeleteOpen(false);
    try {
      await api.delete(`/api/matches/${match.slug}`);
      setSuccess('Match deleted successfully');
      if (onDeleted) {
        onDeleted(match.slug);
      }
      onClose();
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to delete match');
    }
  };

  // Timer effect for live matches
  useEffect(() => {
    if (!match || match.status !== 'live' || !match.loadedAt) {
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor(Date.now() / 1000) - match.loadedAt!;
      setMatchTimer(elapsed);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [match]);

  const handleOpenConfigModal = async () => {
    if (!match?.slug) return;
    setConfigModalOpen(true);
    setConfigLoading(true);
    setError('');

    try {
      // Fetch raw MatchZy config JSON from the backend
      const response = await api.get<unknown>(`/api/matches/${match.slug}.json`);
      setConfigJson(JSON.stringify(response, null, 2));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load match config';
      setError(message);
      setConfigJson(null);
    } finally {
      setConfigLoading(false);
    }
  };

  const getMatchPhaseDisplay = () => {
    if (match?.matchPhase) {
      return getPhaseDisplay(match.matchPhase);
    }
    return null;
  };

  // Start from DB-backed scores
  let mapRoundsTeam1 = match.team1Score ?? 0;
  let mapRoundsTeam2 = match.team2Score ?? 0;
  let activeMapNumber: number | null = match.mapNumber ?? null;
  const mapList = Array.isArray(match.config?.maplist) ? match.config.maplist : [];
  const configMaps =
    Array.isArray(match.config?.maplist) && match.config?.maplist.length > 0
      ? (match.config.maplist.filter(Boolean) as string[])
      : [];
  const mapResultsFallback =
    match.mapResults
      ?.map((result) => result.mapName)
      .filter((name): name is string => Boolean(name)) ?? [];
  const mapsToShow =
    configMaps.length > 0
      ? configMaps
      : Array.isArray(match.maps) && match.maps.length > 0
      ? match.maps
      : mapResultsFallback;
  // For completed matches, always trust persisted map results / DB scores and
  // ignore any late or reset live stats that might report 0-0 after the fact.
  if (match.status === 'completed') {
    if (match.mapResults && match.mapResults.length > 0) {
      const fallbackResult = match.mapResults[match.mapResults.length - 1];
      const completedMapNumber =
        typeof activeMapNumber === 'number' ? activeMapNumber : fallbackResult.mapNumber;
      const resultForScore =
        match.mapResults.find((mr) => mr.mapNumber === completedMapNumber) ?? fallbackResult;

      mapRoundsTeam1 = resultForScore.team1Score;
      mapRoundsTeam2 = resultForScore.team2Score;
      // Keep activeMapNumber consistent with whichever result we used
      activeMapNumber = resultForScore.mapNumber;
    } else {
      // We don't have per-map round scores here (only series wins), so avoid
      // showing misleading "Map Rounds 1–2" by resetting map rounds to 0–0.
      mapRoundsTeam1 = 0;
      mapRoundsTeam2 = 0;
    }
  } else if (liveStats) {
    // While match is in progress, prefer live stats so the UI updates in real time.
    mapRoundsTeam1 = liveStats.team1Score ?? mapRoundsTeam1;
    mapRoundsTeam2 = liveStats.team2Score ?? mapRoundsTeam2;
    activeMapNumber = liveStats.mapNumber ?? activeMapNumber;
  }

  const activeMapKey =
    liveStats?.mapName ||
    match.currentMap ||
    (typeof activeMapNumber === 'number' && mapList[activeMapNumber]
      ? mapList[activeMapNumber]
      : null);
  const currentMapLabel = activeMapKey ? getMapDisplayName(activeMapKey) || activeMapKey : null;
  const roundNumber = liveStats?.roundNumber ?? null;

  // Prefer the configured number of maps (BO1/BO3/BO5) when available,
  // and fall back to liveStats.totalMaps only when config is missing.
  const configuredTotalMaps =
    match.config?.num_maps ??
    (mapList.length > 0 ? mapList.length : match.mapResults?.length) ??
    undefined;

  const totalMapCount =
    (configuredTotalMaps && configuredTotalMaps > 0 ? configuredTotalMaps : undefined) ??
    (liveStats?.totalMaps && liveStats.totalMaps > 0 ? liveStats.totalMaps : undefined);

  // Normalize the map index used for display so we never show nonsense like
  // "Map 2 of 1" when a 1-based counter sneaks in from live stats.
  let displayMapIndex: number | null = null;
  if (typeof activeMapNumber === 'number') {
    if (typeof totalMapCount === 'number' && totalMapCount > 0) {
      const clamped = Math.min(Math.max(activeMapNumber, 0), totalMapCount - 1);
      displayMapIndex = clamped;
    } else {
      displayMapIndex = Math.max(activeMapNumber, 0);
    }
  }

  const seriesWinsTeam1 = derivedSeriesWins.team1;
  const seriesWinsTeam2 = derivedSeriesWins.team2;

  // Approximate average ELO per team (shuffle matches only), using current
  // player ratings. This is purely informational to let admins verify that
  // teams look reasonably balanced.
  const isShuffle = isShuffleMatch(match);

  const team1AverageElo = useMemo(() => {
    if (!isShuffle || !playerEloIndex) return null;
    const configTeam1Players = (match.config?.team1?.players || []) as Array<{ steamid: string }>;
    const values = configTeam1Players
      .map((p) => playerEloIndex[p.steamid])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [isShuffle, match.config?.team1?.players, playerEloIndex]);

  const team2AverageElo = useMemo(() => {
    if (!isShuffle || !playerEloIndex) return null;
    const configTeam2Players = (match.config?.team2?.players || []) as Array<{ steamid: string }>;
    const values = configTeam2Players
      .map((p) => playerEloIndex[p.steamid])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [isShuffle, match.config?.team2?.players, playerEloIndex]);

  // Derive a winner side for display in the modal:
  // - Prefer explicit winner.id when present (bracket matches)
  // - Fall back to series score when the match is completed (manual/ad‑hoc)
  let winnerSide: 'team1' | 'team2' | null = null;
  if (match.status === 'completed') {
    if (match.winner?.id && match.team1?.id && match.winner.id === match.team1.id) {
      winnerSide = 'team1';
    } else if (match.winner?.id && match.team2?.id && match.winner.id === match.team2.id) {
      winnerSide = 'team2';
    } else if (
      typeof seriesWinsTeam1 === 'number' &&
      typeof seriesWinsTeam2 === 'number' &&
      seriesWinsTeam1 !== seriesWinsTeam2
    ) {
      winnerSide = seriesWinsTeam1 > seriesWinsTeam2 ? 'team1' : 'team2';
    }
  }
  const livePlayerStats = liveStats?.playerStats ?? null;

  // Shuffle / veto-disabled detection shared across match views
  const vetoDisabled = isVetoDisabledForMatch(match);
  // Shuffle tournaments and veto-disabled matches don't use veto - treat as
  // completed to avoid "VETO PENDING" labels in chips and status badges.
  const effectiveVetoCompleted = vetoDisabled ? true : match.vetoCompleted;

  // Build a quick lookup of player avatars from the enriched match config so we
  // can decorate live stats / leaderboards with the same avatars used on team
  // and player pages. Use normalizeConfigPlayers so we handle both array and
  // object formats safely across all match types.
  const avatarIndex = useMemo(() => {
    const index: Record<string, string | undefined> = {};

    const team1Normalized = match.config?.team1?.players
      ? normalizeConfigPlayers(match.config.team1.players)
      : [];
    const team2Normalized = match.config?.team2?.players
      ? normalizeConfigPlayers(match.config.team2.players)
      : [];

    for (const p of [...team1Normalized, ...team2Normalized]) {
      if (p.steamid) {
        index[p.steamid.toLowerCase()] = p.avatar;
      }
    }

    return index;
  }, [match.config?.team1?.players, match.config?.team2?.players]);

  const normalizedTeam1Players = livePlayerStats?.team1?.length
    ? livePlayerStats.team1.map((player) => ({
        name: player.name,
        steamId: player.steamId,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        damage: player.damage,
        headshots: player.headshotKills,
      }))
    : (match.team1Players || []).map((player) => ({
        ...player,
        avatar: avatarIndex[player.steamId.toLowerCase()],
      }));
  const normalizedTeam2Players = livePlayerStats?.team2?.length
    ? livePlayerStats.team2.map((player) => ({
        name: player.name,
        steamId: player.steamId,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        damage: player.damage,
        headshots: player.headshotKills,
      }))
    : (match.team2Players || []).map((player) => ({
        ...player,
        avatar: avatarIndex[player.steamId.toLowerCase()],
      }));

  // --- Winner explanation for tied scores (performance-based tiebreak) ---
  const mapRoundsAreTied =
    match.status === 'completed' && mapRoundsTeam1 === mapRoundsTeam2 && mapRoundsTeam1 !== 0;

  const team1TotalDamage = normalizedTeam1Players.reduce(
    (sum, player) => sum + (player.damage ?? 0),
    0
  );
  const team2TotalDamage = normalizedTeam2Players.reduce(
    (sum, player) => sum + (player.damage ?? 0),
    0
  );

  const damageTiebreakWinner =
    team1TotalDamage > team2TotalDamage
      ? 'team1'
      : team2TotalDamage > team1TotalDamage
      ? 'team2'
      : null;

  const usesDamageTiebreak =
    match.status === 'completed' &&
    mapRoundsAreTied &&
    !!winnerSide &&
    !!damageTiebreakWinner &&
    winnerSide === damageTiebreakWinner &&
    normalizedTeam1Players.length > 0 &&
    normalizedTeam2Players.length > 0;

  const rawConfig: any = match.config || {};
  const overtimeMode: string | undefined = rawConfig.overtimeMode;
  const overtimeSegments: number | undefined =
    typeof rawConfig.overtimeSegments === 'number' ? rawConfig.overtimeSegments : undefined;

  const cvars = (match.config?.cvars || {}) as Record<string, string | number>;
  const rawOvertimeEnable = cvars['mp_overtime_enable'];
  const cvarOvertimeEnabled =
    rawOvertimeEnable !== undefined ? Number(rawOvertimeEnable) === 1 : undefined;

  let tiebreakReason: string | null = null;
  if (usesDamageTiebreak) {
    if (overtimeMode === 'disabled' && overtimeSegments === 0) {
      tiebreakReason =
        'Overtime is disabled for this match (regulation only), so tied scores are resolved by total team damage.';
    } else if (overtimeMode && typeof overtimeSegments === 'number' && overtimeSegments > 0) {
      tiebreakReason =
        'Overtime is configured with a maximum number of segments. If the score is still tied, the winner is decided by total team damage.';
    } else if (cvarOvertimeEnabled === false) {
      tiebreakReason =
        'Overtime is disabled for this match, so tied scores are resolved by total team damage.';
    } else {
      tiebreakReason =
        'The final score was tied, so according to the match settings the winner was chosen by total team damage.';
    }
  }

  const team1Name =
    match.team1?.name || (match.config?.team1 as { name?: string } | undefined)?.name || 'Team 1';
  const team2Name =
    match.team2?.name || (match.config?.team2 as { name?: string } | undefined)?.name || 'Team 2';

  return (
    <>
      <Dialog open={!!match} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Match #{matchNumber}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {roundLabel}
              </Typography>
            </Box>
            <IconButton onClick={onClose} edge="end">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} mt={1}>
            {/* Status and Timer */}
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              flexWrap="wrap"
              gap={2}
            >
              <Box display="flex" gap={1}>
                <Chip
                  label={getStatusLabel(
                    match.status,
                    false,
                    effectiveVetoCompleted,
                    tournamentStarted,
                    Boolean(match.serverId)
                  )}
                  color={getStatusColor(match.status)}
                  sx={{ fontWeight: 600 }}
                />
                {getMatchPhaseDisplay() && (
                  <Chip
                    label={getMatchPhaseDisplay()!.label}
                    color={
                      getMatchPhaseDisplay()!.color as
                        | 'default'
                        | 'primary'
                        | 'secondary'
                        | 'error'
                        | 'info'
                        | 'success'
                        | 'warning'
                    }
                    sx={{ fontWeight: 600 }}
                    variant="outlined"
                  />
                )}
              </Box>
              {match.status === 'live' && match.loadedAt && (
                <Box display="flex" alignItems="center" gap={1}>
                  <Typography variant="body2" color="text.secondary">
                    Match Time:
                  </Typography>
                  <Typography variant="h6" fontWeight={600} color="error.main">
                    {formatDuration(matchTimer)}
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Detailed Status Info */}
            {!(vetoDisabled && (match.status === 'pending' || match.status === 'ready')) && (
              <Alert
                severity={
                  match.status === 'completed'
                    ? 'success'
                    : match.status === 'live'
                    ? 'error'
                    : match.status === 'loaded'
                    ? 'info'
                    : 'warning'
                }
                icon={false}
              >
                <Typography variant="body2" fontWeight={600} mb={0.5}>
                  {getDetailedStatusLabel(
                    match.status,
                    connectionStatus?.totalConnected,
                    match.config?.expected_players_total || 10,
                    false,
                    effectiveVetoCompleted,
                    tournamentStarted,
                    Boolean(match.serverId)
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {getStatusExplanation(
                    match.status,
                    connectionStatus?.totalConnected,
                    match.config?.expected_players_total || 10,
                    tournamentStarted
                  )}
                </Typography>
              </Alert>
            )}

            {/* Server Info */}
            {match.serverName && (
              <Box>
                <Typography variant="body2" color="text.secondary">
                  <strong>Server:</strong> {match.serverName}
                </Typography>
              </Box>
            )}

            <Divider />

            {/* Score Display */}
            <Box
              sx={{
                bgcolor: 'action.hover',
                borderRadius: 2,
                p: 3,
              }}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
                {/* Team 1 */}
                <Box flex={1} textAlign="left">
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="h5" fontWeight={700}>
                      {match.team1?.name ||
                        (match.config?.team1 as { name?: string } | undefined)?.name ||
                        (match.status === 'completed' ? '—' : 'TBD')}
                    </Typography>
                    {match.team1?.id && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <Tooltip title="Copy team match link">
                          <IconButton size="small" onClick={() => copyLink(match.team1?.id)}>
                            <LinkIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Open team match page">
                          <IconButton
                            size="small"
                            href={getTeamMatchUrl(match.team1?.id || '')}
                            target="_blank"
                            color="primary"
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {match.team1?.tag}
                  </Typography>
                  {winnerSide === 'team1' && (
                    <Box mt={1}>
                      <EmojiEventsIcon sx={{ color: 'success.main', fontSize: 28 }} />
                    </Box>
                  )}
                </Box>

                {/* Scores */}
                <Box textAlign="center" minWidth={120}>
                  {/* Hide series wins row for completed and manual matches to avoid duplicated or
                      misleading stats. While tournament series are live, we still show the current
                      series score (e.g. 1–0 when entering Map 2). */}
                  {match.status !== 'completed' && !isManualMatch && (
                    <>
                      <Box display="flex" alignItems="center" justifyContent="center" gap={2}>
                        <Typography
                          variant="h2"
                          fontWeight={700}
                          sx={{
                            color: winnerSide === 'team1' ? 'success.main' : 'text.primary',
                          }}
                        >
                          {seriesWinsTeam1}
                        </Typography>
                        <Typography variant="h3" color="text.disabled">
                          -
                        </Typography>
                        <Typography
                          variant="h2"
                          fontWeight={700}
                          sx={{
                            color: winnerSide === 'team2' ? 'success.main' : 'text.primary',
                          }}
                        >
                          {seriesWinsTeam2}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" mt={1}>
                        Series Maps Won
                      </Typography>
                    </>
                  )}
                  <Box display="flex" alignItems="center" justifyContent="center" gap={2} mt={1}>
                    <Typography
                      variant="h4"
                      fontWeight={700}
                      sx={{
                        color: winnerSide === 'team1' ? 'success.main' : 'text.primary',
                      }}
                    >
                      {mapRoundsTeam1}
                    </Typography>
                    <Typography variant="h5" color="text.disabled">
                      -
                    </Typography>
                    <Typography
                      variant="h4"
                      fontWeight={700}
                      sx={{
                        color: winnerSide === 'team2' ? 'success.main' : 'text.primary',
                      }}
                    >
                      {mapRoundsTeam2}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Map Rounds
                  </Typography>
                  {currentMapLabel && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {`Map ${displayMapIndex !== null ? displayMapIndex + 1 : ''}${
                        totalMapCount ? ` of ${totalMapCount}` : ''
                      }: ${currentMapLabel}`}
                    </Typography>
                  )}
                  {roundNumber !== null && roundNumber > 0 && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {`Round ${roundNumber}`}
                    </Typography>
                  )}
                </Box>

                {/* Team 2 */}
                <Box flex={1} textAlign="right">
                  <Box display="flex" alignItems="center" justifyContent="flex-end" gap={1}>
                    {match.team2?.id && match.team2?.id !== '' && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <Tooltip title="Open team match page">
                          <IconButton
                            size="small"
                            href={getTeamMatchUrl(match.team2?.id || '')}
                            target="_blank"
                            rel="noopener noreferrer"
                            color="primary"
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Copy team match link">
                          <IconButton size="small" onClick={() => copyLink(match.team2?.id)}>
                            <LinkIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    )}
                    <Typography variant="h5" fontWeight={700}>
                      {match.team2?.name ||
                        (match.config?.team2 as { name?: string } | undefined)?.name ||
                        (match.status === 'completed' ? '—' : 'TBD')}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {match.team2?.tag}
                  </Typography>
                  {winnerSide === 'team2' && (
                    <Box mt={1}>
                      <EmojiEventsIcon sx={{ color: 'success.main', fontSize: 28 }} />
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>

            {isShuffle && team1AverageElo !== null && team2AverageElo !== null && (
              <Box textAlign="center">
                <Typography variant="body2" color="text.secondary">
                  Team ELO (avg): {Math.round(team1AverageElo)} vs {Math.round(team2AverageElo)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Shuffle teams are generated by an OpenSkill-based balancer that spreads high and
                  low-rated players across both sides to keep these averages close.
                </Typography>
              </Box>
            )}

            {usesDamageTiebreak && tiebreakReason && (
              <Alert severity="info">
                <Typography variant="body2" gutterBottom>
                  {tiebreakReason}
                </Typography>
                <Typography variant="body2">
                  {team1Name} dealt <strong>{team1TotalDamage}</strong> total damage; {team2Name}{' '}
                  dealt <strong>{team2TotalDamage}</strong>.{' '}
                  <strong>{winnerSide === 'team1' ? team1Name : team2Name}</strong> wins the
                  performance tiebreak.
                </Typography>
              </Alert>
            )}

            {/* Player Roster – show in an accordion like Maps / Match Information */}
            {match.config &&
              (isShuffleMatch || match.status === 'loaded' || match.status === 'live') && (
                <>
                  <Divider />
                  <Accordion sx={{ mt: 2 }} defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box display="flex" alignItems="center" gap={1}>
                        <GroupsIcon color="primary" />
                        <Typography variant="subtitle1" fontWeight={600}>
                          Player Roster
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <PlayerRoster
                        team1Name={
                          match.team1?.name ||
                          (match.config?.team1 as { name?: string } | undefined)?.name ||
                          'Team 1'
                        }
                        team2Name={
                          match.team2?.name ||
                          (match.config?.team2 as { name?: string } | undefined)?.name ||
                          'Team 2'
                        }
                        team1Players={match.config?.team1?.players || []}
                        team2Players={match.config?.team2?.players || []}
                        connectedPlayers={connectionStatus?.connectedPlayers || []}
                      />
                    </AccordionDetails>
                  </Accordion>
                </>
              )}

            {/* Player Leaderboards */}
            {(normalizedTeam1Players.length > 0 || normalizedTeam2Players.length > 0) && (
              <>
                <Divider />
                <Box>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <GroupsIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={600}>
                      Player Leaderboards
                    </Typography>
                  </Box>
                  <Grid container spacing={2}>
                    {/* Team 1 Players */}
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle2" fontWeight={600} mb={2} color="primary">
                            {match.team1?.name ||
                              (match.config?.team1 as { name?: string } | undefined)?.name ||
                              'Team 1'}
                          </Typography>
                          {normalizedTeam1Players.length > 0 ? (
                            <Stack spacing={1}>
                              {normalizedTeam1Players
                                .sort((a, b) => b.kills - a.kills)
                                .map((player, idx) => (
                                  <Box
                                    key={player.steamId}
                                    sx={{
                                      p: 1.5,
                                      bgcolor: idx === 0 ? 'action.selected' : 'action.hover',
                                      borderRadius: 1,
                                    }}
                                  >
                                    <Box
                                      display="flex"
                                      justifyContent="space-between"
                                      alignItems="center"
                                    >
                                      <Box display="flex" alignItems="center" gap={1.25}>
                                        <PlayerAvatar
                                          id={player.steamId}
                                          name={player.name}
                                          avatarUrl={player.avatar}
                                          size={28}
                                        />
                                        <Typography
                                          variant="body2"
                                          fontWeight={600}
                                          component="a"
                                          href={getPlayerPageUrl(player.steamId)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          sx={{
                                            color: 'primary.main',
                                            textDecoration: 'none',
                                            cursor: 'pointer',
                                            '&:hover': {
                                              textDecoration: 'underline',
                                            },
                                          }}
                                        >
                                          {player.name}
                                        </Typography>
                                      </Box>
                                      <Typography
                                        variant="body2"
                                        fontWeight={600}
                                        color={idx === 0 ? 'primary' : 'text.primary'}
                                      >
                                        {player.kills}/{player.deaths}/{player.assists}
                                      </Typography>
                                    </Box>
                                    <Box display="flex" justifyContent="space-between" mt={0.5}>
                                      <Typography variant="caption" color="text.secondary">
                                        KDA:{' '}
                                        {(
                                          (player.kills + player.assists) /
                                          Math.max(1, player.deaths)
                                        ).toFixed(2)}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        HS: {player.headshots} | DMG: {player.damage}
                                      </Typography>
                                    </Box>
                                  </Box>
                                ))}
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              No player data available
                            </Typography>
                          )}
                        </CardContent>
                      </Card>
                    </Grid>

                    {/* Team 2 Players */}
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle2" fontWeight={600} mb={2} color="primary">
                            {match.team2?.name ||
                              (match.config?.team2 as { name?: string } | undefined)?.name ||
                              'Team 2'}
                          </Typography>
                          {normalizedTeam2Players.length > 0 ? (
                            <Stack spacing={1}>
                              {normalizedTeam2Players
                                .sort((a, b) => b.kills - a.kills)
                                .map((player, idx) => (
                                  <Box
                                    key={player.steamId}
                                    sx={{
                                      p: 1.5,
                                      bgcolor: idx === 0 ? 'action.selected' : 'action.hover',
                                      borderRadius: 1,
                                    }}
                                  >
                                    <Box
                                      display="flex"
                                      justifyContent="space-between"
                                      alignItems="center"
                                    >
                                      <Box display="flex" alignItems="center" gap={1.25}>
                                          <PlayerAvatar
                                            id={player.steamId}
                                            name={player.name}
                                            avatarUrl={player.avatar}
                                            size={28}
                                          />
                                        <Typography
                                          variant="body2"
                                          fontWeight={600}
                                          component="a"
                                          href={getPlayerPageUrl(player.steamId)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          sx={{
                                            color: 'primary.main',
                                            textDecoration: 'none',
                                            cursor: 'pointer',
                                            '&:hover': {
                                              textDecoration: 'underline',
                                            },
                                          }}
                                        >
                                          {player.name}
                                        </Typography>
                                      </Box>
                                      <Typography
                                        variant="body2"
                                        fontWeight={600}
                                        color={idx === 0 ? 'primary' : 'text.primary'}
                                      >
                                        {player.kills}/{player.deaths}/{player.assists}
                                      </Typography>
                                    </Box>
                                    <Box display="flex" justifyContent="space-between" mt={0.5}>
                                      <Typography variant="caption" color="text.secondary">
                                        KDA:{' '}
                                        {(
                                          (player.kills + player.assists) /
                                          Math.max(1, player.deaths)
                                        ).toFixed(2)}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        HS: {player.headshots} | DMG: {player.damage}
                                      </Typography>
                                    </Box>
                                  </Box>
                                ))}
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              No player data available
                            </Typography>
                          )}
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </Box>
              </>
            )}

            {/* Current Map Display */}
            {match.currentMap && (match.status === 'live' || match.status === 'loaded') && (
              <>
                <Divider />
                <Box>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <MapIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={600}>
                      Current Map
                    </Typography>
                  </Box>
                  <Card
                    sx={{
                      position: 'relative',
                      overflow: 'hidden',
                      height: 200,
                      display: 'flex',
                      alignItems: 'flex-end',
                    }}
                  >
                    {activeMapKey && (
                      <FadeInImage
                        src={
                          getMapData(activeMapKey)?.image ||
                          `https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails/${activeMapKey}.webp`
                        }
                        alt={currentMapLabel || activeMapKey}
                        sx={{
                          position: 'absolute',
                          inset: 0,
                        }}
                      >
                        <Box
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            background:
                              'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
                          }}
                        />
                      </FadeInImage>
                    )}
                    <Box sx={{ position: 'relative', p: 2, width: '100%' }}>
                      <Typography variant="h4" fontWeight={700} color="white">
                        {currentMapLabel || 'TBD'}
                      </Typography>
                      {activeMapNumber !== null && totalMapCount && totalMapCount > 1 && (
                        <Typography variant="body2" color="rgba(255,255,255,0.7)">
                          Map {Math.min(activeMapNumber + 1, totalMapCount)} of {totalMapCount}
                        </Typography>
                      )}
                    </Box>
                  </Card>
                </Box>
              </>
            )}

            <Accordion defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box display="flex" alignItems="center" gap={1}>
                  <MapIcon color="primary" />
                  <Typography variant="subtitle1" fontWeight={600}>
                    Maps
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                {mapsToShow.length > 0 ? (
                  <Box>
                    <MapChipList
                      maps={mapsToShow}
                      activeMapIndex={activeMapNumber}
                      activeMapLabel={currentMapLabel}
                      mapResults={match.mapResults || []}
                    />
                    {match.mapResults && match.mapResults.some((mr) => mr.demoFilePath) && (
                      <Box mt={3}>
                        <MapDemoDownloads
                          maps={mapsToShow}
                          mapResults={match.mapResults}
                          matchSlug={match.slug}
                        />
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary" fontStyle="italic">
                    To be determined via veto
                  </Typography>
                )}
              </AccordionDetails>
            </Accordion>

            <Accordion defaultExpanded sx={{ mt: 2 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box display="flex" alignItems="center" gap={1}>
                  <CalendarTodayIcon color="primary" />
                  <Typography variant="subtitle1" fontWeight={600}>
                    Match Information
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1}>
                  {match.createdAt && (
                    <Typography variant="body2" color="text.secondary">
                      <strong>Created:</strong> {formatDate(match.createdAt)}
                    </Typography>
                  )}
                  {match.loadedAt && (
                    <Typography variant="body2" color="text.secondary">
                      <strong>Started:</strong> {formatDate(match.loadedAt)}
                    </Typography>
                  )}
                  {match.completedAt && (
                    <Typography variant="body2" color="text.secondary">
                      <strong>Completed:</strong> {formatDate(match.completedAt)}
                    </Typography>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>

            {match.serverId && (match.status === 'live' || match.status === 'loaded') && (
              <Accordion sx={{ mt: 2 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle1" fontWeight={600}>
                    Admin Controls
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <AdminMatchControls
                    serverId={match.serverId}
                    matchSlug={match.slug}
                    onSuccess={(message) => {
                      setSuccess(message);
                      setTimeout(() => setSuccess(''), 3000);
                    }}
                    onError={(message) => {
                      setError(message);
                    }}
                  />
                  <Divider sx={{ my: 2 }} />
                  <AddBackupPlayer
                    matchSlug={match.slug}
                    serverId={match.serverId}
                    team1Name={match.team1?.name || 'Team 1'}
                    team2Name={match.team2?.name || 'Team 2'}
                    existingTeam1Players={match.config?.team1?.players || []}
                    existingTeam2Players={match.config?.team2?.players || []}
                    onSuccess={(message) => {
                      setSuccess(message);
                      setTimeout(() => setSuccess(''), 3000);
                    }}
                    onError={(message) => {
                      setError(message);
                    }}
                  />
                </AccordionDetails>
              </Accordion>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Box display="flex" justifyContent="space-between" width="100%" alignItems="center">
            <Typography variant="caption" color="text.secondary">
              Match slug: <strong>{match.slug}</strong>
            </Typography>
            <Box display="flex" gap={1}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<CodeIcon />}
                onClick={handleOpenConfigModal}
              >
                View Match Config JSON
              </Button>
              {isManualMatch && (
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  Delete Match
                </Button>
              )}
            </Box>
          </Box>
        </DialogActions>
      </Dialog>

      <ToastNotification />

      {/* Confirm delete manual match */}
      {match && (
        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Delete Manual Match"
          message={
            <Box>
              <Typography variant="body2" fontWeight={600} gutterBottom>
                Are you sure you want to delete this manual match?
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This action cannot be undone. It will remove the match <strong>{match.slug}</strong>{' '}
                and its configuration, but will not affect any tournament brackets.
              </Typography>
            </Box>
          }
          confirmLabel="Delete Match"
          cancelLabel="Cancel"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDeleteOpen(false)}
          confirmColor="error"
        />
      )}

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError('')} variant="filled">
          {error}
        </Alert>
      </Snackbar>

      {/* Match Config JSON Modal */}
      <Dialog
        open={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h6" fontWeight={600}>
              Match Config JSON
            </Typography>
            <IconButton onClick={() => setConfigModalOpen(false)} edge="end">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {configLoading ? (
            <Typography variant="body2" color="text.secondary">
              Loading match config...
            </Typography>
          ) : configJson ? (
            <Box
              component="pre"
              sx={{
                bgcolor: 'background.default',
                borderRadius: 1,
                p: 2,
                fontFamily: 'monospace',
                fontSize: 12,
                maxHeight: 500,
                overflow: 'auto',
                whiteSpace: 'pre',
              }}
            >
              <code>{configJson}</code>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No config available for this match.
            </Typography>
          )}
        </DialogContent>
      </Dialog>

      <Snackbar
        open={!!success}
        autoHideDuration={4000}
        onClose={() => setSuccess('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSuccess('')} variant="filled">
          {success}
        </Alert>
      </Snackbar>
    </>
  );
};

const MatchDetailsModal: React.FC<MatchDetailsModalProps> = (props) => {
  if (!props.match) {
    return null;
  }
  const { match, matchNumber, roundLabel, onClose, onDeleted } = props;
  return (
    <InnerMatchDetailsModal
      match={match}
      matchNumber={matchNumber}
      roundLabel={roundLabel}
      onClose={onClose}
      onDeleted={onDeleted}
    />
  );
};

export default MatchDetailsModal;
