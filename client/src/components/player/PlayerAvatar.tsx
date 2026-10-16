import { useState } from 'react';
import { Box, Skeleton, type BoxProps } from '@mui/material';
import { tokens } from '../../theme/tokens';
import { AvatarPresence } from '../social/PresenceDot';

const { color } = tokens;

/** "Ola Nordmann" → "ON". */
export function playerInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export interface PlayerAvatarProps {
  name: string;
  /** The player's id: without a picture, the generated one (/api/players/:id/avatar.svg). */
  id?: string | null;
  /** Their picture (Steam or their own). `avatar` is the same, for older callers. */
  avatarUrl?: string | null;
  avatar?: string | null;
  size?: number;
  sx?: BoxProps['sx'];
  /** No name next to it: the avatar names the player itself (otherwise hidden from screen readers). */
  label?: boolean;
  /** A placeholder while the player loads. */
  isLoading?: boolean;
  /** Ignored: admins show by their name's colour. */
  isAdmin?: boolean;
  /** The online / away / offline dot on the corner (needs `id`). On by default. */
  presence?: boolean;
}

/**
 * The one player picture: their own, else the generated one for their id,
 * else their initials (also when the picture fails to load). Every player
 * everywhere uses this; no MUI <Avatar> for a player. With an `id`, a dot on
 * the bottom-right says whether they are online, away or offline.
 */
export function PlayerAvatar({
  name,
  id,
  avatarUrl,
  avatar,
  size = 32,
  sx,
  label = false,
  isLoading = false,
  presence = true,
}: PlayerAvatarProps) {
  const [broken, setBroken] = useState<string | null>(null);
  if (isLoading) {
    return (
      <Skeleton
        variant="circular"
        width={size}
        height={size}
        sx={{ bgcolor: 'action.hover', flex: 'none' }}
      />
    );
  }
  const own = (avatarUrl ?? avatar ?? '').trim();
  const generated = id && id.trim() ? `/api/players/${id}/avatar.svg` : '';
  const src = [own, generated].find((u) => u && u !== broken) ?? '';
  const playerId = id?.trim() || null;
  return (
    <Box
      component="span"
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        position: 'relative',
        display: 'inline-grid',
        bgcolor: color.rule,
        ...sx,
      }}
    >
      {/* The picture; the status dot sits outside it, so a screen reader that
          skips a decorative avatar still hears the status. */}
      <Box
        component="span"
        title={name}
        {...(label ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
        sx={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          // The colours on the element with the initials, so a contrast check
          // reads them here and not through the status dot on the corner.
          bgcolor: color.rule,
          color: color.ink2,
          fontSize: size >= 40 ? '0.8125rem' : '0.6875rem',
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {src ? (
          <Box
            component="img"
            src={src}
            alt=""
            onError={() => setBroken(src)}
            sx={{ width: size, height: size, objectFit: 'cover', display: 'block' }}
          />
        ) : (
          playerInitials(name)
        )}
      </Box>
      {presence && playerId && <AvatarPresence playerId={playerId} size={size} />}
    </Box>
  );
}
