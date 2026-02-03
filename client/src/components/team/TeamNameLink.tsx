import React from 'react';
import { Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { TypographyProps } from '@mui/material/Typography';
import { Link as RouterLink, useMatch } from 'react-router-dom';

type TeamNameLinkProps = {
  teamId?: string | null;
  name?: string | null;
  tag?: string | null;
  /**
   * When true (default), formats as "[TAG] Name" if tag exists.
   * When false, shows name only.
   */
  showTag?: boolean;
  variant?: TypographyProps['variant'];
  noWrap?: boolean;
  sx?: SxProps<Theme>;
  onClick?: React.MouseEventHandler<HTMLElement>;
};

function isPlaceholderTeamId(teamId: string | null | undefined): boolean {
  return teamId === 'team1' || teamId === 'team2';
}

export function TeamNameLink({
  teamId,
  name,
  tag,
  showTag = true,
  variant = 'body1',
  noWrap,
  sx,
  onClick,
}: TeamNameLinkProps) {
  const match = useMatch('/team/:teamId');
  const currentTeamId = match?.params?.teamId ?? null;

  const safeName = (name ?? '').trim();
  const safeTag = (tag ?? '').trim();

  const label =
    showTag && safeTag.length > 0 ? `[${safeTag}] ${safeName || '—'}` : safeName || '—';

  const canLink =
    !!teamId &&
    teamId.trim().length > 0 &&
    !isPlaceholderTeamId(teamId) &&
    !(currentTeamId && currentTeamId === teamId);

  if (!canLink) {
    return (
      <Typography variant={variant} noWrap={noWrap} sx={sx} onClick={onClick}>
        {label}
      </Typography>
    );
  }

  return (
    <Typography
      variant={variant}
      noWrap={noWrap}
      component={RouterLink}
      to={`/team/${teamId}`}
      onClick={onClick}
      sx={[
        {
          textDecoration: 'none',
          color: 'inherit',
          '&:hover': { textDecoration: 'underline' },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {label}
    </Typography>
  );
}

