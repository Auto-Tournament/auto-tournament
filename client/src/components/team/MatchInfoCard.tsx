import React, { useEffect, useMemo, useState } from 'react';
import { Box, Card, CardContent, Typography, Alert } from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import { getMapData } from '../../constants/maps';
import { VetoInterface } from '../veto/VetoInterface';
import type { Team, TeamMatchInfo, VetoState, MatchLiveStats, PlayersResponse } from '../../types';
// Note: status color is handled by higher-level components; keep imports minimal here.
import { isShuffleMatch as isShuffleMatchGlobal, isVetoDisabledForMatch } from '../../utils/matchFlags';
import { MatchScoreboard } from './MatchScoreboard';
import { MatchPlayerPerformance } from './MatchPlayerPerformance';
import { MatchMapChips } from './MatchMapChips';
import { MatchVetoHistory } from './MatchVetoHistory';
import { MatchServerPanel } from './MatchServerPanel';
import { api } from '../../utils/api';

interface MatchInfoCardProps {
  match: TeamMatchInfo;
  team: Team | null;
  tournamentStatus: string;
  vetoCompleted: boolean;
  matchFormat: 'bo1' | 'bo3' | 'bo5';
  onVetoComplete: (veto: VetoState) => void;
  getRoundLabel: (round: number) => string;
  // Optional: when provided, this player's row will be highlighted and not linked
  highlightPlayerId?: string;
}

const LIVE_STATUS_DISPLAY: Record<
  MatchLiveStats['status'],
  { label: string; chipColor: 'default' | 'info' | 'success' | 'warning' }
> = {
  // Warmup / between-maps states share the same soft blue "pre-live" tone
  warmup: { label: 'Warmup', chipColor: 'info' },
  knife: { label: 'Knife Round', chipColor: 'success' },
  live: { label: 'Live', chipColor: 'warning' },
  halftime: { label: 'Halftime', chipColor: 'warning' },
  // Map just ended; server is cleaning up or preparing next map
  postgame: {
    label: 'Map finished – waiting for next map',
    chipColor: 'default',
  },
};

