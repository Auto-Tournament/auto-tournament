import React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';
import Chip, { type ChipProps } from '@mui/material/Chip';
import { tokens, fontDisplay, mono } from '../../theme/tokens';

/**
 * Small building blocks shared by the restyled views. They mirror the product
 * cards on autotournament.gg (website src/components/ui.tsx).
 */

const { color, radius, ease, duration } = tokens;

/** Card title row: display-face title on the left, a chip or action on the right. */
export function CardHead({
  title,
  tag,
  sx,
}: {
  title: React.ReactNode;
  tag?: React.ReactNode;
  sx?: BoxProps['sx'];
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 1.5,
        mb: 2,
        minWidth: 0,
        ...(sx as object),
      }}
    >
      <Box sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1rem', minWidth: 0 }}>{title}</Box>
      {tag}
    </Box>
  );
}

/** Mono chip with a green dot, for anything that is live right now. */
export function LiveChip({ label, sx, ...props }: Omit<ChipProps, 'label'> & { label: React.ReactNode }) {
  return (
    <Chip
      size="small"
      label={label}
      {...props}
      sx={{
        color: color.live,
        backgroundColor: color.paper3,
        '&::before': {
          content: '""',
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: color.live,
          ml: 1,
          flex: 'none',
        },
        ...(sx as object),
      }}
    />
  );
}

export type StatusDotState = 'live' | 'loading' | 'free' | 'done' | 'error' | 'warning';

const dotColor: Record<StatusDotState, string> = {
  live: color.live,
  loading: color.accent,
  free: color.muted,
  done: color.ink2,
  error: color.ban,
  warning: color.warning,
};

/** 9px status dot: live green, loading orange, free muted. */
export function StatusDot({ state, size = 9, sx }: { state: StatusDotState; size?: number; sx?: BoxProps['sx'] }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        bgcolor: dotColor[state],
        boxShadow: state === 'live' ? `0 0 0 3px ${color.paper3}, 0 0 10px ${color.live}` : 'none',
        transition: `background-color ${duration.base}ms ${ease.out}`,
        ...(sx as object),
      }}
    />
  );
}

/** Stat tile: big mono value over a small muted label, on paper3. */
export function StatTile({
  value,
  label,
  accent,
  sx,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  accent?: string;
  sx?: BoxProps['sx'];
}) {
  return (
    <Box
      sx={{
        bgcolor: color.paper3,
        borderRadius: `${radius.sm}px`,
        p: 1.5,
        minWidth: 0,
        ...(sx as object),
      }}
    >
      <Box
        sx={{
          ...mono,
          fontWeight: 600,
          fontSize: '1.125rem',
          color: accent ?? color.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Box>
      <Box sx={{ color: color.muted, fontSize: '0.75rem' }}>{label}</Box>
    </Box>
  );
}

/** Small mono label used above groups (round names, section captions). */
export const sectionLabelSx = {
  ...mono,
  fontSize: '0.75rem',
  color: color.muted,
} as const;

/** Inset row on paper3, as used for server rows and veto map rows. */
export const insetRowSx = {
  bgcolor: color.paper3,
  borderRadius: `${radius.md}px`,
} as const;
