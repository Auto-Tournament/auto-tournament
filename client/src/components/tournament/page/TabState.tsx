import type { ReactNode } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { tokens } from '../../../theme/tokens';
import { h2Sx, panel } from '../ui/draftUi';

/** A tab with nothing to show yet: a quiet panel with a title and one line. */
export function TabEmpty({
  title,
  description,
  children,
  'data-testid': testId,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <Box role="status" data-testid={testId} sx={{ ...panel, alignItems: 'flex-start' }}>
      <Typography component="h2" sx={h2Sx}>
        {title}
      </Typography>
      <Typography sx={{ color: tokens.color.ink2, maxWidth: '60ch', lineHeight: 1.55 }}>
        {description}
      </Typography>
      {children}
    </Box>
  );
}

/** Loading or failed, for a tab that fetches its own data. */
export function TabLoading({ label }: { label: string }) {
  return (
    <Box display="flex" justifyContent="center" py={8}>
      <CircularProgress aria-label={label} />
    </Box>
  );
}

export function TabError({ message }: { message: string }) {
  return <Alert severity="error">{message}</Alert>;
}
