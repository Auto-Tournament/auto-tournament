import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  Stack,
  Chip,
  Divider,
  Grid,
  Card,
  CardContent,
  Alert,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import GroupsIcon from '@mui/icons-material/Groups';
import MapIcon from '@mui/icons-material/Map';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LinkIcon from '@mui/icons-material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
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
import AdminMatchControls from '../admin/AdminMatchControls';
import { PlayerRoster } from '../match/PlayerRoster';
import { AddBackupPlayer } from '../admin/AddBackupPlayer';
import { getMapData, getMapDisplayName } from '../../constants/maps';
import { getPhaseDisplay } from '../../types/matchPhase.types';
import type { Match } from '../../types';
import { useTournamentStatus } from '../../hooks/useTournamentStatus';

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

  // Player connection status
  const { status: connectionStatus } = usePlayerConnections(match?.slug || null);
  const { stats: liveStats } = useLiveStats(match?.slug || null);

  // Team link copy with toast
  const { copyLink, ToastNotification } = useTeamLinkCopy();

  const { status: tournamentStatus } = useTournamentStatus();
  const tournamentStarted = tournamentStatus === 'in_progress' || tournamentStatus === 'completed';

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

  const getMatchPhaseDisplay = () => {
    if (match?.matchPhase) {
      return getPhaseDisplay(match.matchPhase);
    }
    return null;
  };

  if (!match) return null;

  const mapRoundsTeam1 = liveStats?.team1Score ?? match.team1Score ?? 0;
  const mapRoundsTeam2 = liveStats?.team2Score ?? match.team2Score ?? 0;
  const seriesWinsTeam1 = liveStats?.team1SeriesScore ?? 0;
  const seriesWinsTeam2 = liveStats?.team2SeriesScore ?? 0;
  const activeMapNumber = liveStats?.mapNumber ?? match.mapNumber ?? null;
  const mapList =
    (match.config?.maplist && match.config?.maplist.length > 0 ? match.config?.maplist : []) ?? [];
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
  const livePlayerStats = liveStats?.playerStats ?? null;
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
            {/* Error/Success Messages */}
            {error && (
              <Alert severity="error" onClose={() => setError('')}>
                {error}
              </Alert>
            )}
            {success && (
              <Alert severity="success" onClose={() => setSuccess('')}>
                {success}
              </Alert>
            )}

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
                    match.vetoCompleted,
                    tournamentStarted
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
                  match.vetoCompleted,
                  tournamentStarted
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
                      {mapRoundsTeam1}
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
                      {mapRoundsTeam2}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" mt={1}>
                    Map Rounds
                  </Typography>
                  <Box display="flex" alignItems="center" justifyContent="center" gap={1} mt={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      Series Maps
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {seriesWinsTeam1}
                    </Typography>
                    <Typography variant="body2" color="text.disabled">
                      -
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {seriesWinsTeam2}
                    </Typography>
                  </Box>
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

            {/* Player Roster */}
            {match.config && (match.status === 'loaded' || match.status === 'live') && (
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
                                      <Typography variant="body2" fontWeight={600}>
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
                                      <Typography variant="body2" fontWeight={600}>
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
                      backgroundImage: activeMapKey
                        ? `url(${getMapData(activeMapKey)?.image})`
                        : 'none',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      height: 200,
                      display: 'flex',
                      alignItems: 'flex-end',
                      '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
                      },
                    }}
                  >
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

            <Accordion defaultExpanded sx={{ mt: 2 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box display="flex" alignItems="center" gap={1}>
                  <MapIcon color="primary" />
                  <Typography variant="subtitle1" fontWeight={600}>
                    Maps
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                {mapList.length > 0 ? (
                  <Box display="flex" flexWrap="wrap" gap={1}>
                    {mapList.map((map, idx) => {
                      const displayName = getMapDisplayName(map) || map;
                      const labelBase = `${idx + 1}. ${displayName}`;
                      const result = match.mapResults?.find((mr) => mr.mapNumber === idx);
                      let chipLabel = labelBase;
                      let chipColor: 'default' | 'success' | 'error' | 'secondary' = 'default';
                      if (result) {
                        chipLabel = `${labelBase} • ${result.team1Score}-${result.team2Score}`;
                        chipColor = result.team1Score > result.team2Score ? 'success' : 'error';
                      } else if (activeMapNumber === idx && currentMapLabel) {
                        chipLabel = `${labelBase} • Live`;
                        chipColor = 'secondary';
                      }
                      return (
                        <Chip
                          key={`${map}-${idx}`}
                          label={chipLabel}
                          color={chipColor}
                          variant={chipColor === 'default' ? 'outlined' : 'filled'}
                        />
                      );
                    })}
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
      </Dialog>

      <ToastNotification />
    </>
  );
};

export default MatchDetailsModal;
