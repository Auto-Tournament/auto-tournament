import React, { useEffect, useState } from 'react';
import Grid from '@mui/material/Grid';
import {
  Card,
  CardContent,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Box,
  Stack,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  EmojiEvents as TournamentIcon,
  SportsEsports as MatchIcon,
  Storage as ServerIcon,
  People as PeopleIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { LineChart, PieChart } from '@mui/x-charts';
import { api } from '../../utils/api';
import { getPlayerPageUrl } from '../../utils/playerLinks';
import type {
  Tournament,
  Server,
  MatchesResponse,
  PlayersResponse,
  PlayerDetail,
} from '../../types';

interface DashboardStatsProps {
  showOnboarding: boolean;
}

interface MatchStatusCount {
  pending: number;
  ready: number;
  loaded: number;
  live: number;
  completed: number;
}

interface ServerStatusCount {
  online: number;
  offline: number;
  total: number;
}

interface PlayerCounts {
  total: number;
  inMatches: number;
  waiting: number;
}

export function DashboardStats({ showOnboarding }: DashboardStatsProps) {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<MatchesResponse['matches']>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [players, setPlayers] = useState<PlayerDetail[]>([]);
  const [serverStatuses, setServerStatuses] = useState<Record<string, 'online' | 'offline'>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load tournament
        try {
          const tournamentRes = await api.get<{ success: boolean; tournament: Tournament }>(
            '/api/tournament'
          );
          if (tournamentRes.success && tournamentRes.tournament) {
            setTournament(tournamentRes.tournament);
          }
        } catch {
          // Tournament might not exist, that's OK
        }

        // Load matches
        try {
          const matchesRes = await api.get<MatchesResponse>('/api/matches');
          if (matchesRes.success && matchesRes.matches) {
            setMatches(matchesRes.matches);
          }
        } catch (e) {
          console.error('Failed to load matches:', e);
        }

        // Load servers
        try {
          const serversRes = await api.get<{ success: boolean; servers: Server[] }>('/api/servers');
          if (serversRes.success && serversRes.servers) {
            setServers(serversRes.servers);
            // Check server statuses
            const statusPromises = serversRes.servers.map(async (server) => {
              try {
                const statusRes = await api.get<{ success: boolean; status: string }>(
                  `/api/servers/${server.id}/status`
                );
                return { id: server.id, status: statusRes.status as 'online' | 'offline' };
              } catch {
                return { id: server.id, status: 'offline' as const };
              }
            });
            const statuses = await Promise.all(statusPromises);
            const statusMap: Record<string, 'online' | 'offline'> = {};
            statuses.forEach((s) => {
              statusMap[s.id] = s.status;
            });
            setServerStatuses(statusMap);
          }
        } catch (e) {
          console.error('Failed to load servers:', e);
        }

        // Load players (for counts + top players by ELO)
        try {
          const playersRes = await api.get<PlayersResponse>('/api/players');
          if (playersRes.success && playersRes.players) {
            setPlayers(playersRes.players);
          }
        } catch (e) {
          console.error('Failed to load players:', e);
        }
      } catch (e) {
        setError('Failed to load dashboard data');
        console.error('Error loading dashboard:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 3 }}>
        {error}
      </Alert>
    );
  }

  // Calculate match status counts
  const matchStatusCount: MatchStatusCount = {
    pending: 0,
    ready: 0,
    loaded: 0,
    live: 0,
    completed: 0,
  };

  matches.forEach((match) => {
    if (match.status === 'pending') matchStatusCount.pending++;
    else if (match.status === 'ready') matchStatusCount.ready++;
    else if (match.status === 'loaded') matchStatusCount.loaded++;
    else if (match.status === 'live') matchStatusCount.live++;
    else if (match.status === 'completed') matchStatusCount.completed++;
  });

  // Calculate server status counts
  const serverStatusCount: ServerStatusCount = {
    online: 0,
    offline: 0,
    total: servers.length,
  };

  servers.forEach((server) => {
    const status = serverStatuses[server.id] || 'offline';
    if (status === 'online') serverStatusCount.online++;
    else serverStatusCount.offline++;
  });

  // Calculate player stats
  const playerStats: PlayerCounts = {
    total: players.length,
    inMatches: 0,
    waiting: players.length,
  };

  // Count players currently in matches
  matches.forEach((match) => {
    if (match.status === 'live' || match.status === 'loaded') {
      const team1Players = match.config?.team1?.players?.length || 0;
      const team2Players = match.config?.team2?.players?.length || 0;
      playerStats.inMatches += team1Players + team2Players;
    }
  });

  playerStats.waiting = Math.max(0, playerStats.total - playerStats.inMatches);

  // Top players by ELO (limit 5)
  const topPlayers = [...players]
    .filter((p) => typeof p.currentElo === 'number')
    .sort((a, b) => b.currentElo - a.currentElo)
    .slice(0, 5);

  // Prepare chart data
  const matchStatusData = [
    { id: 0, value: matchStatusCount.pending, label: 'Pending' },
    { id: 1, value: matchStatusCount.ready, label: 'Ready' },
    { id: 2, value: matchStatusCount.loaded, label: 'Loaded' },
    { id: 3, value: matchStatusCount.live, label: 'Live' },
    { id: 4, value: matchStatusCount.completed, label: 'Completed' },
  ].filter((item) => item.value > 0);

  const serverStatusData = [
    { id: 0, value: serverStatusCount.online, label: 'Online' },
    { id: 1, value: serverStatusCount.offline, label: 'Offline' },
  ].filter((item) => item.value > 0);

  const playerDistributionData = [
    { id: 0, value: playerStats.inMatches, label: 'In Matches' },
    { id: 1, value: playerStats.waiting, label: 'Waiting' },
  ].filter((item) => item.value > 0);

  // Match status over time (last 7 matches)
  const recentMatches = matches.slice(0, 7).reverse();

  const matchStatusPieColors = [
    theme.palette.info.main,
    theme.palette.primary.main,
    theme.palette.warning.main,
    theme.palette.success.main,
    theme.palette.secondary.main,
  ];

  const serverStatusPieColors = [theme.palette.success.main, theme.palette.error.main];

  const playerDistributionPieColors = [theme.palette.success.main, theme.palette.secondary.main];

  const recentMatchLineColors = [theme.palette.primary.main];

  const hasData = tournament || matches.length > 0 || servers.length > 0 || players.length > 0;

  if (!hasData && !showOnboarding) {
    return (
      <Alert severity="info" sx={{ mb: 3 }}>
        No data available. Create a tournament to see statistics.
      </Alert>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="h4" fontWeight={700} mb={3}>
        Tournament Statistics
      </Typography>
      <Grid container spacing={3}>
        {/* Row 1: Tournament + Summary stats */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card
            sx={{
              height: '100%',
            }}
          >
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <TournamentIcon color="primary" sx={{ fontSize: 32 }} />
                <Typography variant="h6" fontWeight={600}>
                  Tournament Status
                </Typography>
              </Box>
              {tournament ? (
                <>
                  <Typography variant="h4" fontWeight={700} mb={1}>
                    {tournament.name}
                  </Typography>
                  <Chip
                    label={tournament.status.replace('_', ' ').toUpperCase()}
                    color={
                      tournament.status === 'in_progress'
                        ? 'success'
                        : tournament.status === 'completed'
                        ? 'default'
                        : 'warning'
                    }
                    sx={{ mb: 2, fontSize: '0.875rem', fontWeight: 600 }}
                  />
                  <Box display="flex" gap={2} flexWrap="wrap" mt={2}>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Type
                      </Typography>
                      <Typography variant="body1" fontWeight={600}>
                        {tournament.type?.replace('_', ' ').toUpperCase()}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Format
                      </Typography>
                      <Typography variant="body1" fontWeight={600}>
                        {tournament.format?.toUpperCase()}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Matches
                      </Typography>
                      <Typography variant="body1" fontWeight={600}>
                        {matches.length}
                      </Typography>
                    </Box>
                  </Box>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No tournament active
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Match Status Card */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <MatchIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Match Status
                </Typography>
              </Box>
              <Typography variant="h3" fontWeight={700} mb={2}>
                {matches.length}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Total Matches
              </Typography>
              <Box display="flex" flexDirection="column" gap={1.5}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">Pending:</Typography>
                  <Chip label={matchStatusCount.pending} size="small" color="default" />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">Ready:</Typography>
                  <Chip label={matchStatusCount.ready} size="small" color="info" />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">Loaded:</Typography>
                  <Chip label={matchStatusCount.loaded} size="small" color="warning" />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">Live:</Typography>
                  <Chip label={matchStatusCount.live} size="small" color="success" />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">Completed:</Typography>
                  <Chip label={matchStatusCount.completed} size="small" />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Server Status Card */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <ServerIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Server Status
                </Typography>
              </Box>
              <Typography variant="h3" fontWeight={700} mb={1}>
                {serverStatusCount.online}/{serverStatusCount.total}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Servers Online
              </Typography>
              <Box display="flex" flexDirection="column" gap={1}>
                <Chip
                  label={`${serverStatusCount.online} Online`}
                  color="success"
                  size="medium"
                  sx={{ fontWeight: 600 }}
                />
                <Chip
                  label={`${serverStatusCount.offline} Offline`}
                  color="error"
                  size="medium"
                  sx={{ fontWeight: 600 }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Player Statistics Card */}
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <PeopleIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Players
                </Typography>
              </Box>
              <Typography variant="h3" fontWeight={700} mb={1}>
                {playerStats.total}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Total Players
              </Typography>
              <Box display="flex" flexDirection="column" gap={1.5}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">In Matches:</Typography>
                  <Chip
                    label={playerStats.inMatches}
                    color="success"
                    size="small"
                    sx={{ fontWeight: 600 }}
                  />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">Waiting:</Typography>
                  <Chip label={playerStats.waiting} size="small" sx={{ fontWeight: 600 }} />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Row 2: Distribution pie charts */}
        {matchStatusData.length > 0 && (
          <Grid size={{ xs: 12, md: 6, lg: 6 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" fontWeight={600} mb={2}>
                  Match Status Distribution
                </Typography>
                <Box sx={{ width: '100%', height: 300, display: 'flex', justifyContent: 'center' }}>
                  <PieChart
                    colors={matchStatusPieColors}
                    margin={{ top: 10, right: 80, bottom: 10, left: 10 }}
                    series={[
                      {
                        data: matchStatusData,
                        innerRadius: 30,
                        outerRadius: 100,
                        paddingAngle: 2,
                        cornerRadius: 5,
                      },
                    ]}
                    width={350}
                    height={300}
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Server Status Pie Chart */}
        {serverStatusData.length > 0 && (
          <Grid size={{ xs: 12, md: 6, lg: 6 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" fontWeight={600} mb={2}>
                  Server Status
                </Typography>
                <Box sx={{ width: '100%', height: 300, display: 'flex', justifyContent: 'center' }}>
                  <PieChart
                    colors={serverStatusPieColors}
                    margin={{ top: 10, right: 80, bottom: 10, left: 10 }}
                    series={[
                      {
                        data: serverStatusData,
                        innerRadius: 30,
                        outerRadius: 100,
                        paddingAngle: 2,
                        cornerRadius: 5,
                      },
                    ]}
                    width={350}
                    height={300}
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Row 3: Player Distribution + Top Players (two cards, 50% width each) */}
        {playerDistributionData.length > 0 && (
          <Grid size={{ xs: 12, md: 6, lg: 6 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" fontWeight={600} mb={2}>
                  Player Distribution
                </Typography>
                <Box
                  sx={{ width: '100%', height: 300, display: 'flex', justifyContent: 'center' }}
                >
                  <PieChart
                    colors={playerDistributionPieColors}
                    margin={{ top: 10, right: 80, bottom: 10, left: 10 }}
                    series={[
                      {
                        data: playerDistributionData,
                        innerRadius: 30,
                        outerRadius: 100,
                        paddingAngle: 2,
                        cornerRadius: 5,
                      },
                    ]}
                    width={350}
                    height={300}
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        {topPlayers.length > 0 && (
          <Grid size={{ xs: 12, md: 6, lg: 6 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" fontWeight={600} mb={1}>
                  Top Players by ELO
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  Global rating across all tournament types
                </Typography>
                <Stack spacing={0.75}>
                  {topPlayers.map((p, index) => (
                    <Box
                      key={p.id}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <Typography
                        variant="body2"
                        component="a"
                        href={getPlayerPageUrl(p.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{
                          textDecoration: 'none',
                          cursor: 'pointer',
                          color: 'text.primary',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {index + 1}. {p.name}
                      </Typography>
                      <Chip
                        label={`ELO ${p.currentElo}`}
                        size="small"
                        color={index === 0 ? 'primary' : 'default'}
                        sx={{ fontWeight: 600 }}
                      />
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Row 3: Match Status Over Time + Recent Completed Matches */}
        {recentMatches.length > 0 && (
          <>
            <Grid size={{ xs: 12, md: 8 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <TrendingUpIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>
                      Recent Match Status
                    </Typography>
                  </Box>
                  <Box sx={{ width: '100%', height: 280, overflow: 'auto' }}>
                    <LineChart
                    colors={recentMatchLineColors}
                      xAxis={[
                        {
                          data: recentMatches.map((_, i) => i),
                          label: 'Match',
                        },
                      ]}
                      yAxis={[
                        {
                          label: 'Status',
                          width: 90,
                          valueFormatter: (value) => {
                            if (value === 5) return 'Completed';
                            if (value === 4) return 'Live';
                            if (value === 3) return 'Loaded';
                            if (value === 2) return 'Ready';
                            return 'Pending';
                          },
                        },
                      ]}
                      series={[
                        {
                          data: recentMatches.map((match) => {
                            if (match.status === 'completed') return 5;
                            if (match.status === 'live') return 4;
                            if (match.status === 'loaded') return 3;
                            if (match.status === 'ready') return 2;
                            return 1;
                          }),
                          label: 'Status',
                          area: true,
                        },
                      ]}
                      width={Math.max(600, recentMatches.length * 80)}
                      height={280}
                      margin={{ top: 30, right: 30, bottom: 40, left: 90 }}
                    />
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={600} mb={1}>
                    Recent Completed Matches
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={1}>
                    Last {Math.min(5, recentMatches.length)} finished matches
                  </Typography>
                  <Stack spacing={0.75}>
                    {matches
                      .filter((m) => m.status === 'completed')
                      .slice(0, 5)
                      .map((m) => (
                        <Box
                          key={m.id}
                          display="flex"
                          justifyContent="space-between"
                          alignItems="center"
                        >
                          <Typography variant="body2">{m.slug || `Match #${m.id}`}</Typography>
                          <Chip label="Completed" size="small" color="success" />
                        </Box>
                      ))}
                    {matches.filter((m) => m.status === 'completed').length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        No completed matches yet.
                      </Typography>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </>
        )}
      </Grid>
    </Box>
  );
}