export function MatchInfoCard({
  match,
  team,
  tournamentStatus,
  vetoCompleted,
  matchFormat,
  onVetoComplete,
  getRoundLabel,
  highlightPlayerId,
}: MatchInfoCardProps) {
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [playerEloIndex, setPlayerEloIndex] = useState<Record<string, number> | null>(null);

  const liveStats = match.liveStats || null;
  const connectionStatus = match.connectionStatus || null;
  const mapRoundsTeam1 = liveStats?.team1Score ?? 0;
  const mapRoundsTeam2 = liveStats?.team2Score ?? 0;
  const mapNumber = liveStats?.mapNumber ?? match.mapNumber ?? null;

  const mapFromMatchMaps =
    typeof mapNumber === 'number' && match.maps[mapNumber]
      ? match.maps[mapNumber]
      : match.maps[0];

  const configMapList = match.config?.maplist;
  const mapFromConfig =
    configMapList && typeof mapNumber === 'number' && configMapList[mapNumber]
      ? configMapList[mapNumber]
      : configMapList?.[0];

  const currentMapSlug =
    liveStats?.mapName || match.currentMap || mapFromMatchMaps || mapFromConfig || null;
  const currentMapData = useMemo(() => {
    if (!currentMapSlug) return null;
    const mapData = getMapData(currentMapSlug);
    if (mapData) return mapData;
    // Fallback: construct map data from slug
    const baseUrl =
      'https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails';
    return {
      name: currentMapSlug,
      displayName: currentMapSlug.replace('de_', '').replace('cs_', ''),
      // Use full-size webp for the large hero image, and thumbnail for smaller usages
      image: `${baseUrl}/${currentMapSlug}.webp`,
      thumbnail: `${baseUrl}/${currentMapSlug}_thumb.webp`,
    };
  }, [currentMapSlug]);
  const liveStatusDisplay = liveStats ? LIVE_STATUS_DISPLAY[liveStats.status] : null;
  const totalConnected = connectionStatus?.totalConnected ?? 0;
  const expectedPlayersTotal =
    match.config?.expected_players_total ||
    (match.config?.players_per_team ? match.config.players_per_team * 2 : undefined);
  const expectedPlayersDisplay =
    expectedPlayersTotal ??
    (match.config?.players_per_team ? match.config.players_per_team * 2 : 10);
  const playersReady =
    expectedPlayersTotal !== undefined
      ? totalConnected >= expectedPlayersTotal
      : totalConnected > 0;
  const vetoActions = match.veto?.actions ?? [];
  const vetoTeam1Name = match.veto?.team1Name || match.team1?.name || 'Team 1';
  const vetoTeam2Name = match.veto?.team2Name || match.team2?.name || 'Team 2';
  const showVetoHistory = vetoActions.length > 0;
  const playerStats = liveStats?.playerStats ?? null;
  const hasPlayerStats =
    !!playerStats && (playerStats.team1.length > 0 || playerStats.team2.length > 0);

  const serverStatus = match.server?.status ?? null;
  // Only treat explicit "online" (or transitional "checking") as truly online.
  // However, if we are actively receiving live stats from the MatchZy plugin,
  // we treat the server as effectively online even if the cached status is
  // slightly out of date.
  const isServerOnlineBase =
    serverStatus === 'online' || serverStatus === 'checking' || serverStatus === 'loading';
  const isServerOnline = isServerOnlineBase || !!liveStats;
  const effectiveServer = isServerOnline ? match.server : null;

  const isShuffleMatch = isShuffleMatchGlobal({
    round: match.round,
    team1: match.team1 ? { id: match.team1.id } : null,
    team2: match.team2 ? { id: match.team2.id } : null,
    config: match.config
      ? {
          ...match.config,
          team1: match.config.team1 ? { id: match.config.team1.id } : null,
          team2: match.config.team2 ? { id: match.config.team2.id } : null,
        }
      : null,
  });

  // For shuffle matches, lazily load player ratings so we can surface
  // approximate team ELOs in the match info card for admins.
  useEffect(() => {
    if (!isShuffleMatch) return;
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
        console.error('Failed to load players for team ELO display in MatchInfoCard', err);
      }
    };

    void loadPlayers();

    return () => {
      cancelled = true;
    };
  }, [isShuffleMatch, playerEloIndex]);

  const deriveSeriesWins = useMemo(() => {
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
    return {
      team1: liveStats?.team1SeriesScore ?? 0,
      team2: liveStats?.team2SeriesScore ?? 0,
    };
  }, [match.mapResults, liveStats]);

  const team1AverageElo = useMemo(() => {
    if (!isShuffleMatch || !playerEloIndex) return null;
    const configTeam1Players = (match.config?.team1?.players || []) as Array<{ steamid: string }>;
    const values = configTeam1Players
      .map((p) => playerEloIndex[p.steamid])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [isShuffleMatch, match.config?.team1?.players, playerEloIndex]);

  const team2AverageElo = useMemo(() => {
    if (!isShuffleMatch || !playerEloIndex) return null;
    const configTeam2Players = (match.config?.team2?.players || []) as Array<{ steamid: string }>;
    const values = configTeam2Players
      .map((p) => playerEloIndex[p.steamid])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [isShuffleMatch, match.config?.team2?.players, playerEloIndex]);

  const handleConnect = () => {
    if (!match.server) return;

    const address = `${match.server.host}:${match.server.port}`;
    const encodedPassword = match.server.password ? encodeURIComponent(match.server.password) : '';

    // Preferred CS2 launch syntax
    const params = match.server.password
      ? `+password%20${encodedPassword};%20+connect%20${address}`
      : `+connect%20${address}`;
    const steamUri = `steam://run/730//${params}`;

    // Legacy CS:GO/Steam connect syntax as fallback
    const legacyUri = match.server.password
      ? `steam://connect/${address}/${match.server.password}`
      : `steam://connect/${address}`;

    let navigationTriggered = false;

    try {
      window.location.href = steamUri;
      navigationTriggered = true;
    } catch (error) {
      console.warn('Failed to trigger Steam connect via run/730, falling back.', error);
    }

    if (!navigationTriggered) {
      window.location.href = legacyUri;
    }

    setConnected(true);
    setTimeout(() => setConnected(false), 3000);
  };

  const handleCopyIP = () => {
    if (!match.server) return;
    const connectCommand = `connect ${match.server.host}:${match.server.port}${
      match.server.password ? `; password ${match.server.password}` : ''
    }`;
    navigator.clipboard.writeText(connectCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasBothTeamsAssigned = Boolean(match.team1?.id) && Boolean(match.team2?.id);
  const isCompletedMatch = match.status === 'completed';
  const isManualMatch = match.round === 0;
  const vetoFlowDisabled = isVetoDisabledForMatch({
    round: match.round,
    team1: match.team1 ? { id: match.team1.id } : null,
    team2: match.team2 ? { id: match.team2.id } : null,
    config: match.config
      ? {
          ...match.config,
          team1: match.config.team1 ? { id: match.config.team1.id } : null,
          team2: match.config.team2 ? { id: match.config.team2.id } : null,
        }
      : null,
  });

  // Tournament Not Started - waiting for tournament to start.
  // Manual matches (round === 0) are independent of the global tournament and
  // should never be blocked by this state.
  if (
    !isManualMatch &&
    tournamentStatus !== 'in_progress' &&
    match.status === 'pending' &&
    ['bo1', 'bo3', 'bo5'].includes(matchFormat)
  ) {
    return (
      <Card>
        <CardContent>
          <Alert severity="warning">
            <Typography variant="body1" fontWeight={600} gutterBottom>
              ⏳ Waiting for Tournament to Start
            </Typography>
            <Typography variant="body2">
              Your match is ready, but the tournament hasn't started yet. The map veto will become
              available once the tournament administrator starts the tournament.
            </Typography>
            {tournamentStatus === 'setup' && (
              <Typography variant="caption" display="block" mt={1}>
                Tournament Status: Setup Phase
              </Typography>
            )}
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Waiting for opponent: tournament live, this team is locked in, but the next-round
  // opponent has not been decided yet. In this state we should NOT start veto.
  if (
    !isManualMatch &&
    tournamentStatus === 'in_progress' &&
    match.status === 'pending' &&
    !hasBothTeamsAssigned &&
    ['bo1', 'bo3', 'bo5'].includes(matchFormat)
  ) {
    return (
      <Card>
        <CardContent>
          <Alert severity="info">
            <Typography variant="body1" fontWeight={600} gutterBottom>
              Waiting for Opponent
            </Typography>
            <Typography variant="body2">
              You have advanced to the next round. Your next opponent is not decided yet, so map
              veto will open once both teams are known.
            </Typography>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Veto Phase - tournament started, show veto interface
  // Show veto interface if veto is not completed (check both state and match.veto.status)
  const isVetoNotCompleted =
    !vetoFlowDisabled && !vetoCompleted && match.veto?.status !== 'completed';
  if (
    (isManualMatch || tournamentStatus === 'in_progress') &&
    match.status === 'pending' &&
    isVetoNotCompleted &&
    hasBothTeamsAssigned &&
    ['bo1', 'bo3', 'bo5'].includes(matchFormat)
  ) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h5" fontWeight={600} mb={3}>
            🗺️ Map Selection
          </Typography>
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2">
              <strong>Tournament has started!</strong> Complete the map veto process to begin your
              match.
            </Typography>
          </Alert>
          <VetoInterface
            matchSlug={match.slug}
            team1Name={match.team1?.name}
            team2Name={match.team2?.name}
            currentTeamSlug={team?.id}
            onComplete={onVetoComplete}
          />
        </CardContent>
      </Card>
    );
  }

  // Active Match - show full match details
  // Show match details if:
  // 1. Match is loaded/live, OR
  // 2. Match is ready and veto is completed, OR
  // 3. Match status is pending but veto is completed (veto just finished, status update pending)
  const isVetoCompleted = vetoCompleted || match.veto?.status === 'completed';
  if (
    ['loaded', 'live'].includes(match.status) ||
    (match.status === 'ready' && isVetoCompleted) ||
    (match.status === 'pending' && isVetoCompleted && ['bo1', 'bo3', 'bo5'].includes(matchFormat))
  ) {
    return (
      <Card data-testid="match-details">
        <CardContent>
          <Box display="flex" flexDirection="column" gap={3}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="h5" fontWeight={600}>
                  {getRoundLabel(match.round)}
                </Typography>
                {typeof mapNumber === 'number' && (
                  <Typography variant="body2" color="text.secondary">
                    Map {mapNumber + 1}
                  </Typography>
                )}
              </Box>
            </Box>

          <MatchScoreboard
            leftName={team?.name}
            rightName={match.opponent?.name}
            leftMapRounds={mapRoundsTeam1}
            rightMapRounds={mapRoundsTeam2}
            leftSeriesWins={deriveSeriesWins.team1}
            rightSeriesWins={deriveSeriesWins.team2}
            leftTeamElo={
              isShuffleMatch && team1AverageElo !== null
                ? Math.round(team1AverageElo)
                : undefined
            }
            rightTeamElo={
              isShuffleMatch && team2AverageElo !== null
                ? Math.round(team2AverageElo)
                : undefined
            }
            liveStatusDisplay={liveStatusDisplay}
            // For BO1, completed, shuffle, or manual matches, showing both "Series Maps Won" and
            // "Map Rounds" can look duplicated or misleading. Hide the series row and keep the
            // per‑map round result instead.
            hideSeriesWins={
              isShuffleMatch || isCompletedMatch || matchFormat === 'bo1' || isManualMatch
            }
          />

            {liveStats?.status === 'postgame' && match.status !== 'completed' && (
              <Typography variant="body2" color="text.secondary" mt={1}>
                Map finished. Waiting for next map in this series...
              </Typography>
            )}

            {match.status !== 'live' && (
              <Alert
                severity={playersReady ? 'success' : 'info'}
                icon={<PeopleIcon fontSize="small" />}
              >
                {playersReady
                  ? 'All required players are connected. Match can start.'
                  : `Waiting for players to connect (${totalConnected}/${expectedPlayersDisplay})`}
              </Alert>
            )}

            <MatchServerPanel
              server={effectiveServer}
              currentMapData={currentMapData}
              currentMapNumber={mapNumber}
              connected={connected}
              copied={copied}
              onConnect={handleConnect}
              onCopy={handleCopyIP}
            />

            {hasPlayerStats && playerStats && (
              <MatchPlayerPerformance
                playerStats={playerStats}
                teamName={team?.name}
                opponentName={match.opponent?.name}
                yourTeamIsTeam1={match.isTeam1}
                highlightPlayerId={highlightPlayerId}
              />
            )}

            <MatchMapChips match={match} currentMapNumber={mapNumber} />

            {showVetoHistory && (
              <MatchVetoHistory
                actions={vetoActions}
                team1Name={vetoTeam1Name}
                team2Name={vetoTeam2Name}
              />
            )}
          </Box>
        </CardContent>
      </Card>
    );
  }

  return null;
}
