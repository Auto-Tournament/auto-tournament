import React, { useEffect, useState } from 'react';
import Grid from '@mui/material/Grid';
import { Card, CardContent, Typography, Chip, CircularProgress, Alert, Box, Stack } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  EmojiEvents as TournamentIcon,
  SportsEsports as MatchIcon,
  Storage as ServerIcon,
  People as PeopleIcon,
} from '@mui/icons-material';
import { LineChart, PieChart } from '@mui/x-charts';
import { api } from '../../utils/api';
import { getPlayerPageUrl } from '../../utils/playerLinks';
import { useTranslation } from 'react-i18next';
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
  const [serverStatusLoading, setServerStatusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const loadServerStatuses = async (serverList: Server[]) => {
      if (!serverList.length) {
        setServerStatuses({});
        return;
      }

      setServerStatusLoading(true);
      try {
        const statusPromises = serverList.map(async (server) => {
          try {
            const statusRes = await api.get<{ success: boolean; status: string }>(
              `/api/servers/${server.id}/status?cached=true`
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
      } catch (e) {
        console.error('Failed to load server statuses for dashboard:', e);
      } finally {
        setServerStatusLoading(false);
      }
    };

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

        // Load servers (list only; statuses are loaded in the background)
        try {
          const serversRes = await api.get<{ success: boolean; servers: Server[] }>('/api/servers');
          if (serversRes.success && serversRes.servers) {
            setServers(serversRes.servers);
            void loadServerStatuses(serversRes.servers);
          } else {
            setServers([]);
            setServerStatuses({});
          }
        } catch (e) {
          console.error('Failed to load servers:', e);
          setServers([]);
          setServerStatuses({});
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
        setError(t('dashboard.stats.errors.load'));
        console.error('Error loading dashboard:', e);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
    const interval = setInterval(() => {
      void loadData();
    }, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [t]);

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

  // ELO distribution (histogram-style buckets, e.g. 0-200, 200-400, ...)
  const eloBucketSize = 200;
  const eloValues = players
    .map((p) => p.currentElo)
    .filter((elo) => typeof elo === 'number' && Number.isFinite(elo)) as number[];

  let eloBuckets:
    | {
        label: string;
        count: number;
      }[]
    | null = null;

  if (eloValues.length > 0) {
    let maxElo = Math.max(...eloValues);
    // Ensure at least one visible bucket even if all players are very low rated.
    if (maxElo < eloBucketSize) {
      maxElo = eloBucketSize;
    }
    const bucketCount = Math.floor(maxElo / eloBucketSize) + 1;
    const bucketCounts = new Array<number>(bucketCount).fill(0);

    eloValues.forEach((elo) => {
      const clamped = Math.max(0, elo);
      const index = Math.min(bucketCount - 1, Math.floor(clamped / eloBucketSize));
      bucketCounts[index] += 1;
    });

    eloBuckets = bucketCounts.map((count, index) => {
      const from = index * eloBucketSize;
      const to = from + eloBucketSize;
      return {
        label: `${from}-${to}`,
        count,
      };
    });
  }

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

  const hasData = tournament || matches.length > 0 || servers.length > 0 || players.length > 0;

  if (!hasData && !showOnboarding) {
    return (
      <Alert severity="info" sx={{ mb: 3 }}>
        {t('dashboard.stats.noData')}
      </Alert>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="h4" fontWeight={700} mb={3}>
        {t('dashboard.stats.heading')}
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
                  {t('dashboard.stats.tournamentStatus.title')}
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
                        {t('dashboard.stats.tournamentStatus.typeLabel')}
                      </Typography>
                      <Typography variant="body1" fontWeight={600}>
                        {tournament.type?.replace('_', ' ').toUpperCase()}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        {t('dashboard.stats.tournamentStatus.formatLabel')}
                      </Typography>
                      <Typography variant="body1" fontWeight={600}>
                        {tournament.format?.toUpperCase()}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        {t('dashboard.stats.tournamentStatus.matchesLabel')}
                      </Typography>
                      <Typography variant="body1" fontWeight={600}>
                        {matches.length}
                      </Typography>
                    </Box>
                  </Box>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('dashboard.stats.tournamentStatus.none')}
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
                  {t('dashboard.stats.matchStatus.title')}
                </Typography>
              </Box>
              <Typography variant="h3" fontWeight={700} mb={2}>
                {matches.length}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('dashboard.stats.matchStatus.total')}
              </Typography>
              <Box display="flex" flexDirection="column" gap={1.5}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">
                    {t('dashboard.stats.matchStatus.pending')}
                  </Typography>
                  <Chip label={matchStatusCount.pending} size="small" color="default" />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">
                    {t('dashboard.stats.matchStatus.ready')}
                  </Typography>
                  <Chip label={matchStatusCount.ready} size="small" color="info" />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">
                    {t('dashboard.stats.matchStatus.loaded')}
                  </Typography>
                  <Chip label={matchStatusCount.loaded} size="small" color="warning" />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">
                    {t('dashboard.stats.matchStatus.live')}
                  </Typography>
                  <Chip label={matchStatusCount.live} size="small" color="success" />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">
                    {t('dashboard.stats.matchStatus.completed')}
                  </Typography>
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
                  {t('dashboard.stats.serverStatus.title')}
                </Typography>
                {serverStatusLoading && (
                  <Box ml={1} display="inline-flex" alignItems="center">
                    <CircularProgress size={16} />
                  </Box>
                )}
              </Box>
              <Typography variant="h3" fontWeight={700} mb={1}>
                {serverStatusCount.online}/{serverStatusCount.total}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('dashboard.stats.serverStatus.onlineSummary')}
              </Typography>
              <Box display="flex" flexDirection="column" gap={1}>
                <Chip
                  label={t('dashboard.stats.serverStatus.online', {
                    count: serverStatusCount.online,
                  })}
                  color="success"
                  size="medium"
                  sx={{ fontWeight: 600 }}
                />
                <Chip
                  label={t('dashboard.stats.serverStatus.offline', {
                    count: serverStatusCount.offline,
                  })}
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
                  {t('dashboard.stats.players.title')}
                </Typography>
              </Box>
              <Typography variant="h3" fontWeight={700} mb={1}>
                {playerStats.total}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('dashboard.stats.players.total')}
              </Typography>
              <Box display="flex" flexDirection="column" gap={1.5}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">
                    {t('dashboard.stats.players.inMatches')}
                  </Typography>
                  <Chip
                    label={playerStats.inMatches}
                    color="success"
                    size="small"
                    sx={{ fontWeight: 600 }}
                  />
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">
                    {t('dashboard.stats.players.waiting')}
                  </Typography>
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
                  {t('dashboard.stats.serverStatus.distributionTitle')}
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
                  {t('dashboard.stats.playerDistribution.title')}
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
                  {t('dashboard.stats.topPlayers.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  {t('dashboard.stats.topPlayers.subtitle')}
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
                        label={t('dashboard.stats.topPlayers.chip', { value: p.currentElo })}
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

        {/* Row 4: ELO distribution, match status over time + recent matches */}
        {eloBuckets && eloBuckets.length > 0 && (
          <Grid size={{ xs: 12, md: 12 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                <Typography variant="h6" fontWeight={600} mb={1}>
                  {t('dashboard.stats.eloDistribution.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  {t('dashboard.stats.eloDistribution.subtitle', { bucket: eloBucketSize })}
                    </Typography>
                <Box sx={{ width: '100%', height: 280, overflowX: 'auto' }}>
                    <LineChart
                      xAxis={[
                        {
                        data: eloBuckets.map((_, index) => index),
                        valueFormatter: (value) =>
                          eloBuckets?.[Number(value)]?.label ?? String(value),
                        label: t('dashboard.stats.eloDistribution.xAxis'),
                        },
                      ]}
                      yAxis={[
                        {
                        label: t('dashboard.stats.eloDistribution.yAxis'),
                        width: 40,
                        },
                      ]}
                      series={[
                        {
                        id: 'players',
                        label: t('dashboard.stats.eloDistribution.seriesLabel'),
                        data: eloBuckets.map((b) => b.count),
                          area: true,
                        },
                      ]}
                    width={Math.max(600, eloBuckets.length * 80)}
                    height={260}
                    margin={{ top: 30, right: 20, bottom: 50, left: 50 }}
                    grid={{ horizontal: true }}
                    />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
        )}

        {/* Recent Completed Matches */}
        {recentMatches.length > 0 && (
          <>
            <Grid size={{ xs: 12, md: 6 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                <Typography variant="h6" fontWeight={600} mb={1}>
                  {t('dashboard.stats.recentMatches.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                    {t('dashboard.stats.recentMatches.subtitle', {
                      count: Math.min(5, recentMatches.length),
                    })}
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
                        {t('dashboard.stats.recentMatches.none')}
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
