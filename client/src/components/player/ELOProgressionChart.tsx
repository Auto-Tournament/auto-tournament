import React, { useRef, useEffect, useState } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';

interface ELOProgressionChartProps {
  history: Array<{
    eloBefore: number;
    eloAfter: number;
    eloChange: number;
    matchResult: 'win' | 'loss';
    createdAt: number;
  }>;
  currentElo: number;
  startingElo: number;
}

export function ELOProgressionChart({ history, currentElo, startingElo }: ELOProgressionChartProps) {
  // Chart dimensions - hooks must be called before any early returns
  const chartHeight = 200;
  const padding = 40;
  const pointRadius = 4;
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
          No rating history available
        </Typography>
      </Box>
    );
  }

  // Prepare data points: include starting ELO and all history points
  const dataPoints = [
    { elo: startingElo, label: 'Starting', isStart: true },
    ...history.map((entry) => ({
      elo: entry.eloAfter,
      label: entry.matchResult === 'win' ? 'Win' : 'Loss',
      change: entry.eloChange,
      isStart: false,
    })),
  ];

  // Find min and max ELO for scaling
  const allElos = [startingElo, currentElo, ...history.map((h) => h.eloAfter)];
  const minElo = Math.min(...allElos);
  const maxElo = Math.max(...allElos);
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

  // Generate path for line
  const linePath = dataPoints
    .map((point, index) => {
      const x = getX(index, dataPoints.length);
      const y = getY(point.elo);
      return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(' ');

  // Generate area path
  const areaPath = `${linePath} L ${padding + availableWidth} ${chartHeight + padding - padding} L ${padding} ${chartHeight + padding - padding} Z`;

  return (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.paper' }}>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        ELO Progression
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
        <svg
          width="100%"
          height={chartHeight + padding}
          style={{ overflow: 'visible' }}
        >
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
          <path
            d={areaPath}
            fill={alpha(theme.palette.primary.main, 0.15)}
          />

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
            const isWin = point.change !== undefined && point.change > 0;
            const isLoss = point.change !== undefined && point.change < 0;

            return (
              <g key={index}>
                <circle
                  cx={x}
                  cy={y}
                  r={pointRadius}
                  fill={
                    point.isStart
                      ? theme.palette.text.secondary
                      : isWin
                      ? theme.palette.success.main
                      : isLoss
                      ? theme.palette.error.main
                      : theme.palette.primary.main
                  }
                  stroke={theme.palette.background.paper}
                  strokeWidth={2}
                />
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <Box display="flex" gap={2} mt={1} justifyContent="center">
          <Box display="flex" alignItems="center" gap={0.5}>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                  bgcolor: theme.palette.text.secondary,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Start
            </Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={0.5}>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                  bgcolor: theme.palette.success.main,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Win
            </Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={0.5}>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                  bgcolor: theme.palette.error.main,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Loss
            </Typography>
          </Box>
        </Box>

        {/* Stats summary */}
        <Box display="flex" justifyContent="space-between" mt={2} pt={2} borderTop="1px solid" borderColor="divider">
          <Box>
            <Typography variant="caption" color="text.secondary">
              Starting ELO
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {startingElo}
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">
              Current ELO
            </Typography>
            <Typography variant="body2" fontWeight={600} color="primary.main">
              {currentElo}
            </Typography>
          </Box>
          <Box textAlign="right">
            <Typography variant="caption" color="text.secondary">
              Total Change
            </Typography>
            <Typography
              variant="body2"
              fontWeight={600}
              color={currentElo >= startingElo ? 'success.main' : 'error.main'}
            >
              {currentElo >= startingElo ? '+' : ''}
              {currentElo - startingElo}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}

