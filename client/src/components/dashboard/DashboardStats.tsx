import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Grid,
} from '@mui/material';
import {
  EmojiEvents as TournamentIcon,
  SportsEsports as MatchIcon,
  Storage as ServerIcon,
  People as PeopleIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { LineChart, PieChart } from '@mui/x-charts';
import { api } from '../../utils/api';
import type { Tournament, MatchListItem, Server, Player } from '../../types';

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

interface PlayerStats {
  total: number;
  inMatches: number;
  waiting: number;
}

export function DashboardStats({ showOnboarding }: DashboardStatsProps) {
  const [loading, setLoading] = useState(true);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
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
          const matchesRes = await api.get<{ success: boolean; matches: MatchListItem[] }>(
            '/api/matches'
          );
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

        // Load players
        try {
          const playersRes = await api.get<{ success: boolean; players: Player[] }>('/api/players');
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
  const playerStats: PlayerStats = {
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
        {/* Tournament Status Card - Large */}
        <Grid item xs={12} md={8} lg={6}>
          <Card
            sx={{
              height: '100%',
              background:
                'linear-gradient(135deg, rgba(103, 80, 164, 0.1) 0%, rgba(103, 80, 164, 0.05) 100%)',
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
        <Grid item xs={12} md={4} lg={3}>
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
        <Grid item xs={12} md={4} lg={3}>
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
        <Grid item xs={12} md={4} lg={3}>
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

        {/* Match Status Pie Chart */}
        {matchStatusData.length > 0 && (
          <Grid item xs={12} md={6} lg={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" fontWeight={600} mb={2}>
                  Match Status Distribution
                </Typography>
                <Box sx={{ width: '100%', height: 300, display: 'flex', justifyContent: 'center' }}>
                  <PieChart
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
          <Grid item xs={12} md={6} lg={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" fontWeight={600} mb={2}>
                  Server Status
                </Typography>
                <Box sx={{ width: '100%', height: 300, display: 'flex', justifyContent: 'center' }}>
                  <PieChart
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

        {/* Player Distribution Chart */}
        {playerDistributionData.length > 0 && (
          <Grid item xs={12} md={6} lg={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" fontWeight={600} mb={2}>
                  Player Distribution
                </Typography>
                <Box sx={{ width: '100%', height: 300, display: 'flex', justifyContent: 'center' }}>
                  <PieChart
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

        {/* Match Status Over Time */}
        {recentMatches.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <TrendingUpIcon color="primary" />
                  <Typography variant="h6" fontWeight={600}>
                    Recent Match Status
                  </Typography>
                </Box>
                <Box sx={{ width: '100%', height: 300, overflow: 'auto' }}>
                  <LineChart
                    xAxis={[
                      {
                        data: recentMatches.map((_, i) => i),
                        label: 'Match',
                      },
                    ]}
                    yAxis={[
                      {
                        label: 'Status',
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
                    height={300}
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
