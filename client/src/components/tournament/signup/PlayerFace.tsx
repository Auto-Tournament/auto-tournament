import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { tokens } from '../../../theme/tokens';

const { color } = tokens;

/** A player's avatar (or initial) with an optional corner badge. */
export function Face({
  name,
  avatar,
  size = 48,
  dim = false,
  badge,
}: {
  name: string;
  avatar?: string | null;
  size?: number;
  dim?: boolean;
  /** Colour and icon of the corner mark (a tick, a warning). */
  badge?: { tone: string; icon: ReactNode };
}) {
  return (
    <Box
      component="span"
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        bgcolor: color.paper3,
        backgroundImage: avatar ? `url("${avatar}")` : 'none',
        backgroundSize: 'cover',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 600,
        fontSize: size * 0.38,
        color: color.ink,
        opacity: dim ? 0.45 : 1,
      }}
    >
      {!avatar && name.slice(0, 1).toUpperCase()}
      {badge && (
        <Box
          component="span"
          sx={{
            position: 'absolute',
            right: -3,
            bottom: -3,
            width: Math.round(size * 0.42),
            height: Math.round(size * 0.42),
            borderRadius: '50%',
            bgcolor: badge.tone,
            color: color.accentInk,
            display: 'grid',
            placeItems: 'center',
            boxShadow: `0 0 0 2px ${color.paper2}`,
          }}
        >
          {badge.icon}
        </Box>
      )}
    </Box>
  );
}

/** A face with the name (and an optional note) under it, for lineup grids. */
export function PersonTile({
  name,
  avatar,
  note,
  noteTone,
  dim,
  badge,
}: {
  name: string;
  avatar?: string | null;
  note?: string;
  noteTone?: string;
  dim?: boolean;
  badge?: { tone: string; icon: ReactNode };
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, textAlign: 'center', minWidth: 0 }}>
      <Face name={name} avatar={avatar} size={52} dim={dim} badge={badge} />
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: '100%' }}>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </Typography>
        {note && (
          <Typography sx={{ fontSize: '0.75rem', color: noteTone ?? color.muted }}>{note}</Typography>
        )}
      </Box>
    </Box>
  );
}

/** A team's tag as a small square mark. */
export function TeamMark({ tag, name, size = 36, highlight }: { tag?: string | null; name: string; size?: number; highlight?: boolean }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: `${Math.round(size / 4)}px`,
        bgcolor: color.paper3,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: Math.max(10, Math.round(size / 3.6)),
        color: highlight ? color.accent : color.ink2,
      }}
    >
      {(tag?.trim() || name.slice(0, 3)).slice(0, 4).toUpperCase()}
    </Box>
  );
}
