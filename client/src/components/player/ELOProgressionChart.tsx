import { useRef, useEffect, useState } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { buildEloProgression } from '../../utils/eloProgression';
import { tokens } from '../../theme/tokens';

interface ELOProgressionChartProps {
  history: Array<{
    eloBefore: number;
    baseEloAfter: number | null;
    createdAt: number;
  }>;
  currentElo: number;
  startingElo: number;
}

export function ELOProgressionChart({
  history,
  currentElo,
  startingElo,
}: ELOProgressionChartProps) {
  const { t } = useTranslation();
  // Chart dimensions - hooks must be called before any early returns
  const chartHeight = 200;
  const padding = 40;
  // Larger points for clearer visual emphasis (approx. 24px diameter)
  const pointRadius = 6;
  const [chartWidth, setChartWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setChartWidth(containerRef.current.offsetWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  if (history.length === 0) {
    return (
      <Box textAlign="center" py={4}>
        <Typography variant="body2" color="text.secondary">
          {t('playerPage.eloChart.noHistory')}
        </Typography>
      </Box>
    );
  }

  // Chronological points anchored on the stored starting rating (see utils/eloProgression).
  const { points: dataPoints, minElo, maxElo, totalChange } = buildEloProgression(
    history,
    currentElo,
    startingElo
  );
  const eloRange = maxElo - minElo || 1; // Avoid division by zero

  const availableWidth = chartWidth - padding * 2;

  // Calculate Y position (inverted because SVG Y increases downward)
  const getY = (elo: number) => {
    const normalized = (elo - minElo) / eloRange;
    return padding + (chartHeight - padding * 2) * (1 - normalized);
  };

  // Calculate X position
  const getX = (index: number, total: number) => {
    if (total === 1) return padding;
    return padding + (availableWidth * index) / (total - 1);
  };

  // Generate a straight line path connecting each data point (no curves).
  const linePath = dataPoints
    .map((point, index) => {
      const x = getX(index, dataPoints.length);
      const y = getY(point.elo);
      return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(' ');

  // Generate area path
  const areaPath = `${linePath} L ${padding + availableWidth} ${
    chartHeight + padding - padding
  } L ${padding} ${chartHeight + padding - padding} Z`;

  const displayStartingElo = startingElo;

  return (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.paper', borderRadius: `${tokens.radius.lg}px` }}>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {t('playerPage.eloChart.title')}
      </Typography>
      <Box
        ref={containerRef}
        sx={{
          position: 'relative',
          width: '100%',
          height: chartHeight + padding,
          mt: 2,
        }}
      >
        <svg width="100%" height={chartHeight + padding} style={{ overflow: 'visible' }}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const elo = minElo + eloRange * ratio;
            const y = getY(elo);
            return (
              <g key={ratio}>
                <line
                  x1={padding}
                  y1={y}
                  x2={chartWidth - padding}
                  y2={y}
                  stroke={alpha(theme.palette.divider, 0.5)}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <text
                  x={padding - 10}
                  y={y + 4}
                  fontSize="10"
                  fill={theme.palette.text.secondary}
                  textAnchor="end"
                >
                  {Math.round(elo)}
                </text>
              </g>
            );
          })}

          {/* Area under curve */}
          <path d={areaPath} fill={alpha(theme.palette.primary.main, 0.15)} />

          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={theme.palette.primary.main}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {dataPoints.map((point, index) => {
            const x = getX(index, dataPoints.length);
            const y = getY(point.elo);

            return (
              <g key={index}>
                <circle
                  cx={x}
                  cy={y}
                  r={pointRadius}
                  fill={theme.palette.primary.main}
                  stroke={theme.palette.background.paper}
                  strokeWidth={2}
                />
              </g>
            );
          })}
        </svg>

        {/* Stats summary */}
        <Box
          display="flex"
          justifyContent="space-between"
          mt={2}
          pt={2}
          borderTop="1px solid"
          borderColor="divider"
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('playerPage.eloChart.startingElo')}
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {displayStartingElo}
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">
              {t('playerPage.eloChart.currentElo')}
            </Typography>
            <Typography variant="body2" fontWeight={600} color="primary.main">
              {currentElo}
            </Typography>
          </Box>
          <Box textAlign="right">
            <Typography variant="caption" color="text.secondary">
              {t('playerPage.eloChart.totalChange')}
            </Typography>
            <Typography
              variant="body2"
              fontWeight={600}
              color={totalChange >= 0 ? 'success.main' : 'error.main'}
              data-testid="elo-total-change"
            >
              {totalChange >= 0 ? '+' : ''}
              {totalChange}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
