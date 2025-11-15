import React, { useState } from 'react';
import { Box, Card, CardContent, Typography, Alert } from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import { getStatusColor, getStatusLabel } from '../../utils/matchUtils';
import { getMapData, getMapDisplayName } from '../../constants/maps';
import { VetoInterface } from '../veto/VetoInterface';
import type { Team, TeamMatchInfo, VetoState, MatchLiveStats } from '../../types';
import { MatchScoreboard } from './MatchScoreboard';
import { MatchPlayerPerformance } from './MatchPlayerPerformance';
import { MatchRosterAccordion } from './MatchRosterAccordion';
import { MatchMapChips } from './MatchMapChips';
import { MatchVetoHistory } from './MatchVetoHistory';
import { MatchServerPanel } from './MatchServerPanel';

interface MatchInfoCardProps {
  match: TeamMatchInfo;
  team: Team | null;
  tournamentStatus: string;
  vetoCompleted: boolean;
  matchFormat: 'bo1' | 'bo3' | 'bo5';
  onVetoComplete: (veto: VetoState) => void;
  getRoundLabel: (round: number) => string;
}

const LIVE_STATUS_DISPLAY: Record<
  MatchLiveStats['status'],
  { label: string; chipColor: 'success' | 'info' | 'warning' | 'default' }
> = {
  warmup: { label: 'Warmup', chipColor: 'info' },
  knife: { label: 'Knife Round', chipColor: 'warning' },
  live: { label: 'Live', chipColor: 'success' },
  halftime: { label: 'Halftime', chipColor: 'warning' },
  postgame: { label: 'Postgame', chipColor: 'default' },
};

export function MatchInfoCard({
  match,
  team,
  tournamentStatus,
  vetoCompleted,
  matchFormat,
  onVetoComplete,
  getRoundLabel,
}: MatchInfoCardProps) {
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);

  const liveStats = match.liveStats || null;
  const connectionStatus = match.connectionStatus || null;
  const mapRoundsTeam1 = liveStats?.team1Score ?? 0;
  const mapRoundsTeam2 = liveStats?.team2Score ?? 0;
  const seriesWinsTeam1 = liveStats?.team1SeriesScore ?? 0;
  const seriesWinsTeam2 = liveStats?.team2SeriesScore ?? 0;
  const mapNumber = liveStats?.mapNumber ?? match.mapNumber ?? null;
  const totalMaps =
    liveStats?.totalMaps ??
    match.config?.num_maps ??
    (match.maps.length > 0 ? match.maps.length : Math.max(match.mapResults.length, 1)) ??
    1;
  const currentMapSlug =
    liveStats?.mapName ||
    match.currentMap ||
    (typeof mapNumber === 'number' && match.maps[mapNumber]
      ? match.maps[mapNumber]
      : match.maps[0]) ||
    null;
  const currentMapData = currentMapSlug ? getMapData(currentMapSlug) : null;
  const currentMapLabel = currentMapSlug
    ? getMapDisplayName(currentMapSlug) || currentMapSlug
    : null;
  const mapDisplayNumber =
    typeof mapNumber === 'number' ? Math.min(mapNumber + 1, totalMaps) : null;
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

  // Tournament Not Started - waiting for tournament to start
  if (
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

  // Veto Phase - tournament started, show veto interface
  if (
    tournamentStatus === 'in_progress' &&
    match.status === 'pending' &&
    !vetoCompleted &&
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
  if (['loaded', 'live'].includes(match.status) || (match.status === 'ready' && vetoCompleted)) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Box>
              <Typography variant="h5" fontWeight={600}>
                Match #{match.matchNumber}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {getRoundLabel(match.round)}
              </Typography>
            </Box>
          </Box>

          <MatchScoreboard
            leftName={team?.name}
            rightName={match.opponent?.name}
            leftMapRounds={mapRoundsTeam1}
            rightMapRounds={mapRoundsTeam2}
            leftSeriesWins={seriesWinsTeam1}
            rightSeriesWins={seriesWinsTeam2}
            liveStatusDisplay={liveStatusDisplay}
          />

          {match.status !== 'live' && (
            <Alert
              severity={playersReady ? 'success' : 'info'}
              icon={<PeopleIcon fontSize="small" />}
              sx={{ mb: 3 }}
            >
              {playersReady
                ? 'All required players are connected. Match can start.'
                : `Waiting for players to connect (${totalConnected}/${expectedPlayersDisplay})`}
            </Alert>
          )}

          <MatchServerPanel
            server={match.server}
            currentMapData={currentMapData}
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
            />
          )}

          <MatchMapChips match={match} currentMapNumber={mapNumber} />

          <MatchRosterAccordion team={team} match={match} />

          {showVetoHistory && (
            <MatchVetoHistory
              actions={vetoActions}
              team1Name={vetoTeam1Name}
              team2Name={vetoTeam2Name}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}
