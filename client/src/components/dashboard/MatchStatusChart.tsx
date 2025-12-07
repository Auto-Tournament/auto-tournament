import { useTheme } from '@mui/material/styles';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import { LineChart } from '@mui/x-charts/LineChart';

function AreaGradient({ color, id }: { color: string; id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="50%" y1="0%" x2="50%" y2="100%">
        <stop offset="0%" stopColor={color} stopOpacity={0.5} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

function getDaysInMonth(month: number, year: number) {
  const date = new Date(year, month, 0);
  const monthName = date.toLocaleDateString('en-US', {
    month: 'short',
  });
  const daysInMonth = date.getDate();
  const days = [];
  let i = 1;
  while (days.length < daysInMonth) {
    days.push(`${monthName} ${i}`);
    i += 1;
  }
  return days;
}

interface MatchStatusChartProps {
  totalMatches: number;
  completedMatches: number;
  liveMatches?: number;
  pendingMatches?: number;
  matchData: Array<{ date: string; completed: number; live: number; pending: number }>;
}

export default function MatchStatusChart({
  totalMatches,
  completedMatches,
  _liveMatches,
  _pendingMatches,
  matchData,
}: MatchStatusChartProps) {
  const theme = useTheme();
  const data = getDaysInMonth(4, 2024);

  const colorPalette = [
    theme.palette.primary.light,
    theme.palette.primary.main,
    theme.palette.primary.dark,
  ];

  // Calculate trend
  const completedPercentage = totalMatches > 0 ? (completedMatches / totalMatches) * 100 : 0;
  const trend = completedPercentage > 50 ? 'up' : completedPercentage > 25 ? 'neutral' : 'down';
  const trendValue = completedPercentage > 50 ? `+${Math.round(completedPercentage)}%` : `${Math.round(completedPercentage)}%`;

  // Prepare chart data
  const completedData = matchData.map((d) => d.completed);
  const liveData = matchData.map((d) => d.live);
  const pendingData = matchData.map((d) => d.pending);

  return (
    <Card variant="outlined" sx={{ width: '100%' }}>
      <CardContent>
        <Typography component="h2" variant="subtitle2" gutterBottom>
          Match progression
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
              {totalMatches}
            </Typography>
            <Chip size="small" color={trend === 'up' ? 'success' : trend === 'down' ? 'error' : 'default'} label={trendValue} />
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Match status over time
          </Typography>
        </Stack>
        <LineChart
          colors={colorPalette}
          xAxis={[
            {
              scaleType: 'point',
              data: data.slice(0, matchData.length),
              tickInterval: (index, i) => (i + 1) % 5 === 0,
              height: 24,
            },
          ]}
          yAxis={[{ width: 50 }]}
          series={[
            {
              id: 'pending',
              label: 'Pending',
              showMark: false,
              curve: 'linear',
              stack: 'total',
              area: true,
              stackOrder: 'ascending',
              data: pendingData,
            },
            {
              id: 'live',
              label: 'Live',
              showMark: false,
              curve: 'linear',
              stack: 'total',
              area: true,
              stackOrder: 'ascending',
              data: liveData,
            },
            {
              id: 'completed',
              label: 'Completed',
              showMark: false,
              curve: 'linear',
              stack: 'total',
              stackOrder: 'ascending',
              data: completedData,
              area: true,
            },
          ]}
          height={250}
          margin={{ left: 0, right: 20, top: 20, bottom: 0 }}
          grid={{ horizontal: true }}
          sx={{
            '& .MuiAreaElement-series-completed': {
              fill: "url('#completed')",
            },
            '& .MuiAreaElement-series-live': {
              fill: "url('#live')",
            },
            '& .MuiAreaElement-series-pending': {
              fill: "url('#pending')",
            },
          }}
          hideLegend
        >
          <AreaGradient color={theme.palette.primary.dark} id="completed" />
          <AreaGradient color={theme.palette.primary.main} id="live" />
          <AreaGradient color={theme.palette.primary.light} id="pending" />
        </LineChart>
      </CardContent>
    </Card>
  );
}

