import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  Stack,
  Chip,
  Divider,
  Grid,
  Card,
  CardContent,
  Button,
  Alert,
  Tooltip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import GroupsIcon from '@mui/icons-material/Groups';
import MapIcon from '@mui/icons-material/Map';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FastForwardIcon from '@mui/icons-material/FastForward';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PendingIcon from '@mui/icons-material/Pending';
import LinkIcon from '@mui/icons-material/Link';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { formatDate, formatDuration, getStatusColor } from '../../utils/matchUtils';
import { api } from '../../utils/api';
import { usePlayerConnections } from '../../hooks/usePlayerConnections';
import { copyTeamMatchUrl } from '../../utils/teamLinks';

interface Team {
  id: string;
  name: string;
  tag?: string;
}

interface PlayerStats {
  name: string;
  steamId: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshots: number;
}

interface Match {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  team1?: Team;
  team2?: Team;
  winner?: Team;
  status: 'pending' | 'ready' | 'live' | 'completed' | 'loaded';
  serverId?: string;
  serverName?: string;
  createdAt?: number;
  loadedAt?: number;
  completedAt?: number;
  team1Score?: number;
  team2Score?: number;
  team1Players?: PlayerStats[];
  team2Players?: PlayerStats[];
  matchPhase?: string; // warmup, knife, veto, live, post_match
  config?: {
    maplist?: string[];
    num_maps?: number;
    team1?: { name: string };
    team2?: { name: string };
  };
}

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
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedTeam, setCopiedTeam] = useState<'team1' | 'team2' | null>(null);

  // Player connection status
  const { status: connectionStatus } = usePlayerConnections(match?.slug || null);

  const handleCopyTeamLink = async (teamId: string | undefined, teamNumber: 'team1' | 'team2') => {
    if (!teamId) return;
    const success = await copyTeamMatchUrl(teamId);
    if (success) {
      setCopiedTeam(teamNumber);
      setTimeout(() => setCopiedTeam(null), 2000);
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

  const handleAdminAction = async (action: string) => {
    if (!match?.serverId) {
      setError('No server assigned to this match');
      return;
    }

    setExecuting(true);
    setError('');
    setSuccess('');

    try {
      const endpoints: Record<string, string> = {
        pause: '/api/rcon/force-pause',
        unpause: '/api/rcon/force-unpause',
        startMatch: '/api/rcon/start-match',
        endWarmup: '/api/rcon/end-warmup',
      };

      const endpoint = endpoints[action];
      if (!endpoint) {
        throw new Error('Unknown action');
      }

      await api.post(endpoint, { serverId: match.serverId });

      const messages: Record<string, string> = {
        pause: 'Match paused successfully',
        unpause: 'Match unpaused successfully',
        startMatch: 'Match force started',
        endWarmup: 'Warmup ended',
      };

      setSuccess(messages[action] || 'Command executed');
      setConfirmAction(null);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to execute command');
    } finally {
      setExecuting(false);
    }
  };

  const getMatchPhaseDisplay = () => {
    if (match?.matchPhase) {
      const phases: Record<string, { label: string; color: string }> = {
        warmup: { label: 'WARMUP', color: 'info' },
        knife: { label: 'KNIFE ROUND', color: 'warning' },
        veto: { label: 'VETO PHASE', color: 'secondary' },
        live: { label: 'LIVE', color: 'error' },
        post_match: { label: 'POST-MATCH', color: 'success' },
      };
      return phases[match.matchPhase] || null;
    }
    return null;
  };

  if (!match) return null;

  return (
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
          <IconButton onClick={onClose}>
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
                label={match.status.toUpperCase()}
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
                    <Tooltip title={copiedTeam === 'team1' ? 'Copied!' : 'Copy team match link'}>
                      <IconButton
                        size="small"
                        onClick={() => handleCopyTeamLink(match.team1?.id, 'team1')}
                        color={copiedTeam === 'team1' ? 'success' : 'default'}
                      >
                        {copiedTeam === 'team1' ? (
                          <ContentCopyIcon fontSize="small" />
                        ) : (
                          <LinkIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
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
                      color: match.winner?.id === match.team1?.id ? 'success.main' : 'text.primary',
                    }}
                  >
                    {match.team1Score || 0}
                  </Typography>
                  <Typography variant="h3" color="text.disabled">
                    -
                  </Typography>
                  <Typography
                    variant="h2"
                    fontWeight={700}
                    sx={{
                      color: match.winner?.id === match.team2?.id ? 'success.main' : 'text.primary',
                    }}
                  >
                    {match.team2Score || 0}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary" mt={1}>
                  Rounds Won
                </Typography>
              </Box>

              {/* Team 2 */}
              <Box flex={1} textAlign="right">
                <Box display="flex" alignItems="center" justifyContent="flex-end" gap={1}>
                  {match.team2?.id && (
                    <Tooltip title={copiedTeam === 'team2' ? 'Copied!' : 'Copy team match link'}>
                      <IconButton
                        size="small"
                        onClick={() => handleCopyTeamLink(match.team2?.id, 'team2')}
                        color={copiedTeam === 'team2' ? 'success' : 'default'}
                      >
                        {copiedTeam === 'team2' ? (
                          <ContentCopyIcon fontSize="small" />
                        ) : (
                          <LinkIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
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

          {/* Player Connection Status */}
          {connectionStatus && connectionStatus.totalConnected > 0 && (
            <>
              <Divider />
              <Box>
                <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <GroupsIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={600}>
                      Connected Players
                    </Typography>
                  </Box>
                  <Chip
                    label={`${connectionStatus.totalConnected}/10`}
                    color={connectionStatus.totalConnected >= 10 ? 'success' : 'warning'}
                    size="small"
                  />
                </Box>
                <Grid container spacing={2}>
                  {/* Team 1 */}
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" fontWeight={600} mb={2}>
                          {match.team1?.name || 'Team 1'} ({connectionStatus.team1Connected}/5)
                        </Typography>
                        <Stack spacing={1}>
                          {connectionStatus.connectedPlayers
                            .filter((p) => p.team === 'team1')
                            .map((player) => (
                              <Box
                                key={player.steamId}
                                display="flex"
                                alignItems="center"
                                gap={1}
                                sx={{
                                  p: 1,
                                  bgcolor: 'action.hover',
                                  borderRadius: 1,
                                }}
                              >
                                {player.isReady ? (
                                  <CheckCircleIcon sx={{ fontSize: 20, color: 'success.main' }} />
                                ) : (
                                  <PendingIcon sx={{ fontSize: 20, color: 'grey.500' }} />
                                )}
                                <Typography variant="body2" flex={1}>
                                  {player.name}
                                </Typography>
                                <Chip
                                  label={player.isReady ? 'Ready' : 'Connected'}
                                  size="small"
                                  color={player.isReady ? 'success' : 'default'}
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                              </Box>
                            ))}
                          {connectionStatus.team1Connected === 0 && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ py: 2, textAlign: 'center' }}
                            >
                              No players connected yet
                            </Typography>
                          )}
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>

                  {/* Team 2 */}
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" fontWeight={600} mb={2}>
                          {match.team2?.name || 'Team 2'} ({connectionStatus.team2Connected}/5)
                        </Typography>
                        <Stack spacing={1}>
                          {connectionStatus.connectedPlayers
                            .filter((p) => p.team === 'team2')
                            .map((player) => (
                              <Box
                                key={player.steamId}
                                display="flex"
                                alignItems="center"
                                gap={1}
                                sx={{
                                  p: 1,
                                  bgcolor: 'action.hover',
                                  borderRadius: 1,
                                }}
                              >
                                {player.isReady ? (
                                  <CheckCircleIcon sx={{ fontSize: 20, color: 'success.main' }} />
                                ) : (
                                  <PendingIcon sx={{ fontSize: 20, color: 'grey.500' }} />
                                )}
                                <Typography variant="body2" flex={1}>
                                  {player.name}
                                </Typography>
                                <Chip
                                  label={player.isReady ? 'Ready' : 'Connected'}
                                  size="small"
                                  color={player.isReady ? 'success' : 'default'}
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                              </Box>
                            ))}
                          {connectionStatus.team2Connected === 0 && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ py: 2, textAlign: 'center' }}
                            >
                              No players connected yet
                            </Typography>
                          )}
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              </Box>
            </>
          )}

          {/* Player Leaderboards */}
          {(match.team1Players || match.team2Players) && (
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
                        {match.team1Players && match.team1Players.length > 0 ? (
                          <Stack spacing={1}>
                            {match.team1Players
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
                        {match.team2Players && match.team2Players.length > 0 ? (
                          <Stack spacing={1}>
                            {match.team2Players
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

          {match.config?.maplist && (
            <>
              <Divider />
              <Box>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <MapIcon color="primary" />
                  <Typography variant="subtitle1" fontWeight={600}>
                    Maps
                  </Typography>
                </Box>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {match.config.maplist.map((map, idx) => (
                    <Chip key={idx} label={map} />
                  ))}
                </Box>
              </Box>
            </>
          )}

          <Divider />

          <Box>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
              <CalendarTodayIcon color="primary" />
              <Typography variant="subtitle1" fontWeight={600}>
                Match Information
              </Typography>
            </Box>
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
          </Box>

          {/* Admin Controls */}
          {match.serverId && match.status === 'live' && (
            <>
              <Divider />
              <Box>
                <Typography variant="subtitle1" fontWeight={600} mb={2} color="primary">
                  ⚡ Admin Controls
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      color="warning"
                      startIcon={<PauseIcon />}
                      onClick={() => setConfirmAction('pause')}
                      disabled={executing}
                    >
                      Pause
                    </Button>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      color="success"
                      startIcon={<PlayArrowIcon />}
                      onClick={() => setConfirmAction('unpause')}
                      disabled={executing}
                    >
                      Unpause
                    </Button>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      color="info"
                      startIcon={<FastForwardIcon />}
                      onClick={() => setConfirmAction('endWarmup')}
                      disabled={executing}
                    >
                      End Warmup
                    </Button>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      color="error"
                      startIcon={<RocketLaunchIcon />}
                      onClick={() => setConfirmAction('startMatch')}
                      disabled={executing}
                    >
                      Force Start
                    </Button>
                  </Grid>
                </Grid>
                <Alert severity="warning" sx={{ mt: 2 }}>
                  ⚠️ Admin controls affect the live match immediately. Use with caution.
                </Alert>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmAction} onClose={() => !executing && setConfirmAction(null)}>
        <DialogTitle>Confirm Action</DialogTitle>
        <DialogContent>
          <Typography>
            {confirmAction === 'pause' &&
              'This will pause the match. Players will not be able to unpause until you force unpause. Continue?'}
            {confirmAction === 'unpause' && 'This will immediately unpause the match. Continue?'}
            {confirmAction === 'endWarmup' &&
              'This will end the warmup period and move to the next phase. Continue?'}
            {confirmAction === 'startMatch' &&
              'This will force start the match immediately, skipping any remaining warmup or veto phases. Continue?'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmAction(null)} disabled={executing}>
            Cancel
          </Button>
          <Button
            onClick={() => confirmAction && handleAdminAction(confirmAction)}
            variant="contained"
            color="error"
            disabled={executing}
          >
            {executing ? 'Executing...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default MatchDetailsModal;
