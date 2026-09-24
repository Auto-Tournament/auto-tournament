/**
 * The bracket's "waiting for servers" banner (3.0 phase E).
 *
 * A CS2 match cannot start until a server is free for it, so the bracket says
 * which round is waiting, for how many, and when the next allocation pass
 * runs. All of that — `servers.allocation.*`, an allocation pass at all — only
 * exists because the game has a fleet, so it moved out of `pages/Bracket.tsx`
 * whole. A game whose matches are simply open when the round opens fills the
 * slot with nothing and its bracket has no banner.
 *
 * The numbers come from the core, which asks the route this module named and
 * ticks the countdown between answers, so the banner and the round card do not
 * count the same seconds twice.
 */

import React from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../module-sdk';
import type { MatchQueueBannerProps } from '../../types';

export const Cs2AllocationBanner: React.FC<MatchQueueBannerProps> = ({
  availability,
  nextInSeconds,
}) => {
  const { t } = useModuleTranslation('cs2');

  const requiredServerCount = availability?.requiredServerCount ?? 0;
  const availableServerCount = availability?.availableServerCount ?? 0;
  const showWaitingForServersBanner = requiredServerCount > 0 && availableServerCount === 0;

  if (!showWaitingForServersBanner) {
    return null;
  }

  return (
    <Box mb={2}>
      <Alert severity="info">
        <Typography variant="body2" fontWeight={600} gutterBottom>
          {t('servers.allocation.title')}
        </Typography>
        <Typography variant="body2">
          {t('servers.allocation.waiting')} <strong>{requiredServerCount}</strong>
        </Typography>
        {typeof nextInSeconds === 'number' && nextInSeconds > 0 && (
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            {t('servers.allocation.nextPass', { seconds: nextInSeconds })}
          </Typography>
        )}
      </Alert>
    </Box>
  );
};
