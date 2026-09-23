/**
 * The shuffle round card's countdown chip (3.0 phase E follow-up).
 *
 * `RoundStatusCard` counts what a round has done, what is playing and what is
 * still pending — true of any game — and then put one more chip beside them
 * saying when the next *servers* arrive. That one is about an allocation pass,
 * which is a thing only a game with a fleet has, so it moved here and the card
 * now renders whatever the module hands it, or nothing.
 *
 * The literal English is the literal English the card had: this is a move, and
 * a CS2 install should see exactly what it saw yesterday.
 */

import React from 'react';
import { Chip } from '@mui/material';
import type { MatchQueueBannerProps } from '../../types';

export const Cs2NextAllocationChip: React.FC<MatchQueueBannerProps> = ({ nextInSeconds }) => {
  if (nextInSeconds === null || nextInSeconds <= 0) return null;

  return (
    <Chip
      label={`Next servers in ${Math.max(0, nextInSeconds)}s`}
      size="small"
      color="info"
      variant="outlined"
    />
  );
};
