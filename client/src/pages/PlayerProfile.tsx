import React, { useState, useEffect } from 'react';
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
  Button,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { api } from '../utils/api';
import { ELOProgressionChart } from '../components/player/ELOProgressionChart';
import { PerformanceMetricsChart } from '../components/player/PerformanceMetricsChart';
import { MatchInfoCard } from '../components/team/MatchInfoCard';
import type { PlayerDetail } from '../types/api.types';
import type { Team, TeamMatchInfo } from '../types';

interface RatingHistoryEntry {
  id: number;
  matchSlug: string;
  eloBefore: number;
  eloAfter: number;
  eloChange: number;
  baseEloAfter?: number | null;
  statAdjustment?: number | null;
  templateId?: string | null;
  matchResult: 'win' | 'loss';
  createdAt: number;
}

interface MatchHistoryEntry {
  slug: string;
  round: number;
  matchNumber: number;
  status: string;
  completedAt: number;
  tournamentId?: number;
  team: 'team1' | 'team2';
  wonMatch: boolean;
  adr?: number;
  totalDamage?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
}

export default function PlayerProfile() {
  const { steamId } = useParams<{ steamId: string }>();
  const [player, setPlayer] = useState<PlayerDetail | null>(null);
  const [ratingHistory, setRatingHistory] = useState<RatingHistoryEntry[]>([]);
  const [matchHistory, setMatchHistory] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentMatch, setCurrentMatch] = useState<TeamMatchInfo | null>(null);
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [currentTournamentStatus, setCurrentTournamentStatus] = useState<string>('setup');

  const loadPlayerData = async () => {
    if (!steamId) return;

    setLoading(true);
    setError('');

    try {
      // Load player details
      const playerResponse = await api.get<{ success: boolean; player: PlayerDetail }>(
        `/api/players/${steamId}`
      );
      if (playerResponse.success && playerResponse.player) {
        setPlayer(playerResponse.player);
        document.title = `${playerResponse.player.name} - Player Profile`;
      } else {
        setError('Player not found');
      }

      // Load rating history
      try {
        const historyResponse = await api.get<{
          success: boolean;
          history: Array<{
            match_slug: string;
            elo_before: number;
            elo_after: number;
            elo_change: number;
            base_elo_after?: number | null;
            stat_adjustment?: number | null;
            template_id?: string | null;
            match_result: 'win' | 'loss';
            created_at: number;
          }>;
        }>(
          `/api/players/${steamId}/rating-history`
        );
        if (historyResponse.success && historyResponse.history) {
          setRatingHistory(
            historyResponse.history.map((entry, index) => ({
              id: index,
              matchSlug: entry.match_slug,
              eloBefore: entry.elo_before,
              eloAfter: entry.elo_after,
              eloChange: entry.elo_change,
              baseEloAfter: entry.base_elo_after ?? null,
              statAdjustment: entry.stat_adjustment ?? null,
              templateId: entry.template_id ?? null,
              matchResult: entry.match_result,
              createdAt: entry.created_at,
            }))
          );
        }
      } catch {
        // Rating history is optional
      }

      // Load match history
      try {
        const matchesResponse = await api.get<{ success: boolean; matches: MatchHistoryEntry[] }>(
          `/api/players/${steamId}/matches`
        );
        if (matchesResponse.success && matchesResponse.matches) {
          setMatchHistory(matchesResponse.matches);
        }
      } catch {
        // Match history is optional
      }

      // Load current or upcoming match (for connect info)
      try {
        const currentMatchResponse = await api.get<{
          success: boolean;
          player: { id: string; name: string; avatar?: string };
          hasMatch: boolean;
          tournamentStatus?: string;
          match?: TeamMatchInfo;
        }>(`/api/players/${steamId}/current-match`);

        if (currentMatchResponse.success && currentMatchResponse.hasMatch && currentMatchResponse.match) {
          const match = currentMatchResponse.match;
          setCurrentMatch(match);
          setCurrentTournamentStatus(currentMatchResponse.tournamentStatus || 'setup');

          const yourTeam = match.isTeam1 ? match.team1 || null : match.team2 || null;
          const configPlayers =
            match.config &&
            (match.isTeam1 ? match.config.team1?.players || [] : match.config.team2?.players || []);

          setCurrentTeam(
            yourTeam
              ? {
                  id: yourTeam.id,
                  name: yourTeam.name,
                  tag: yourTeam.tag,
                  players: configPlayers,
                }
              : null
          );
        } else {
          setCurrentMatch(null);
          setCurrentTeam(null);
        }
      } catch {
        // Current match info is optional
        setCurrentMatch(null);
        setCurrentTeam(null);
      }
    } catch (err) {
      setError('Failed to load player data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (steamId) {
      loadPlayerData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steamId]);

  const getRoundLabel = (round: number) => {
    if (round === 1) return 'Round 1';
    if (round === 2) return 'Round 2';
    if (round === 3) return 'Quarterfinals';
    if (round === 4) return 'Semifinals';
    if (round === 5) return 'Finals';
    return `Round ${round}`;
  };

  if (loading) {
    return (
      <Box minHeight="100vh" bgcolor="background.default" py={6}>
        <Container maxWidth="md">
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
            <CircularProgress />
          </Box>
        </Container>
      </Box>
    );
  }

  if (error || !player) {
    return (
      <Box minHeight="100vh" bgcolor="background.default" py={6}>
        <Container maxWidth="md">
          <Alert severity="error" data-testid="player-not-found-error">{error || 'Player not found'}</Alert>
          <Box mt={2}>
            <Typography variant="body2" color="text.secondary">
              <a href="/player" style={{ color: 'inherit' }}>
                Search for a player
              </a>
            </Typography>
          </Box>
        </Container>
      </Box>
    );
  }

  const eloChange = player.currentElo - player.startingElo;
  const winRate =
    matchHistory.length > 0
      ? (matchHistory.filter((m) => m.wonMatch).length / matchHistory.length) * 100
      : 0;
  const wins = matchHistory.filter((m) => m.wonMatch).length;
  const losses = matchHistory.length - wins;
  const averageAdr =
    matchHistory.length > 0
      ? matchHistory.reduce((sum, m) => sum + (m.adr || 0), 0) / matchHistory.length
      : 0;

  // Use the most recent match's tournament for leaderboard link (if available)
  const latestTournamentId = matchHistory.find((m) => m.tournamentId)?.tournamentId;

  return (
    <Box minHeight="100vh" bgcolor="background.default" py={6} data-testid="public-player-page">
      <Container maxWidth="md">
        <Stack spacing={3}>
          {/* Player Header */}
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={3}>
                <Avatar src={player.avatar} alt={player.name} sx={{ width: 80, height: 80 }}>
                  {player.name.charAt(0).toUpperCase()}
                </Avatar>
                <Box flex={1}>
                  <Typography variant="h4" fontWeight={700} gutterBottom data-testid="public-player-name">
                    {player.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Steam ID: {player.id}
                  </Typography>
                  <Box display="flex" gap={2} mt={2} flexWrap="wrap" alignItems="center">
                    <Chip
                      data-testid="public-player-elo"
                      label={`ELO: ${player.currentElo}`}
                      color="primary"
                      sx={{ fontWeight: 600, fontSize: '1rem' }}
                    />
                    {eloChange !== 0 && (
                      <Chip
                        icon={eloChange > 0 ? <TrendingUpIcon /> : <TrendingDownIcon />}
                        label={`${eloChange > 0 ? '+' : ''}${eloChange}`}
                        color={eloChange > 0 ? 'success' : 'error'}
                        sx={{ fontWeight: 600 }}
                      />
                    )}
                    {latestTournamentId && (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<EmojiEventsIcon />}
                        onClick={() =>
                          window.open(`/tournament/${latestTournamentId}/leaderboard`, '_blank')
                        }
                      >
                        View Tournament Leaderboard
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            </CardContent>
          </Card>

          {/* Current / Upcoming Match (connect info) */}
          {currentMatch ? (
            <MatchInfoCard
              match={currentMatch}
              team={currentTeam}
              tournamentStatus={currentTournamentStatus}
              vetoCompleted={currentMatch.veto?.status === 'completed'}
              matchFormat={(currentMatch.matchFormat as 'bo1' | 'bo3' | 'bo5') || 'bo1'}
              onVetoComplete={async () => {
                setTimeout(() => {
                  void loadPlayerData();
                }, 1000);
              }}
              getRoundLabel={getRoundLabel}
            />
          ) : (
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <SportsEsportsIcon sx={{ fontSize: 56, color: 'text.secondary', mb: 2 }} />
                <Typography variant="body1" color="text.secondary">
                  No active match right now
                </Typography>
                <Typography variant="body2" color="text.secondary" mt={1}>
                  Once the next round is generated and your match is ready, it will appear here with
                  server connect info.
                </Typography>
              </CardContent>
            </Card>
          )}

          {/* Stats Overview */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Matches Played
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {player.matchCount}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Win Rate
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {winRate.toFixed(1)}%
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Wins / Losses
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {wins} / {losses}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Average ADR
                  </Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {averageAdr > 0 ? averageAdr.toFixed(1) : 'N/A'}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* ELO Progression Chart */}
          {ratingHistory.length > 0 && player && (
            <ELOProgressionChart
              history={ratingHistory.map((entry) => ({
                eloBefore: entry.eloBefore,
                eloAfter: entry.eloAfter,
                eloChange: entry.eloChange,
                matchResult: entry.matchResult,
                createdAt: entry.createdAt,
              }))}
              currentElo={player.currentElo}
              startingElo={player.startingElo}
            />
          )}

          {/* Performance Metrics Chart */}
          {matchHistory.length > 0 && (
            <PerformanceMetricsChart
              matchHistory={matchHistory.map((match) => ({
                adr: match.adr,
                kills: match.kills,
                deaths: match.deaths,
                assists: match.assists,
                createdAt: match.completedAt || 0,
              }))}
            />
          )}

          {/* Rating History */}
          {ratingHistory.length > 0 && (
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  ELO History
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Match</TableCell>
                        <TableCell align="right">ELO Before</TableCell>
                        <TableCell align="right">Base ELO After</TableCell>
                        <TableCell align="right">Stat Adj.</TableCell>
                        <TableCell align="right">Final ELO</TableCell>
                        <TableCell align="right">Total Change</TableCell>
                        <TableCell>Template</TableCell>
                        <TableCell>Result</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {ratingHistory.slice(0, 10).map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                              {entry.matchSlug}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            {entry.eloBefore}
                          </TableCell>
                          <TableCell align="right">
                            {entry.baseEloAfter ?? '—'}
                          </TableCell>
                          <TableCell align="right">
                            {entry.statAdjustment !== undefined && entry.statAdjustment !== null ? (
                              <Chip
                                label={`${
                                  entry.statAdjustment > 0 ? '+' : ''
                                }${entry.statAdjustment}`}
                                size="small"
                                color={
                                  entry.statAdjustment > 0
                                    ? 'success'
                                    : entry.statAdjustment < 0
                                    ? 'error'
                                    : 'default'
                                }
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <strong>{entry.eloAfter}</strong>
                          </TableCell>
                          <TableCell align="right">
                            <Chip
                              label={`${entry.eloChange > 0 ? '+' : ''}${entry.eloChange}`}
                              size="small"
                              color={entry.eloChange > 0 ? 'success' : 'error'}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary" noWrap>
                              {entry.templateId || 'Pure Win/Loss'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={entry.matchResult === 'win' ? 'Win' : 'Loss'}
                              size="small"
                              color={entry.matchResult === 'win' ? 'success' : 'error'}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {ratingHistory.length > 10 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 1, display: 'block' }}
                  >
                    Showing last 10 matches. Total: {ratingHistory.length}
                  </Typography>
                )}
              </CardContent>
            </Card>
          )}

          {/* Match History */}
          {matchHistory.length > 0 && (
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  Match History
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Match</TableCell>
                        <TableCell align="right">Round</TableCell>
                        <TableCell align="right">K/D</TableCell>
                        <TableCell align="right">ADR</TableCell>
                        <TableCell align="right">Damage</TableCell>
                        <TableCell>Result</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {matchHistory.slice(0, 10).map((match) => (
                        <TableRow key={match.slug}>
                          <TableCell>
                            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                              {match.slug}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">R{match.round}</TableCell>
                          <TableCell align="right">
                            {match.kills !== undefined && match.deaths !== undefined
                              ? `${match.kills}/${match.deaths}`
                              : 'N/A'}
                          </TableCell>
                          <TableCell align="right">
                            {match.adr ? match.adr.toFixed(1) : 'N/A'}
                          </TableCell>
                          <TableCell align="right">
                            {match.totalDamage ? match.totalDamage.toLocaleString() : 'N/A'}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={match.wonMatch ? 'Win' : 'Loss'}
                              size="small"
                              color={match.wonMatch ? 'success' : 'error'}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {matchHistory.length > 10 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 1, display: 'block' }}
                  >
                    Showing last 10 matches. Total: {matchHistory.length}
                  </Typography>
                )}
              </CardContent>
            </Card>
          )}

          {matchHistory.length === 0 && ratingHistory.length === 0 && (
            <Card>
              <CardContent>
                <Box textAlign="center" py={4}>
                  <SportsEsportsIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="body1" color="text.secondary">
                    No match history yet
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Container>
    </Box>
  );
}
