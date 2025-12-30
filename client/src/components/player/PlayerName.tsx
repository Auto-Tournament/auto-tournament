import React from 'react';
import { Typography } from '@mui/material';

interface PlayerNameProps extends React.ComponentProps<typeof Typography> {
  name: string;
  isAdmin?: boolean;
}

/**
 * Centralized player name renderer.
 *
 * - Normal players use default text styling.
 * - Admins are highlighted clearly (red, bold) so they stand out in all UIs.
 */
export function PlayerName({
  name,
  isAdmin,
  variant = 'body1',
  noWrap,
  sx,
  ...typographyProps
}: PlayerNameProps) {
  const baseSx = sx || {};

  const adminSx = isAdmin
    ? {
        color: 'error.main',
        fontWeight: 700,
      }
    : {};

  return (
    <Typography
      variant={variant}
      noWrap={noWrap}
      sx={{ ...baseSx, ...adminSx }}
      {...typographyProps}
    >
      {name}
    </Typography>
  );
}
