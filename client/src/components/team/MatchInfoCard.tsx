import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Stack,
  Alert,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PeopleIcon from '@mui/icons-material/People';
import { getStatusColor, getStatusLabel } from '../../utils/matchUtils';
import { getMapDisplayName, getMapData } from '../../constants/maps';
import { VetoInterface } from '../veto/VetoInterface';
import type { Team, TeamMatchInfo, VetoState, MatchLiveStats } from '../../types';

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

// Helper function to get map chip styling
const getMapChipStyle = (status: 'won' | 'lost' | 'ongoing' | 'upcoming') => {
  switch (status) {
    case 'won':
      return {
        bgcolor: 'success.main',
        color: 'success.contrastText',
        icon: <CheckCircleIcon fontSize="small" />,
      };
    case 'lost':
      return {
        bgcolor: 'error.main',
        color: 'error.contrastText',
        icon: <CancelIcon fontSize="small" />,
      };
    case 'ongoing':
      return {
        bgcolor: 'secondary.main',
        color: 'secondary.contrastText',
        icon: <PlayArrowIcon fontSize="small" />,
      };
    case 'upcoming':
      return {
        bgcolor: 'action.selected',
        color: 'text.secondary',
        icon: null,
      };
  }
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

  type PlayerLine = NonNullable<MatchLiveStats['playerStats']>['team1'][number];

  const formatKdDiff = (kills: number, deaths: number): string => {
    const diff = kills - deaths;
    if (diff === 0) return '0';
    return diff > 0 ? `+${diff}` : `${diff}`;
  };

  const formatAdr = (player: PlayerLine): string => {
    if (!player.roundsPlayed) return '—';
    const adr = player.damage / Math.max(1, player.roundsPlayed);
    return Math.round(adr).toString();
  };

  const formatKastValue = (kast: number): string => {
    if (!kast) return '—';
    const normalized = kast > 1 ? kast : kast * 100;
    return `${Math.round(normalized)}%`;
  };

  const renderPlayerTable = (rows: PlayerLine[], accent: 'primary' | 'error') => (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Player</TableCell>
            <TableCell align="right">K</TableCell>
            <TableCell align="right">D</TableCell>
            <TableCell align="right">A</TableCell>
            <TableCell align="right">+/-</TableCell>
            <TableCell align="right">ADR</TableCell>
            <TableCell align="right">KAST</TableCell>
            <TableCell align="right">MVP</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} align="center">
                <Typography variant="body2" color="text.secondary">
                  Waiting for stats...
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((player) => (
              <TableRow key={player.steamId}>
                <TableCell sx={{ fontWeight: 600 }}>
                  <Typography variant="body2" color={`${accent}.main`} fontWeight={600}>
                    {player.name}
                  </Typography>
                </TableCell>
                <TableCell align="right">{player.kills}</TableCell>
                <TableCell align="right">{player.deaths}</TableCell>
                <TableCell align="right">{player.assists}</TableCell>
                <TableCell align="right">{formatKdDiff(player.kills, player.deaths)}</TableCell>
                <TableCell align="right">{formatAdr(player)}</TableCell>
                <TableCell align="right">{formatKastValue(player.kast)}</TableCell>
                <TableCell align="right">{player.mvps ?? 0}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );

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

          {/* VS Display */}
          <Paper
            variant="outlined"
            sx={{
              p: 4,
              mb: 3,
              background: 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.05) 100%)',
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Stack spacing={1} alignItems="center" flex={1}>
                <Typography variant="h4" fontWeight={700} color="primary.main">
                  {team?.name}
                </Typography>
                <Typography variant="h1" fontWeight={900} color="primary.main">
                  {mapRoundsTeam1}
                </Typography>
                <Typography variant="body2" color="text.secondary" display="block">
                  Map Rounds
                </Typography>
                <Chip
                  size="small"
                  label={`Series: ${seriesWinsTeam1}`}
                  color="primary"
                  variant="outlined"
                />
              </Stack>
              <Stack spacing={1} alignItems="center" mx={3}>
                <Typography variant="h3" color="text.secondary" fontWeight={700}>
                  VS
                </Typography>
                {liveStatusDisplay && (
                  <Chip
                    label={liveStatusDisplay.label}
                    color={liveStatusDisplay.chipColor}
                    size="small"
                    sx={{ fontWeight: 600 }}
                  />
                )}
              </Stack>
              <Stack spacing={1} alignItems="center" flex={1}>
                <Typography variant="h4" fontWeight={700} color="error.main">
                  {match.opponent?.name || 'TBD'}
                </Typography>
                <Typography variant="h1" fontWeight={900} color="error.main">
                  {mapRoundsTeam2}
                </Typography>
                <Typography variant="body2" color="text.secondary" display="block">
                  Map Rounds
                </Typography>
                <Chip
                  size="small"
                  label={`Series: ${seriesWinsTeam2}`}
                  color="error"
                  variant="outlined"
                />
              </Stack>
            </Box>
          </Paper>

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

          {/* Map Image Display with Server Info */}
          {match.server && currentMapData && (
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                height: 180,
                mb: 2,
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <Box
                component="img"
                src={currentMapData.image}
                alt={currentMapData.displayName}
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: 'brightness(0.4)',
                }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.5))',
                }}
              >
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 700,
                    color: 'white',
                    textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
                  }}
                >
                  {currentMapData.displayName}
                </Typography>
              </Box>

              {/* Server Info Overlay - Bottom Right */}
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  right: 12,
                  textAlign: 'right',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: '0.7rem',
                    display: 'block',
                    textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                  }}
                >
                  {match.server.name}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: '0.7rem',
                    fontFamily: 'monospace',
                    textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                  }}
                >
                  {match.server.host}:{match.server.port}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Connect Buttons */}
          {match.server ? (
            <Stack spacing={2} mb={3}>
              <Button
                variant="contained"
                size="large"
                fullWidth
                color={connected ? 'success' : 'primary'}
                startIcon={<SportsEsportsIcon />}
                onClick={handleConnect}
                sx={{ py: 1.5 }}
              >
                {connected ? '✓ Connecting...' : 'Connect to Server'}
              </Button>

              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={copied ? null : <ContentCopyIcon />}
                onClick={handleCopyIP}
              >
                {copied ? '✓ Copied!' : 'Copy Console Command'}
              </Button>
            </Stack>
          ) : (
            <Alert severity="info" sx={{ mb: 3 }}>
              Server will be assigned when the match is ready. Please check back soon.
            </Alert>
          )}

          {hasPlayerStats && playerStats && (
            <Box mt={3}>
              <Typography variant="h6" fontWeight={600} mb={1}>
                Player Performance
              </Typography>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <Box flex={1}>
                  <Typography variant="subtitle2" color="text.secondary" mb={0.5}>
                    {team?.name || 'Your Team'}
                  </Typography>
                  {renderPlayerTable(playerStats.team1, 'primary')}
                </Box>
                <Box flex={1}>
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    mb={0.5}
                    textAlign={{ xs: 'left', md: 'right' }}
                  >
                    {match.opponent?.name || 'Opponent'}
                  </Typography>
                  {renderPlayerTable(playerStats.team2, 'error')}
                </Box>
              </Stack>
            </Box>
          )}

          {/* Players Accordion */}
          <Accordion sx={{ mb: 3 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box display="flex" alignItems="center" gap={1}>
                <PeopleIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Players
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    {/* Calculate max rows needed */}
                    {Array.from({
                      length: Math.max(
                        team?.players?.length || 0,
                        match.config
                          ? (match.isTeam1
                              ? match.config.team2?.players?.length
                              : match.config.team1?.players?.length) || 0
                          : 0
                      ),
                    }).map((_, idx) => (
                      <TableRow key={idx}>
                        <TableCell sx={{ borderBottom: 'none', py: 1 }}>
                          <Typography variant="body2" color="primary.main" fontWeight={500}>
                            {team?.players && team.players[idx] ? team.players[idx].name : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ borderBottom: 'none', py: 1, textAlign: 'right' }}>
                          <Typography variant="body2" color="error.main" fontWeight={500}>
                            {match.config &&
                            (match.isTeam1
                              ? match.config.team2?.players
                              : match.config.team1?.players)?.[idx]
                              ? (match.isTeam1
                                  ? match.config.team2?.players
                                  : match.config.team1?.players)?.[idx].name
                              : '—'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>

          {/* Map Chips - Bottom Left */}
          {match.maps.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {match.maps.map((map, idx) => {
                const result = match.mapResults.find((mr) => mr.mapNumber === idx);
                let status: 'won' | 'lost' | 'ongoing' | 'upcoming' = 'upcoming';
                if (result) {
                  if (result.team1Score > result.team2Score) {
                    status = 'won';
                  } else if (result.team2Score > result.team1Score) {
                    status = 'lost';
                  }
                } else if (
                  typeof mapNumber === 'number' &&
                  idx === mapNumber &&
                  (match.status === 'live' || match.status === 'loaded')
                ) {
                  status = 'ongoing';
                }
                const chipStyle = getMapChipStyle(status);
                return (
                  <Chip
                    key={idx}
                    label={`${idx + 1}. ${getMapDisplayName(map)}`}
                    size="medium"
                    icon={chipStyle.icon || undefined}
                    sx={{
                      bgcolor: status === 'upcoming' ? 'transparent' : chipStyle.bgcolor,
                      color: chipStyle.color,
                      fontWeight: 600,
                      border: status === 'upcoming' ? '1px dashed' : 'none',
                      borderColor: status === 'upcoming' ? 'divider' : 'transparent',
                      '& .MuiChip-icon': {
                        color: chipStyle.color,
                      },
                    }}
                  />
                );
              })}
            </Stack>
          )}

          {showVetoHistory && (
            <Accordion sx={{ mt: 3 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Veto History
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1}>
                  {vetoActions.map((action, idx) => (
                    <Box
                      key={`${action.step}-${action.action}-${idx}`}
                      sx={{
                        p: 1.5,
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Typography variant="body2">
                        <strong>Step {action.step}:</strong>{' '}
                        {action.team === 'team1' ? vetoTeam1Name : vetoTeam2Name}{' '}
                        <Chip
                          label={action.action.toUpperCase()}
                          size="small"
                          color={
                            action.action === 'ban'
                              ? 'error'
                              : action.action === 'pick'
                              ? 'success'
                              : 'info'
                          }
                          sx={{ mx: 1 }}
                        />
                        {action.mapName ? getMapDisplayName(action.mapName) || action.mapName : '—'}
                        {action.side ? ` (Starting ${action.side})` : ''}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}
