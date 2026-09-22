import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

export interface RatingChartPoint {
  eloAfter: number;
  createdAt: number;
}

export interface RatingChartProps {
  history: RatingChartPoint[];
  /** How many of the most recent matches to plot. */
  limit?: number;
}

/**
 * Flat single-line rating trend for the last N matches — no area fill, no
 * grid, no glow, just a stroked line in the theme accent colour. Reuses the
 * same rating-history data as the detailed ELO chart further down the page.
 */
export function RatingChart({ history, limit = 20 }: RatingChartProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) setWidth(containerRef.current.offsetWidth);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const recent = [...history].sort((a, b) => a.createdAt - b.createdAt).slice(-limit);

  if (recent.length < 2) {
    return (
      <Box textAlign="center" py={4} data-testid="profile-rating-chart-empty">
        <Typography variant="body2" color="text.secondary">
          {t('playerPage.ratingChart.noHistory')}
        </Typography>
      </Box>
    );
  }

  const height = 60;
  const values = recent.map((p) => p.eloAfter);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const getX = (index: number) => (width * index) / (recent.length - 1);
  const getY = (elo: number) => height - ((elo - min) / range) * height;

  const points = recent.map((p, i) => `${getX(i)},${getY(p.eloAfter)}`).join(' ');

  const monthFormatter = new Intl.DateTimeFormat(i18n.language, { month: 'short' });
  const firstLabel = monthFormatter.format(new Date(recent[0].createdAt * 1000));
  const lastLabel = monthFormatter.format(new Date(recent[recent.length - 1].createdAt * 1000));

  return (
    <Box data-testid="profile-rating-chart">
      <Box ref={containerRef} sx={{ width: '100%' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          width="100%"
          height={140}
          aria-label={t('playerPage.ratingChart.ariaLabel', {
            from: recent[0].eloAfter,
            to: recent[recent.length - 1].eloAfter,
          })}
        >
          <polyline
            fill="none"
            stroke={theme.palette.primary.main}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            points={points}
          />
        </svg>
      </Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.75rem',
          color: 'text.secondary',
          mt: 0.5,
        }}
      >
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </Box>
    </Box>
  );
}
