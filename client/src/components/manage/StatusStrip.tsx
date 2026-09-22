import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ManageStatusCounts } from '../../utils/manageSelectors';

interface StatusStripProps {
  counts: ManageStatusCounts;
}

/**
 * Flat strip of the tournament's current shape: LIVE / IN VETO / QUEUED /
 * SERVERS FREE / ROUND. All values come from the same matches +
 * server-availability data already fetched for this page.
 */
export const StatusStrip: React.FC<StatusStripProps> = ({ counts }) => {
  const { t } = useTranslation();

  const tiles: { label: string; value: React.ReactNode }[] = [
    { label: t('managePage.status.live'), value: counts.live },
    { label: t('managePage.status.inVeto'), value: counts.inVeto },
    { label: t('managePage.status.queued'), value: counts.queued },
    {
      label: t('managePage.status.serversFree'),
      value: `${counts.serversFree} / ${counts.serversTotal}`,
    },
  ];

  if (counts.roundLabel) {
    tiles.push({ label: t('managePage.status.round'), value: counts.roundLabel });
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
      {tiles.map((tile, index) => (
        <Box
          key={index}
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
            {tile.label}
          </Typography>
          <Typography variant="h5" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {tile.value}
          </Typography>
        </Box>
      ))}
    </Paper>
  );
};
