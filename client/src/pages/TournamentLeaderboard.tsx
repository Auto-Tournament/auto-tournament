import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
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
  LinearProgress,
  Link,
  TextField,
  InputAdornment,
  Button,
  Menu,
  MenuItem,
  Grid,
} from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import PersonIcon from '@mui/icons-material/Person';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import { getPlayerPageUrl } from '../utils/playerLinks';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { PlayerName } from '../components/player/PlayerName';
import { TopNavBar } from '../components/layout/TopNavBar';
import { TeamNameLink } from '../components/team/TeamNameLink';
import type { Tournament } from '../types/tournament.types';

interface PlayerLeaderboardEntry {
  playerId: string;
  name: string;
  avatar?: string;
  currentElo: number;
  startingElo: number;
  matchWins: number;
  matchLosses: number;
  winRate: number;
  eloChange: number;
  averageAdr?: number;
}

interface TeamLeaderboardEntry {
  teamId: string;
  name: string;
  tag?: string | null;
  matchWins: number;
  matchLosses: number;
  matchCount: number;
  winRate: number;
}

interface TournamentLeaderboardData {
  tournament: Pick<Tournament, 'id' | 'name' | 'status' | 'type'>;
  leaderboard: PlayerLeaderboardEntry[];
  teams?: TeamLeaderboardEntry[];
  currentRound: number;
  totalRounds: number;
  roundStatus?: {
    roundNumber: number;
    totalMatches: number;
    completedMatches: number;
    pendingMatches: number;
    isComplete: boolean;
    map: string;
  };
}

