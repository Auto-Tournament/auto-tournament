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
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import GroupsIcon from '@mui/icons-material/Groups';
import MapIcon from '@mui/icons-material/Map';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { formatDate, formatDuration, getStatusColor } from '../../utils/matchUtils';

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
  status: 'pending' | 'ready' | 'live' | 'completed';
  createdAt?: number;
  loadedAt?: number;
  completedAt?: number;
  team1Score?: number;
  team2Score?: number;
  team1Players?: PlayerStats[];
  team2Players?: PlayerStats[];
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
          {/* Status and Timer */}
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Chip
              label={match.status.toUpperCase()}
              color={getStatusColor(match.status)}
              sx={{ fontWeight: 600 }}
            />
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
                <Typography variant="h5" fontWeight={700}>
                  {match.team1?.name || (match.status === 'completed' ? '—' : 'TBD')}
                </Typography>
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
                <Typography variant="h5" fontWeight={700}>
                  {match.team2?.name || (match.status === 'completed' ? '—' : 'TBD')}
                </Typography>
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
        </Stack>
      </DialogContent>
    </Dialog>
  );
};

export default MatchDetailsModal;
