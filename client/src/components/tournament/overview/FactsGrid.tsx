import { Box, Typography } from '@mui/material';
import { fontMono } from '../../../theme/tokens';

export interface Fact {
  label: string;
  value: string;
}

interface FactsGridProps {
  facts: Fact[];
}

/**
 * "How it's played" key facts: label over value, in a bordered grid. Mirrors
 * the autotournament.gg website's `.facts-grid` (see
 * website/drafts/platform/tournament.html), expressed with MUI/theme tokens
 * instead of copying its CSS.
 */
export function FactsGrid({ facts }: FactsGridProps) {
  if (facts.length === 0) return null;

  return (
    <Box
      data-testid="overview-facts"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 170px), 1fr))',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {facts.map((fact) => (
        <Box
          key={fact.label}
          sx={{
            px: 2,
            py: 1.5,
            borderRight: 1,
            borderBottom: 1,
            borderColor: 'divider',
            margin: '0 -1px -1px 0',
          }}
        >
          <Typography
            variant="caption"
            component="div"
            color="text.secondary"
            sx={{ fontFamily: fontMono, letterSpacing: 0.5, textTransform: 'uppercase' }}
          >
            {fact.label}
          </Typography>
          <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5 }}>
            {fact.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
