import { Box, Link as RouterLink } from '@mui/material';
import { Link } from 'react-router-dom';
import { LiveChip } from '../../common/ui';

interface LiveStripProps {
  liveCount: number;
  label: string;
  linkLabel: string;
  linkTo: string;
}

/** Slim "live now" strip, only shown while matches are actually live. */
export function LiveStrip({ liveCount, label, linkLabel, linkTo }: LiveStripProps) {
  if (liveCount <= 0) return null;

  return (
    <Box
      data-testid="overview-live-strip"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        mt: 2,
        px: 2,
        py: 1,
        border: 1,
        borderColor: 'divider',
        borderRadius: 999,
      }}
    >
      <LiveChip label={label} />
      <RouterLink component={Link} to={linkTo} variant="body2" sx={{ ml: 'auto' }}>
        {linkLabel}
      </RouterLink>
    </Box>
  );
}
