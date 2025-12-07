import React, { useRef, useEffect, useState } from 'react';
import { Box, Typography, Paper, Stack, Chip } from '@mui/material';

interface PerformanceMetricsChartProps {
  matchHistory: Array<{
    adr?: number;
    kills?: number;
    deaths?: number;
    assists?: number;
    createdAt: number;
  }>;
}

export function PerformanceMetricsChart({ matchHistory }: PerformanceMetricsChartProps) {
  const [chartWidth, setChartWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

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

  if (matchHistory.length === 0) {
    return (
      <Box textAlign="center" py={4}>
        <Typography variant="body2" color="text.secondary">
          No performance data available
        </Typography>
      </Box>
    );
  }

  // Filter matches with valid data
  const validMatches = matchHistory.filter((m) => m.adr !== undefined || m.kills !== undefined);
  if (validMatches.length === 0) {
    return (
      <Box textAlign="center" py={4}>
        <Typography variant="body2" color="text.secondary">
          No performance data available
        </Typography>
      </Box>
    );
  }

  // Chart dimensions
  const chartHeight = 200;
  const padding = 40;
  const pointRadius = 3;
  const lineWidth = 2;

  // Calculate averages for reference lines
  const avgAdr = validMatches.reduce((sum, m) => sum + (m.adr || 0), 0) / validMatches.length;
  const avgKd = validMatches.reduce((sum, m) => {
    if (m.kills !== undefined && m.deaths !== undefined && m.deaths > 0) {
      return sum + (m.kills / m.deaths);
    }
    return sum;
  }, 0) / validMatches.filter((m) => m.kills !== undefined && m.deaths !== undefined && m.deaths > 0).length;

  // Find min and max values for scaling
  const adrValues = validMatches.map((m) => m.adr || 0).filter((v) => v > 0);
  const kdValues = validMatches
    .map((m) => {
      if (m.kills !== undefined && m.deaths !== undefined && m.deaths > 0) {
        return m.kills / m.deaths;
      }
      return null;
    })
    .filter((v): v is number => v !== null);

  const minAdr = Math.min(...adrValues, avgAdr);
  const maxAdr = Math.max(...adrValues, avgAdr);
  const adrRange = maxAdr - minAdr || 1;

  const minKd = kdValues.length > 0 ? Math.min(...kdValues, avgKd) : 0;
  const maxKd = kdValues.length > 0 ? Math.max(...kdValues, avgKd) : 1;
  const kdRange = maxKd - minKd || 1;

  // Helper to get Y position for ADR (top half of chart)
  const getAdrY = (adr: number) => {
    const normalized = (adr - minAdr) / adrRange;
    return padding + (chartHeight / 2 - padding) * (1 - normalized);
  };

  // Helper to get Y position for K/D (bottom half of chart)
  const getKdY = (kd: number) => {
    const normalized = (kd - minKd) / kdRange;
    return chartHeight / 2 + padding + (chartHeight / 2 - padding) * (1 - normalized);
  };

  // Helper to get X position
  const getX = (index: number) => {
    const availableWidth = chartWidth - 2 * padding;
    return padding + (availableWidth / (validMatches.length - 1)) * index;
  };

  // Generate ADR line path
  const adrPath = validMatches
    .map((match, index) => {
      if (match.adr === undefined || match.adr === 0) return null;
      const x = getX(index);
      const y = getAdrY(match.adr);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .filter((v): v is string => v !== null)
    .join(' ');

  // Generate K/D line path
  const kdPath = validMatches
    .map((match, index) => {
      if (match.kills === undefined || match.deaths === undefined || match.deaths === 0) return null;
      const kd = match.kills / match.deaths;
      const x = getX(index);
      const y = getKdY(kd);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .filter((v): v is string => v !== null)
    .join(' ');

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        Performance Trends
      </Typography>
      <Box ref={containerRef} sx={{ width: '100%', overflow: 'hidden' }}>
        <svg width={chartWidth} height={chartHeight + 60} style={{ display: 'block' }}>
          {/* Grid lines */}
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e0e0e0" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width={chartWidth} height={chartHeight} fill="url(#grid)" />

          {/* Average reference lines */}
          {avgAdr > 0 && (
            <line
              x1={padding}
              y1={getAdrY(avgAdr)}
              x2={chartWidth - padding}
              y2={getAdrY(avgAdr)}
              stroke="#9e9e9e"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity={0.5}
            />
          )}
          {avgKd > 0 && (
            <line
              x1={padding}
              y1={getKdY(avgKd)}
              x2={chartWidth - padding}
              y2={getKdY(avgKd)}
              stroke="#9e9e9e"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity={0.5}
            />
          )}

          {/* ADR line */}
          {adrPath && (
            <path
              d={adrPath}
              fill="none"
              stroke="#4caf50"
              strokeWidth={lineWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* K/D line */}
          {kdPath && (
            <path
              d={kdPath}
              fill="none"
              stroke="#2196f3"
              strokeWidth={lineWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* ADR data points */}
          {validMatches.map((match, index) => {
            if (match.adr === undefined || match.adr === 0) return null;
            const x = getX(index);
            const y = getAdrY(match.adr);
            return (
              <circle
                key={`adr-${index}`}
                cx={x}
                cy={y}
                r={pointRadius}
                fill="#4caf50"
                stroke="#fff"
                strokeWidth="1"
              />
            );
          })}

          {/* K/D data points */}
          {validMatches.map((match, index) => {
            if (match.kills === undefined || match.deaths === undefined || match.deaths === 0) return null;
            const kd = match.kills / match.deaths;
            const x = getX(index);
            const y = getKdY(kd);
            return (
              <circle
                key={`kd-${index}`}
                cx={x}
                cy={y}
                r={pointRadius}
                fill="#2196f3"
                stroke="#fff"
                strokeWidth="1"
              />
            );
          })}

          {/* Y-axis labels for ADR */}
          <text
            x={padding - 10}
            y={padding}
            textAnchor="end"
            fontSize="10"
            fill="#666"
            dominantBaseline="middle"
          >
            {Math.ceil(maxAdr)}
          </text>
          <text
            x={padding - 10}
            y={chartHeight / 2}
            textAnchor="end"
            fontSize="10"
            fill="#666"
            dominantBaseline="middle"
          >
            {Math.floor(minAdr)}
          </text>

          {/* Y-axis labels for K/D */}
          <text
            x={padding - 10}
            y={chartHeight / 2 + padding}
            textAnchor="end"
            fontSize="10"
            fill="#666"
            dominantBaseline="middle"
          >
            {maxKd.toFixed(2)}
          </text>
          <text
            x={padding - 10}
            y={chartHeight}
            textAnchor="end"
            fontSize="10"
            fill="#666"
            dominantBaseline="middle"
          >
            {minKd.toFixed(2)}
          </text>

          {/* Labels */}
          <text
            x={chartWidth - padding}
            y={padding - 5}
            textAnchor="end"
            fontSize="11"
            fill="#4caf50"
            fontWeight="600"
          >
            ADR
          </text>
          <text
            x={chartWidth - padding}
            y={chartHeight / 2 + padding - 5}
            textAnchor="end"
            fontSize="11"
            fill="#2196f3"
            fontWeight="600"
          >
            K/D
          </text>
        </svg>

        {/* Legend and summary */}
        <Stack direction="row" spacing={2} mt={2} flexWrap="wrap">
          <Chip label={`ADR: ${avgAdr.toFixed(1)} avg`} size="small" sx={{ bgcolor: '#4caf50', color: 'white' }} />
          {avgKd > 0 && (
            <Chip label={`K/D: ${avgKd.toFixed(2)} avg`} size="small" sx={{ bgcolor: '#2196f3', color: 'white' }} />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            {validMatches.length} matches
          </Typography>
        </Stack>
      </Box>
    </Paper>
  );
}

