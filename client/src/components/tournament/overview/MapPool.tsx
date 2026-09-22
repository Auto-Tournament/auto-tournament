import { Box, Chip, Typography } from '@mui/material';

interface MapPoolProps {
  /** Display names, already resolved. */
  mapNames: string[];
  note?: string;
}

/** Map pool chips + an optional note (e.g. "Active Duty pool"). */
export function MapPool({ mapNames, note }: MapPoolProps) {
  if (mapNames.length === 0) return null;

  return (
    <Box data-testid="overview-map-pool">
      <Box display="flex" flexWrap="wrap" gap={1}>
        {mapNames.map((name) => (
          <Chip key={name} label={name} size="small" variant="outlined" />
        ))}
      </Box>
      {note && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {note}
        </Typography>
      )}
    </Box>
  );
}
