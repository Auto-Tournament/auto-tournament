import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import { BarChart } from '@mui/x-charts/BarChart';
import { useTheme } from '@mui/material/styles';

interface ServerActivityChartProps {
  totalServers: number;
  activeServers: number;
  serverData: Array<{ name: string; active: number; idle: number }>;
}

export default function ServerActivityChart({
  totalServers,
  activeServers,
  serverData,
}: ServerActivityChartProps) {
  const theme = useTheme();
  const colorPalette = [
    (theme.vars || theme).palette.primary.dark,
    (theme.vars || theme).palette.primary.main,
    (theme.vars || theme).palette.primary.light,
  ];

  const activePercentage = totalServers > 0 ? (activeServers / totalServers) * 100 : 0;
  const trend = activePercentage > 50 ? 'up' : activePercentage > 25 ? 'neutral' : 'down';
  const trendValue = activePercentage > 50 ? `+${Math.round(activePercentage)}%` : `${Math.round(activePercentage)}%`;

  const serverNames = serverData.map((d) => d.name);
  const activeData = serverData.map((d) => d.active);
  const idleData = serverData.map((d) => d.idle);

  return (
    <Card variant="outlined" sx={{ width: '100%' }}>
      <CardContent>
        <Typography component="h2" variant="subtitle2" gutterBottom>
          Server activity
        </Typography>
        <Stack sx={{ justifyContent: 'space-between' }}>
          <Stack
            direction="row"
            sx={{
              alignContent: { xs: 'center', sm: 'flex-start' },
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Typography variant="h4" component="p">
              {totalServers}
            </Typography>
            <Chip size="small" color={trend === 'up' ? 'success' : trend === 'down' ? 'error' : 'default'} label={trendValue} />
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Server utilization across tournament
          </Typography>
        </Stack>
        <BarChart
          borderRadius={8}
          colors={colorPalette}
          xAxis={[
            {
              scaleType: 'band',
              categoryGapRatio: 0.5,
              data: serverNames,
              height: 24,
            },
          ]}
          yAxis={[{ width: 50 }]}
          series={[
            {
              id: 'active',
              label: 'Active',
              data: activeData,
              stack: 'A',
            },
            {
              id: 'idle',
              label: 'Idle',
              data: idleData,
              stack: 'A',
            },
          ]}
          height={250}
          margin={{ left: 0, right: 0, top: 20, bottom: 0 }}
          grid={{ horizontal: true }}
          hideLegend
        />
      </CardContent>
    </Card>
  );
}