export default function TournamentLeaderboard() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [data, setData] = useState<TournamentLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);

  // Always set a reasonable tab title, even before the tournament data loads (or if it doesn't exist yet).
  useEffect(() => {
    document.title = t('nav.leaderboard');
  }, [t]);

  const loadStandings = async (showLoading = true) => {
    if (!id) return;

    try {
      if (showLoading) {
        setLoading(true);
      }
      setError('');

      const response = await api.get<TournamentLeaderboardData>(
        `/api/tournament/${id}/leaderboard`
      );

      if (response) {
        setData(response);
        if (response.tournament) {
          document.title = `${response.tournament.name}${t('leaderboardPage.titleSuffix')}`;
        }
      }
    } catch (err: unknown) {
      // Treat 404 / "not found" as a normal empty state instead of a hard error,
      // so a fresh install without a tournament doesn't look broken.
      const message =
        err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const isNotFound =
        typeof message === 'string' &&
        (message.includes('404') || message.toLowerCase().includes('not found'));

      if (isNotFound) {
        setData(null);
        setError('');
      } else {
        setError(t('leaderboardPage.loadError'));
        console.error(err);
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  // Initial load + periodic refresh as a fallback
  useEffect(() => {
    if (!id) return;

    void loadStandings(true);
    // Refresh every 30 seconds without blocking UI
    const interval = setInterval(() => {
      void loadStandings(false);
    }, 30000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, t]);

  // WebSocket-based realtime updates
  useEffect(() => {
    if (!id) return;

    const socket = io();

    const refreshLeaderboardSilently = () => {
      void loadStandings(false);
    };

    const handleMatchUpdate = (payload: Record<string, unknown>) => {
      if (!payload) return;
      const status =
        (payload.status as string | undefined) ??
        (payload as { match_status?: string }).match_status ??
        undefined;

      if (status === 'completed') {
        refreshLeaderboardSilently();
      }
    };

    const tournamentActionsToRefresh = new Set([
      'tournament_reset',
      'tournament_restarted',
      'tournament_updated',
      'tournament_completed',
      'tournament_started',
    ]);

    const handleTournamentUpdate = (event: Record<string, unknown> | undefined) => {
      if (!event) return;
      const action = event.action as string | undefined;
      if (action && tournamentActionsToRefresh.has(action)) {
        refreshLeaderboardSilently();
      }
    };

    const bracketActionsToRefresh = new Set([
      'round_advanced',
      'match_loaded',
      'match_restarted',
      'server_assigned',
      'match_allocated',
      'bracket_regenerated',
    ]);

    const handleBracketUpdate = (event: Record<string, unknown> | undefined) => {
      if (!event) return;
      const action = event.action as string | undefined;
      if (!action || bracketActionsToRefresh.has(action)) {
        refreshLeaderboardSilently();
      }
    };

    socket.on('match:update', handleMatchUpdate);
    socket.on('tournament:update', handleTournamentUpdate);
    socket.on('bracket:update', handleBracketUpdate);

    return () => {
      socket.off('match:update', handleMatchUpdate);
      socket.off('tournament:update', handleTournamentUpdate);
      socket.off('bracket:update', handleBracketUpdate);
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handlePlayerClick = (playerId: string) => {
    window.open(`/player/${playerId}`, '_blank');
  };

  // Filter leaderboard based on search query - must be before early returns
  const filteredLeaderboard = useMemo(() => {
    if (!data || !searchQuery.trim()) {
      return data?.leaderboard || [];
    }
    const query = searchQuery.toLowerCase();
    return (data.leaderboard || []).filter(
      (player) =>
        player.name.toLowerCase().includes(query) || player.playerId.toLowerCase().includes(query)
    );
  }, [data, searchQuery]);

  // Derive top performers (overall tournament) for quick-glance summary
  const topPerformers = useMemo(() => {
    if (!data || !data.leaderboard || data.leaderboard.length === 0) return null;

    const lb = data.leaderboard;

    // Top by wins (then Skill Rating)
    const byWins = [...lb]
      .sort((a, b) => {
        if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins;
        return (b.currentElo ?? 0) - (a.currentElo ?? 0);
      })
      .slice(0, 3);

    // Top by ADR (only players with ADR)
    const withAdr = lb.filter((p) => typeof p.averageAdr === 'number');
    const byAdr = withAdr
      .slice()
      .sort((a, b) => (b.averageAdr ?? 0) - (a.averageAdr ?? 0))
      .slice(0, 3);

    return { byWins, byAdr };
  }, [data]);

  if (loading) {
    return (
      <Box minHeight="100vh" bgcolor="background.default">
        <TopNavBar />
        <Container maxWidth="lg" sx={{ py: 6 }}>
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
            <CircularProgress />
          </Box>
        </Container>
      </Box>
    );
  }

  if (error) {
    return (
      <Box minHeight="100vh" bgcolor="background.default">
        <TopNavBar />
        <Container maxWidth="lg" sx={{ py: 6 }}>
          <Alert severity="error">{error}</Alert>
        </Container>
      </Box>
    );
  }

  // If there's simply no data (for example, no tournament has been created yet),
  // show a gentle empty state instead of crashing or displaying an error.
  if (!data) {
    return (
      <Box
        minHeight="100vh"
        bgcolor="background.default"
        data-testid="public-leaderboard-page"
      >
        <TopNavBar />
        <Container maxWidth="lg" sx={{ py: 6 }}>
          <Stack spacing={3}>
            <Card>
              <CardContent>
                <Box
                  display="flex"
                  alignItems="center"
                  gap={2}
                  role="status"
                  aria-live="polite"
                  aria-labelledby="tournament-leaderboard-empty-title"
                  aria-describedby="tournament-leaderboard-empty-description"
                >
                  <EmojiEventsIcon sx={{ fontSize: 40, color: 'text.disabled' }} aria-hidden="true" />
                  <Box>
                    <Typography
                      id="tournament-leaderboard-empty-title"
                      variant="h5"
                      component="h2"
                      fontWeight={600}
                    >
                      {t('leaderboardPage.emptyTitle')}
                    </Typography>
                    <Typography
                      id="tournament-leaderboard-empty-description"
                      variant="body2"
                      color="text.secondary"
                    >
                      {t('leaderboardPage.emptyDescription')}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </Box>
    );
  }

  const { tournament, leaderboard, currentRound, totalRounds, roundStatus, teams } = data;

  const tournamentTypeKeyPrefix = `tournament.typeSelector.types.${tournament.type}`;

  const getTranslationWithFallback = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const tournamentTypeLabel = getTranslationWithFallback(
    `${tournamentTypeKeyPrefix}.label`,
    tournament.type
  );

  const tournamentTypeDescription = (() => {
    const key = `${tournamentTypeKeyPrefix}.description`;
    const value = t(key);
    return value === key ? '' : value;
  })();

  // Determine tournament status
  const isComplete = tournament.status === 'completed';
  // Backend uses 'setup' | 'in_progress' | 'completed' for tournaments
  const isActive = tournament.status === 'in_progress';

  // Export functions
  const handleExportClick = (event: React.MouseEvent<HTMLElement>) => {
    setExportMenuAnchor(event.currentTarget);
  };

  const handleExportClose = () => {
    setExportMenuAnchor(null);
  };

  const exportToCSV = () => {
    const headers = [
      t('leaderboardPage.rank'),
      t('leaderboardPage.player'),
      t('leaderboardPage.wins'),
      t('leaderboardPage.losses'),
      t('leaderboardPage.winRate'),
      t('leaderboardPage.skillRating'),
      t('leaderboardPage.ratingChange'),
      t('leaderboardPage.avgAdr'),
    ];
    const rows = filteredLeaderboard.map((player, index) => [
      index + 1,
      player.name,
      player.matchWins,
      player.matchLosses,
      `${(player.winRate * 100).toFixed(1)}%`,
      player.currentElo,
      player.eloChange > 0 ? `+${player.eloChange}` : player.eloChange.toString(),
      player.averageAdr ? player.averageAdr.toFixed(1) : 'N/A',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    // eslint-disable-next-line no-undef
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    // Preserve non-Latin characters in filenames; only strip reserved filename symbols
    // and ASCII control characters (0x00-0x1F) without using a control-char regex.
    const withoutReserved = tournament.name.replace(/[<>:"/\\|?*]/g, '');
    const safeName = Array.from(withoutReserved)
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code < 0x00 || code > 0x1f;
      })
      .join('');
    link.setAttribute('download', `${safeName || 'tournament'}_leaderboard.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    handleExportClose();
  };

  const exportToJSON = () => {
    const jsonData = {
      tournament: {
        name: tournament.name,
        status: tournament.status,
        currentRound,
        totalRounds,
      },
      exportedAt: new Date().toISOString(),
      leaderboard: filteredLeaderboard.map((player, index) => ({
        rank: index + 1,
        playerId: player.playerId,
        name: player.name,
        wins: player.matchWins,
        losses: player.matchLosses,
        winRate: player.winRate,
        elo: player.currentElo,
        eloChange: player.eloChange,
        averageAdr: player.averageAdr,
      })),
    };

    // eslint-disable-next-line no-undef
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    // Preserve non-Latin characters in filenames; only strip reserved filename symbols
    // and ASCII control characters (0x00-0x1F) without using a control-char regex.
    const withoutReserved = tournament.name.replace(/[<>:"/\\|?*]/g, '');
    const safeName = Array.from(withoutReserved)
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code < 0x00 || code > 0x1f;
      })
      .join('');
    link.setAttribute('download', `${safeName || 'tournament'}_leaderboard.json`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    handleExportClose();
  };

  return (
    <Box
      minHeight="100vh"
      bgcolor="background.default"
      data-testid="public-leaderboard-page"
    >
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Stack spacing={3}>
          {/* Tournament Header */}
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <EmojiEventsIcon sx={{ fontSize: 48, color: 'primary.main' }} />
                <Box flex={1}>
                  <Typography variant="h3" fontWeight={700} gutterBottom>
                    {tournament.name}
                  </Typography>
                  <Box display="flex" gap={1} flexWrap="wrap">
                    <Chip
                      label={
                        isComplete
                          ? t('leaderboardPage.completed')
                          : isActive
                            ? t('leaderboardPage.inProgress')
                            : t('leaderboardPage.setup')
                      }
                      color={isComplete ? 'success' : isActive ? 'primary' : 'default'}
                      sx={{ fontWeight: 600 }}
                    />
                    <Chip label={tournamentTypeLabel} color="info" />
                    {roundStatus && (
                      <Chip
                        label={t('leaderboardPage.roundOf', {
                          current: roundStatus.roundNumber,
                          total: totalRounds,
                        })}
                        variant="outlined"
                      />
                    )}
                  </Box>
                </Box>
              </Box>

              {/* Quick-glance top performers */}
              {topPerformers && (
                <Box mt={3}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                        {t('leaderboardPage.topByWins')}
                      </Typography>
                      {topPerformers.byWins.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {t('leaderboardPage.noMatchesYet')}
                        </Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {topPerformers.byWins.map((player, index) => (
                            <Box
                              key={player.playerId}
                              display="flex"
                              justifyContent="space-between"
                              alignItems="center"
                            >
                              <Typography
                                variant="body2"
                                component="a"
                                href={getPlayerPageUrl(player.playerId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                  textDecoration: 'none',
                                  cursor: 'pointer',
                                  color: 'text.primary',
                                  '&:hover': { textDecoration: 'underline' },
                                }}
                              >
                                {index + 1}.{' '}
                                <PlayerName
                                  name={player.name}
                                  // Leaderboard entries currently don't expose isAdmin; this can be extended later.
                                  variant="body2"
                                />
                              </Typography>
                              <Chip
                                label={`${player.matchWins}${t('leaderboardPage.winsShort')} / ${player.matchLosses}${t('leaderboardPage.lossesShort')}`}
                                size="small"
                                color={index === 0 ? 'primary' : 'default'}
                              />
                            </Box>
                          ))}
                        </Stack>
                      )}
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                        {t('leaderboardPage.topByAdr')}
                      </Typography>
                      {topPerformers.byAdr.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {t('leaderboardPage.adrDataLater')}
                        </Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {topPerformers.byAdr.map((player, index) => (
                            <Box
                              key={player.playerId}
                              display="flex"
                              justifyContent="space-between"
                              alignItems="center"
                            >
                              <Typography
                                variant="body2"
                                component="a"
                                href={getPlayerPageUrl(player.playerId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                  textDecoration: 'none',
                                  cursor: 'pointer',
                                  color: 'text.primary',
                                  '&:hover': { textDecoration: 'underline' },
                                }}
                              >
                                {index + 1}.{' '}
                                <PlayerName
                                  name={player.name}
                                  variant="body2"
                                />
                              </Typography>
                              <Chip
                                label={`${player.averageAdr?.toFixed(1) ?? 'N/A'} ADR`}
                                size="small"
                                variant={index === 0 ? 'filled' : 'outlined'}
                                color={index === 0 ? 'secondary' : 'default'}
                              />
                            </Box>
                          ))}
                        </Stack>
                      )}
                    </Grid>
                  </Grid>
                </Box>
              )}

              {/* Round Progress */}
              {roundStatus && isActive && (
                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="body2" color="text.secondary">
                      {t('leaderboardPage.roundMap', {
                        round: roundStatus.roundNumber,
                        map: roundStatus.map,
                      })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('leaderboardPage.matchesCompleted', {
                        completed: roundStatus.completedMatches,
                        total: roundStatus.totalMatches,
                      })}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={(roundStatus.completedMatches / roundStatus.totalMatches) * 100}
                    sx={{ height: 8, borderRadius: 1 }}
                  />
                </Box>
              )}

              {isComplete && (
                <Alert severity="success" sx={{ mt: 2 }}>
                  {t('leaderboardPage.tournamentCompletedAlert')}
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Team Standings (for standard tournaments) */}
          {teams && teams.length > 0 && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <EmojiEventsIcon color="secondary" />
                  <Typography variant="h5" fontWeight={600}>
                    {t('leaderboardPage.teamStandings')}
                  </Typography>
                  <Chip
                    label={t('leaderboardPage.teamsCount', { count: teams.length })}
                    size="small"
                    variant="outlined"
                  />
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600, width: 60 }}>#</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('leaderboardPage.team')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('leaderboardPage.wins')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('leaderboardPage.losses')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('leaderboardPage.matches')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('leaderboardPage.winRate')}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {teams.map((team, index) => (
                        <TableRow key={team.teamId}>
                          <TableCell>
                            <Typography
                              variant="body1"
                              fontWeight={index === 0 ? 700 : 600}
                              color={index === 0 ? 'primary.main' : 'text.primary'}
                            >
                              {index + 1}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <TeamNameLink
                              teamId={team.teamId}
                              name={team.name}
                              tag={team.tag ?? undefined}
                              showTag
                              variant="body1"
                              sx={{ fontWeight: 600 }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body1" fontWeight={600} color="success.main">
                              {team.matchWins}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body1" color="error.main">
                              {team.matchLosses}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            {team.matchCount}
                          </TableCell>
                          <TableCell align="right">
                            <Chip
                              label={`${(team.winRate * 100).toFixed(1)}%`}
                              size="small"
                              color={team.winRate >= 0.5 ? 'success' : 'default'}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          )}

          {/* Player Leaderboard */}
          <Card data-testid="public-leaderboard">
            <CardContent>
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                mb={3}
                flexWrap="wrap"
                gap={2}
              >
                <Box display="flex" alignItems="center" gap={1}>
                  <EmojiEventsIcon color="primary" />
                  <Typography variant="h5" fontWeight={600}>
                    {t('leaderboardPage.leaderboardTitle')}
                  </Typography>
                  <Chip
                    label={t('leaderboardPage.playersFiltered', {
                      filtered: filteredLeaderboard.length,
                      total: leaderboard.length,
                    })}
                    size="small"
                    variant="outlined"
                  />
                </Box>
                <Box display="flex" gap={1} flexWrap="wrap">
                  <TextField
                    size="small"
                    placeholder={t('leaderboardPage.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                    sx={{ minWidth: 200 }}
                  />
                  <Button
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    onClick={handleExportClick}
                  >
                    {t('leaderboardPage.export')}
                  </Button>
                  <Menu
                    anchorEl={exportMenuAnchor}
                    open={Boolean(exportMenuAnchor)}
                    onClose={handleExportClose}
                  >
                    <MenuItem onClick={exportToCSV}>{t('leaderboardPage.exportCsv')}</MenuItem>
                    <MenuItem onClick={exportToJSON}>{t('leaderboardPage.exportJson')}</MenuItem>
                  </Menu>
                </Box>
              </Box>

              {leaderboard.length === 0 ? (
                <Box textAlign="center" py={4}>
                  <PersonIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="body1" color="text.secondary">
                    {t('leaderboardPage.noPlayersRegistered')}
                  </Typography>
                </Box>
              ) : filteredLeaderboard.length === 0 ? (
                <Box textAlign="center" py={4}>
                  <SearchIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="body1" color="text.secondary">
                    {t('leaderboardPage.searchNoMatch', { query: searchQuery })}
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600, width: 60 }}>#</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('leaderboardPage.player')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('leaderboardPage.wins')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('leaderboardPage.losses')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('leaderboardPage.winRate')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('leaderboardPage.skillRating')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('leaderboardPage.ratingChange')}
                        </TableCell>
                        {leaderboard.some((p) => p.averageAdr) && (
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {t('leaderboardPage.avgAdr')}
                          </TableCell>
                        )}
                        <TableCell sx={{ width: 100 }}></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredLeaderboard.map((player, _index) => {
                        // Calculate actual rank in full leaderboard
                        const actualRank =
                          leaderboard.findIndex((p) => p.playerId === player.playerId) + 1;
                        return (
                          <TableRow
                            key={player.playerId}
                            sx={{
                              '&:hover': { bgcolor: 'action.hover' },
                              ...(actualRank <= 3 && {
                                bgcolor: 'action.selected',
                              }),
                            }}
                          >
                            <TableCell>
                              <Box display="flex" alignItems="center" gap={1}>
                                {actualRank === 1 && (
                                  <EmojiEventsIcon sx={{ color: 'gold', fontSize: 20 }} />
                                )}
                                {actualRank === 2 && (
                                  <EmojiEventsIcon sx={{ color: 'silver', fontSize: 20 }} />
                                )}
                                {actualRank === 3 && (
                                  <EmojiEventsIcon sx={{ color: '#CD7F32', fontSize: 20 }} />
                                )}
                                <Typography
                                  variant="body1"
                                  fontWeight={actualRank <= 3 ? 700 : 600}
                                  color={actualRank <= 3 ? 'primary.main' : 'text.primary'}
                                >
                                  {actualRank}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Box display="flex" alignItems="center" gap={2}>
                                <PlayerAvatar
                                  id={player.playerId}
                                  name={player.name}
                                  avatarUrl={player.avatar}
                                  size={40}
                                />
                                <Typography variant="body1" fontWeight={600}>
                                  {player.name}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body1" fontWeight={600} color="success.main">
                                {player.matchWins}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body1" color="error.main">
                                {player.matchLosses}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Chip
                                label={`${(player.winRate * 100).toFixed(1)}%`}
                                size="small"
                                color={player.winRate >= 0.5 ? 'success' : 'default'}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body1" fontWeight={600}>
                                {player.currentElo}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              {player.eloChange !== 0 && (
                                <Chip
                                  label={`${player.eloChange > 0 ? '+' : ''}${player.eloChange}`}
                                  size="small"
                                  color={player.eloChange > 0 ? 'success' : 'error'}
                                />
                              )}
                            </TableCell>
                            {leaderboard.some((p) => p.averageAdr) && (
                              <TableCell align="right">
                                {player.averageAdr ? (
                                  <Typography variant="body2">
                                    {player.averageAdr.toFixed(1)}
                                  </Typography>
                                ) : (
                                  <Typography variant="body2" color="text.secondary">
                                    N/A
                                  </Typography>
                                )}
                              </TableCell>
                            )}
                            <TableCell>
                              <Link
                                component="button"
                                variant="body2"
                                onClick={() => handlePlayerClick(player.playerId)}
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 0.5,
                                  cursor: 'pointer',
                                }}
                              >
                                View
                                <OpenInNewIcon fontSize="small" />
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                {tournamentTypeLabel}
              </Typography>
              {tournamentTypeDescription && (
                <Typography variant="body2" color="text.secondary" paragraph>
                  {tournamentTypeDescription}
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                Click on any player&apos;s name or the &quot;View&quot; link to see their detailed
                profile, match history, and Skill Rating progression.
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
}
