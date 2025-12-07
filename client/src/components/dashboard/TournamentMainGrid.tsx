import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TournamentStatCard, { TournamentStatCardProps } from './TournamentStatCard';
import TournamentHighlightedCard from './TournamentHighlightedCard';
import MatchStatusChart from './MatchStatusChart';
import ServerActivityChart from './ServerActivityChart';
import RecentMatchesList from './RecentMatchesList';
import TournamentInfoCard from './TournamentInfoCard';
import { useMemo } from 'react';
import type { Tournament, MatchListItem, Server } from '../../types';

interface TournamentMainGridProps {
  tournament: Tournament | null;
  matches: MatchListItem[];
  servers: Server[];
  serverStatuses: Record<string, 'online' | 'offline'>;
}

export default function TournamentMainGrid({
  tournament,
  matches,
  servers,
  serverStatuses,
}: TournamentMainGridProps) {
  // Calculate match statistics
  const matchStats = useMemo(() => {
    const total = matches.length;
    const completed = matches.filter((m) => m.status === 'completed').length;
    const live = matches.filter((m) => m.status === 'live').length;
    const pending = matches.filter((m) => m.status === 'pending' || m.status === 'ready').length;
    const loaded = matches.filter((m) => m.status === 'loaded').length;

    return { total, completed, live, pending, loaded };
  }, [matches]);

  // Calculate server statistics
  const serverStats = useMemo(() => {
    const total = servers.length;
    const online = servers.filter((s) => serverStatuses[s.id] === 'online').length;
    const active = matches.filter((m) => m.status === 'live' || m.status === 'loaded').length;
    const idle = total - active;

    return { total, online, active, idle };
  }, [servers, serverStatuses, matches]);

  // Calculate player statistics
  const playerStats = useMemo(() => {
    let total = 0;
    let inMatches = 0;

    matches.forEach((match) => {
      if (match.status === 'live' || match.status === 'loaded') {
        const team1Players = match.config?.team1?.players?.length || 0;
        const team2Players = match.config?.team2?.players?.length || 0;
        inMatches += team1Players + team2Players;
      }
    });

    // Get total players from all teams
    matches.forEach((match) => {
      const team1Players = match.config?.team1?.players?.length || 0;
      const team2Players = match.config?.team2?.players?.length || 0;
      total += team1Players + team2Players;
    });

    return { total, inMatches, waiting: Math.max(0, total - inMatches) };
  }, [matches]);

  // Generate sparkline data (last 30 data points)
  // Use a deterministic approach based on current value to avoid Math.random() in render
  const generateSparklineData = (current: number, max: number): number[] => {
    const data: number[] = [];
    // Create a simple pattern based on current value for consistency
    const baseValue = current || 1;
    for (let i = 0; i < 30; i++) {
      // Use a sine wave pattern for variation (deterministic)
      const variation = Math.sin((i / 30) * Math.PI * 2) * 0.1; // -10% to +10%
      const value = Math.max(0, Math.min(max, baseValue * (1 + variation)));
      data.push(Math.round(value));
    }
    return data;
  };

  // Prepare stat cards data
  const statCards: TournamentStatCardProps[] = useMemo(() => {
    const completedTrend = matchStats.total > 0 && matchStats.completed / matchStats.total > 0.5 ? 'up' : 'neutral';
    const liveTrend = matchStats.live > 0 ? 'up' : 'neutral';
    const serverTrend = serverStats.total > 0 && serverStats.online / serverStats.total > 0.5 ? 'up' : 'neutral';
    const playerTrend = playerStats.total > 0 && playerStats.inMatches / playerStats.total > 0.3 ? 'up' : 'neutral';

    return [
      {
        title: 'Matches',
        value: matchStats.total.toString(),
        interval: 'Total matches',
        trend: completedTrend,
        data: generateSparklineData(matchStats.completed, matchStats.total),
      },
      {
        title: 'Live matches',
        value: matchStats.live.toString(),
        interval: 'Currently active',
        trend: liveTrend,
        data: generateSparklineData(matchStats.live, matchStats.total),
      },
      {
        title: 'Servers',
        value: `${serverStats.online}/${serverStats.total}`,
        interval: 'Online servers',
        trend: serverTrend,
        data: generateSparklineData(serverStats.online, serverStats.total),
      },
      {
        title: 'Players',
        value: playerStats.inMatches.toString(),
        interval: 'In matches',
        trend: playerTrend,
        data: generateSparklineData(playerStats.inMatches, playerStats.total),
      },
    ];
  }, [matchStats, serverStats, playerStats]);

  // Prepare match status chart data
  const matchChartData = useMemo(() => {
    // Generate data for the last 7 days or match count, whichever is smaller
    const dataPoints = Math.min(7, matches.length || 1);
    const data = [];
    
    for (let i = 0; i < dataPoints; i++) {
      // For simplicity, use current stats distributed
      data.push({
        date: `Day ${i + 1}`,
        completed: Math.round(matchStats.completed / dataPoints),
        live: Math.round(matchStats.live / dataPoints),
        pending: Math.round(matchStats.pending / dataPoints),
      });
    }
    
    return data;
  }, [matches, matchStats]);

  // Prepare server activity chart data
  const serverChartData = useMemo(() => {
    return servers.slice(0, 7).map((server) => {
      const isOnline = serverStatuses[server.id] === 'online';
      const hasMatch = matches.some((m) => m.serverId === server.id && (m.status === 'live' || m.status === 'loaded'));
      
      return {
        name: server.name.length > 10 ? server.name.substring(0, 10) + '...' : server.name,
        active: hasMatch ? 1 : 0,
        idle: isOnline && !hasMatch ? 1 : 0,
      };
    });
  }, [servers, serverStatuses, matches]);

  return (
    <Box sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}>
      {/* cards */}
      <Typography component="h2" variant="h6" sx={{ mb: 2 }}>
        Overview
      </Typography>
      <Grid
        container
        spacing={2}
        columns={12}
        sx={{ mb: (theme) => theme.spacing(2) }}
      >
        {statCards.map((card, index) => (
          <Grid key={index} item xs={12} sm={6} lg={3}>
            <TournamentStatCard {...card} />
          </Grid>
        ))}
        <Grid item xs={12} sm={6} lg={3}>
          <TournamentHighlightedCard />
        </Grid>
        <Grid item xs={12} md={6}>
          <MatchStatusChart
            totalMatches={matchStats.total}
            completedMatches={matchStats.completed}
            liveMatches={matchStats.live}
            pendingMatches={matchStats.pending}
            matchData={matchChartData}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <ServerActivityChart
            totalServers={serverStats.total}
            activeServers={serverStats.active}
            serverData={serverChartData}
          />
        </Grid>
      </Grid>
      <Typography component="h2" variant="h6" sx={{ mb: 2 }}>
        Details
      </Typography>
      <Grid container spacing={2} columns={12}>
        <Grid item xs={12} lg={9}>
          <RecentMatchesList matches={matches} maxItems={10} />
        </Grid>
        <Grid item xs={12} lg={3}>
          <Stack gap={2} direction={{ xs: 'column', sm: 'row', lg: 'column' }}>
            <TournamentInfoCard tournament={tournament} />
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}

