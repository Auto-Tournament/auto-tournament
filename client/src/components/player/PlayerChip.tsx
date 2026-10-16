import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, type BoxProps } from '@mui/material';
import { PlayerAvatar } from './PlayerAvatar';
import { playerProfilePath } from '../../paths';
import { tokens } from '../../theme/tokens';

const { color } = tokens;

export interface PlayerChipProps {
  /** The player's id (Steam id): their profile and generated picture. */
  id?: string | null;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  /** A line under the name (a team, a role). */
  sub?: ReactNode;
  /** After the name on the same line ("you", a badge). */
  after?: ReactNode;
  /** Link to the profile (default when there is an id). */
  link?: boolean;
  sx?: BoxProps['sx'];
  'data-testid'?: string;
}

/**
 * A player as a name with their picture, linking to their profile: the one way
 * a player is shown in lists, rosters and tables.
 */
export function PlayerChip({
  id,
  name,
  avatarUrl,
  size = 28,
  sub,
  after,
  link = true,
  sx,
  'data-testid': testId,
}: PlayerChipProps) {
  const linked = link && !!id;
  return (
    <Box
      {...(linked
        ? { component: RouterLink, to: playerProfilePath(id as string) }
        : { component: 'span' })}
      data-testid={testId}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        minWidth: 0,
        maxWidth: '100%',
        color: color.ink,
        textDecoration: 'none',
        ...(linked
          ? {
              '&:hover .player-chip-name': { textDecoration: 'underline' },
              '&:focus-visible': {
                outline: `2px solid ${color.focus}`,
                outlineOffset: 2,
                borderRadius: '6px',
              },
            }
          : {}),
        ...sx,
      }}
    >
      <PlayerAvatar id={id} name={name} avatarUrl={avatarUrl} size={size} />
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box
          component="span"
          sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}
        >
          <Box
            component="span"
            className="player-chip-name"
            sx={{
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {name}
          </Box>
          {after}
        </Box>
        {sub && (
          <Box
            component="span"
            sx={{
              fontSize: '0.8125rem',
              color: color.ink2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sub}
          </Box>
        )}
      </Box>
    </Box>
  );
}
