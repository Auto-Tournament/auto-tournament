import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
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
  Avatar,
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
import { api } from '../utils/api';
import { getPlayerPageUrl } from '../utils/playerLinks';

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

interface TournamentLeaderboardData {
  tournament: {
    id: number;
    name: string;
    status: string;
    type: string;
  };
  leaderboard: PlayerLeaderboardEntry[];
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
  const [data, setData] = useState<TournamentLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (id) {
      loadStandings();
      // Refresh every 30 seconds
      const interval = setInterval(loadStandings, 30000);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadStandings = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError('');

      const response = await api.get<TournamentLeaderboardData>(`/api/tournament/${id}/leaderboard`);

      if (response) {
        setData(response);
        if (response.tournament) {
          document.title = `${response.tournament.name} - Leaderboard`;
        }
      }
    } catch (err) {
      setError('Failed to load tournament leaderboard');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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

    // Top by wins (then ELO)
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
      <Box minHeight="100vh" bgcolor="background.default" py={6}>
        <Container maxWidth="lg">
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
            <CircularProgress />
          </Box>
        </Container>
      </Box>
    );
  }

  if (error || !data) {
    return (
      <Box minHeight="100vh" bgcolor="background.default" py={6}>
        <Container maxWidth="lg">
          <Alert severity="error">{error || 'Tournament not found'}</Alert>
        </Container>
      </Box>
    );
  }

  const { tournament, leaderboard, currentRound, totalRounds, roundStatus } = data;

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
      'Rank',
      'Player',
      'Wins',
      'Losses',
      'Win Rate',
      'ELO',
      'ELO Change',
      'Avg ADR',
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
    link.setAttribute('download', `${tournament.name.replace(/[^a-z0-9]/gi, '_')}_leaderboard.csv`);
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
    link.setAttribute('download', `${tournament.name.replace(/[^a-z0-9]/gi, '_')}_leaderboard.json`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    handleExportClose();
  };

  return (
    <Box minHeight="100vh" bgcolor="background.default" py={6} data-testid="public-leaderboard-page">
      <Container maxWidth="lg">
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
                      label={isComplete ? 'Completed' : isActive ? 'In Progress' : 'Setup'}
                      color={isComplete ? 'success' : isActive ? 'primary' : 'default'}
                      sx={{ fontWeight: 600 }}
                    />
                    <Chip label="Shuffle Tournament" color="info" />
                    {roundStatus && (
                      <Chip
                        label={`Round ${roundStatus.roundNumber} of ${totalRounds}`}
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
                        Top Players by Wins
                      </Typography>
                      {topPerformers.byWins.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No matches played yet.
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
                                {index + 1}. {player.name}
                              </Typography>
                              <Chip
                                label={`${player.matchWins}W / ${player.matchLosses}L`}
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
                        Top Players by ADR
                      </Typography>
                      {topPerformers.byAdr.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          ADR data will appear once matches report stats.
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
                                {index + 1}. {player.name}
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
                      Round {roundStatus.roundNumber} - {roundStatus.map}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {roundStatus.completedMatches} / {roundStatus.totalMatches} matches completed
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
                  Tournament completed! Check the leaderboard below for final rankings.
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Leaderboard */}
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
                    Leaderboard
                  </Typography>
                  <Chip
                    label={`${filteredLeaderboard.length} / ${leaderboard.length} players`}
                    size="small"
                    variant="outlined"
                  />
                </Box>
                <Box display="flex" gap={1} flexWrap="wrap">
                  <TextField
                    size="small"
                    placeholder="Search players..."
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
                    Export
                  </Button>
                  <Menu
                    anchorEl={exportMenuAnchor}
                    open={Boolean(exportMenuAnchor)}
                    onClose={handleExportClose}
                  >
                    <MenuItem onClick={exportToCSV}>Export as CSV</MenuItem>
                    <MenuItem onClick={exportToJSON}>Export as JSON</MenuItem>
                  </Menu>
                </Box>
              </Box>

              {leaderboard.length === 0 ? (
                <Box textAlign="center" py={4}>
                  <PersonIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="body1" color="text.secondary">
                    No players registered yet
                  </Typography>
                </Box>
              ) : filteredLeaderboard.length === 0 ? (
                <Box textAlign="center" py={4}>
                  <SearchIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="body1" color="text.secondary">
                    No players found matching &quot;{searchQuery}&quot;
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600, width: 60 }}>#</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Player</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          Wins
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          Losses
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          Win Rate
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          ELO
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          ELO Change
                        </TableCell>
                        {leaderboard.some((p) => p.averageAdr) && (
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            Avg ADR
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
                                <Avatar
                                  src={player.avatar}
                                  alt={player.name}
                                  sx={{ width: 40, height: 40 }}
                                >
                                  {player.name.charAt(0).toUpperCase()}
                                </Avatar>
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
                About Shuffle Tournaments
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                In shuffle tournaments, players compete individually. Teams are automatically
                balanced based on ELO ratings for each match. The player with the most match wins
                wins the tournament.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Click on any player&apos;s name or the &quot;View&quot; link to see their detailed
                profile, match history, and ELO progression.
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
}
