import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { StatTile } from '../../common/ui';
import { mono } from '../../../theme/tokens';

export interface ProfileStat {
  /** Stable key, also used to build the tile's `data-testid`. */
  key: string;
  label: string;
  value: string;
  /** Optional "+24" / "-12" style change shown next to the value. */
  change?: number;
}

export interface StatsGridProps {
  stats: ProfileStat[];
}

/**
 * Flat stat tile row (RATING, MATCHES, WIN RATE, ADR, K/D, TITLES). Tiles
 * whose data does not exist are never passed in by the caller — this
 * component never invents a number, it only lays out what it is given.
 */
export function StatsGrid({ stats }: StatsGridProps) {
  const theme = useTheme();
  if (stats.length === 0) return null;

  return (
    <Box
      data-testid="profile-stats-grid"
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          sm: 'repeat(3, minmax(0, 1fr))',
          md: `repeat(${Math.min(stats.length, 6)}, minmax(0, 1fr))`,
        },
        gap: 1,
      }}
    >
      {stats.map((stat) => (
        <Box
          key={stat.key}
          data-testid={stat.key === 'rating' ? 'public-player-elo' : `profile-stat-${stat.key}`}
        >
          <StatTile
            size="lg"
            label={stat.label}
            value={
              <Box component="span" sx={{ ...mono }}>
                {stat.value}
                {typeof stat.change === 'number' && stat.change !== 0 && (
                  <Box
                    component="span"
                    sx={{
                      ...mono,
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      ml: 0.75,
                      color: stat.change > 0 ? theme.palette.success.main : theme.palette.error.main,
                    }}
                  >
                    {stat.change > 0 ? '+' : ''}
                    {stat.change}
                  </Box>
                )}
              </Box>
            }
          />
        </Box>
      ))}
    </Box>
  );
}
