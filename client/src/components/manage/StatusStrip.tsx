import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ManageStatusCounts } from '../../utils/manageSelectors';

interface StatusStripProps {
  counts: ManageStatusCounts;
  /**
   * The game's own tile, between the match counts and the round (CS2: servers
   * free). A game with nothing of its own to count leaves it out, and the
   * strip is one tile shorter — which is the truth, where "0 / 0" was not.
   */
  resourceTile?: React.ReactNode;
}

/**
 * One tile of the strip, exported so a game module's tile is built the same
 * way as the ones beside it rather than re-styled from scratch.
 */
export const ManageStatusTile: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <Box
    sx={{
      px: 2,
      py: 1.5,
      borderRight: 1,
      borderBottom: 1,
      borderColor: 'divider',
    }}
  >
    <Typography
      variant="caption"
      color="text.secondary"
      fontFamily="monospace"
      fontWeight={600}
      display="block"
    >
      {label}
    </Typography>
    <Typography variant="h5" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </Typography>
  </Box>
);

/**
 * Flat strip of the tournament's current shape: LIVE / IN VETO / QUEUED /
 * ROUND, plus whatever the game counts for itself (CS2: SERVERS FREE). The
 * match values all come from the matches already fetched for this page.
 */
export const StatusStrip: React.FC<StatusStripProps> = ({ counts, resourceTile }) => {
  const { t } = useTranslation();

  const tiles: { label: string; value: React.ReactNode }[] = [
    { label: t('managePage.status.live'), value: counts.live },
    { label: t('managePage.status.inVeto'), value: counts.inVeto },
    { label: t('managePage.status.queued'), value: counts.queued },
  ];

  const trailingTiles: { label: string; value: React.ReactNode }[] = [];
  if (counts.roundLabel) {
    trailingTiles.push({ label: t('managePage.status.round'), value: counts.roundLabel });
  }

  return (
    <Paper
      variant="outlined"
      data-testid="manage-status-strip"
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, 150px), 1fr))`,
        overflow: 'hidden',
        mb: 3,
      }}
    >
      {tiles.map((tile) => (
        <ManageStatusTile key={tile.label} label={tile.label} value={tile.value} />
      ))}
      {resourceTile}
      {trailingTiles.map((tile) => (
        <ManageStatusTile key={tile.label} label={tile.label} value={tile.value} />
      ))}
    </Paper>
  );
};
