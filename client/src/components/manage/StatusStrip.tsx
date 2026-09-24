import React from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ManageStatusCounts } from '../../utils/manageSelectors';
import { tokens, fontDisplay, fontMono, radii, textSize } from '../../theme/tokens';

const { color } = tokens;

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
 * way as the ones beside it rather than re-styled from scratch. A `dt` / `dd`
 * pair in the strip's `dl` (the draft's `dl.status`), so the numbers are not
 * headings.
 */
export const ManageStatusTile: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <Box
    sx={{
      px: 3,
      py: 2,
      borderRight: `1px solid ${color.rule}`,
      borderBottom: `1px solid ${color.rule}`,
      margin: '0 -1px -1px 0',
      minWidth: 0,
    }}
  >
    <Box
      component="dt"
      sx={{ fontFamily: fontMono, fontSize: textSize.xs, fontWeight: 500, lineHeight: 1.4, color: color.muted }}
    >
      {label}
    </Box>
    <Box
      component="dd"
      sx={{
        m: 0,
        mt: 0.5,
        fontFamily: fontDisplay,
        fontSize: textSize.xl,
        fontWeight: 700,
        lineHeight: 1.2,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </Box>
  </Box>
);

/**
 * Flat strip of the tournament's current shape: LIVE / IN VETO / QUEUED /
 * ROUND, plus whatever the game counts for itself (CS2: SERVERS FREE). The
 * match values all come from the matches already fetched for this page.
 * ROUND is always there, "—" before the first one, so the strip keeps its
 * shape from the empty console to the final.
 */
export const StatusStrip: React.FC<StatusStripProps> = ({ counts, resourceTile }) => {
  const { t } = useTranslation();

  const tiles: { label: string; value: React.ReactNode }[] = [
    { label: t('managePage.status.live'), value: counts.live },
    { label: t('managePage.status.inVeto'), value: counts.inVeto },
    { label: t('managePage.status.queued'), value: counts.queued },
  ];

  return (
    <Box
      component="dl"
      data-testid="manage-status-strip"
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, 150px), 1fr))`,
        border: `1px solid ${color.rule}`,
        borderRadius: radii.lg,
        overflow: 'hidden',
        m: 0,
        mb: 6,
      }}
    >
      {tiles.map((tile) => (
        <ManageStatusTile key={tile.label} label={tile.label} value={tile.value} />
      ))}
      {resourceTile}
      <ManageStatusTile label={t('managePage.status.round')} value={counts.roundLabel || '—'} />
    </Box>
  );
};
