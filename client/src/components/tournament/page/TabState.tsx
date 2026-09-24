import type { ReactNode } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { Panel } from '../../common/ui';
import { tokens, textSize } from '../../../theme/tokens';

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
    <Panel role="status" data-testid={testId} sx={{ p: { xs: 3, md: 4 }, display: 'grid', gap: 1 }}>
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      <Typography sx={{ color: tokens.color.muted, fontSize: textSize.sm, maxWidth: '60ch' }}>
        {description}
      </Typography>
      {children}
    </Panel>
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
