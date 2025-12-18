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
import type { Match } from '../../types';
import { useTournamentStatus } from '../../hooks/useTournamentStatus';
import { MapChipList } from '../match/MapChipList';
import { MapDemoDownloads } from '../match/MapDemoDownloads';
import { FadeInImage } from '../common/FadeInImage';
import { api } from '../../utils/api';

interface MatchDetailsModalProps {
  match: Match | null;
  matchNumber: number;
  roundLabel: string;
  onClose: () => void;
}

const MatchDetailsModal: React.FC<MatchDetailsModalProps> = ({
  match,
  matchNumber,
  roundLabel,
  onClose,
}) => {
  const [matchTimer, setMatchTimer] = useState<number>(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configJson, setConfigJson] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  // Player connection status
  const { status: connectionStatus } = usePlayerConnections(match?.slug || null);
  const { stats: liveStats } = useLiveStats(match?.slug || null);

  // Team link copy with toast
  const { copyLink, ToastNotification } = useTeamLinkCopy();

  const { status: tournamentStatus } = useTournamentStatus();
  const tournamentStarted = tournamentStatus === 'in_progress' || tournamentStatus === 'completed';

  // Calculate derived series wins before early return (React hooks rule)
  const derivedSeriesWins = useMemo(() => {
    if (!match) {
      return { team1: 0, team2: 0 };
    }
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
      team1: liveStats?.team1SeriesScore ?? match.team1Score ?? 0,
      team2: liveStats?.team2SeriesScore ?? match.team2Score ?? 0,
    };
  }, [match, liveStats?.team1SeriesScore, liveStats?.team2SeriesScore]);

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

  if (!match) return null;

  const mapRoundsTeam1 = liveStats?.team1Score ?? match.team1Score ?? 0;
  const mapRoundsTeam2 = liveStats?.team2Score ?? match.team2Score ?? 0;
  const activeMapNumber = liveStats?.mapNumber ?? match.mapNumber ?? null;
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
  const activeMapKey =
    liveStats?.mapName ||
    match.currentMap ||
    (typeof activeMapNumber === 'number' && mapList[activeMapNumber]
      ? mapList[activeMapNumber]
      : null);
  const currentMapLabel = activeMapKey ? getMapDisplayName(activeMapKey) || activeMapKey : null;
  const roundNumber = liveStats?.roundNumber ?? null;
  const totalMapCount =
    liveStats?.totalMaps ??
    match.config?.num_maps ??
    (mapList.length > 0 ? mapList.length : match.mapResults?.length) ??
    undefined;

  const seriesWinsTeam1 = derivedSeriesWins.team1;
  const seriesWinsTeam2 = derivedSeriesWins.team2;
  const livePlayerStats = liveStats?.playerStats ?? null;

  // Detect shuffle matches (temporary shuffle team IDs or config IDs)
  const isShuffleMatch =
    match.team1?.id?.startsWith('shuffle-') ||
    match.team2?.id?.startsWith('shuffle-') ||
    (typeof match.config === 'object' &&
      match.config !== null &&
      'team1' in match.config &&
      (match.config.team1 as { id?: string } | undefined)?.id?.startsWith?.('shuffle-')) ||
    (typeof match.config === 'object' &&
      match.config !== null &&
      'team2' in match.config &&
      (match.config.team2 as { id?: string } | undefined)?.id?.startsWith?.('shuffle-'));

  // Shuffle tournaments don't use veto - treat as completed to avoid "VETO PENDING" labels
  const effectiveVetoCompleted = isShuffleMatch ? true : match.vetoCompleted;
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
    : match.team1Players || [];
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
    : match.team2Players || [];

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
                      {match.team1?.name || (match.status === 'completed' ? '—' : 'TBD')}
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
                  {match.winner?.id === match.team1?.id && (
                    <Box mt={1}>
                      <EmojiEventsIcon sx={{ color: 'success.main', fontSize: 28 }} />
                    </Box>
                  )}
                </Box>

                {/* Scores */}
                <Box textAlign="center" minWidth={120}>
                  <Box display="flex" alignItems="center" justifyContent="center" gap={2}>
                    <Typography
                      variant="h2"
                      fontWeight={700}
                      sx={{
                        color:
                          match.winner?.id === match.team1?.id ? 'success.main' : 'text.primary',
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
                        color:
                          match.winner?.id === match.team2?.id ? 'success.main' : 'text.primary',
                      }}
                    >
                      {seriesWinsTeam2}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" mt={1}>
                    Series Maps Won
                  </Typography>
                  <Box display="flex" alignItems="center" justifyContent="center" gap={2} mt={1}>
                    <Typography
                      variant="h4"
                      fontWeight={700}
                      sx={{
                        color:
                          match.winner?.id === match.team1?.id ? 'success.main' : 'text.primary',
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
                        color:
                          match.winner?.id === match.team2?.id ? 'success.main' : 'text.primary',
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
                      {`Map ${activeMapNumber !== null ? activeMapNumber + 1 : ''}${
                        totalMapCount ? ` of ${totalMapCount}` : ''
                      }: ${currentMapLabel}`}
                    </Typography>
                  )}
                  {roundNumber !== null && (
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
                      {match.team2?.name || (match.status === 'completed' ? '—' : 'TBD')}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {match.team2?.tag}
                  </Typography>
                  {match.winner?.id === match.team2?.id && (
                    <Box mt={1}>
                      <EmojiEventsIcon sx={{ color: 'success.main', fontSize: 28 }} />
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>

            {/* Player Roster
                For shuffle tournaments, we already know the teams before server allocation,
                so show the roster even while matches are still pending. */}
            {match.config && (isShuffleMatch || match.status === 'loaded' || match.status === 'live') && (
              <>
                <Divider />
                <Box>
                  <PlayerRoster
                    team1Name={match.team1?.name || 'Team 1'}
                    team2Name={match.team2?.name || 'Team 2'}
                    team1Players={match.config?.team1?.players || []}
                    team2Players={match.config?.team2?.players || []}
                    connectedPlayers={connectionStatus?.connectedPlayers || []}
                  />
                </Box>
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
                            {match.team1?.name || 'Team 1'}
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
                            {match.team2?.name || 'Team 2'}
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
            <Button
              variant="outlined"
              size="small"
              startIcon={<CodeIcon />}
              onClick={handleOpenConfigModal}
            >
              View Match Config JSON
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <ToastNotification />

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

export default MatchDetailsModal;
