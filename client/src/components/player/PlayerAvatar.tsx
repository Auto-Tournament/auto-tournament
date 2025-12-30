import React from 'react';
import { Avatar } from '@mui/material';

interface PlayerAvatarProps {
  id?: string | null;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  isAdmin?: boolean;
}

/**
 * Centralized player avatar component.
 *
 * Rules:
 * - Prefer the explicit avatarUrl passed in (Steam / custom).
 * - Otherwise fall back to the deterministic backend-generated SVG at
 *   /api/players/:id/avatar.svg so all views stay visually consistent.
 */
export function PlayerAvatar({ id, name, avatarUrl, size = 40, isAdmin }: PlayerAvatarProps) {
  const hasExplicit = typeof avatarUrl === 'string' && avatarUrl.trim().length > 0;
  const hasId = typeof id === 'string' && id.trim().length > 0;

  // Only build the backend fallback URL when we have a valid player ID; this
  // avoids 404s like /api/players/undefined/avatar.svg for temporary/placeholder
  // rows (e.g., team editors or partial forms).
  const fallback = hasId ? `/api/players/${id}/avatar.svg` : undefined;
  const src = hasExplicit ? avatarUrl : fallback;

  const baseSx = { width: size, height: size };

  // Admins are now indicated purely via name color; keep avatars visually neutral.
  const adminSx = {};

  return (
    <Avatar src={src} alt={name} sx={{ ...baseSx, ...adminSx }}>
      {name.charAt(0).toUpperCase()}
    </Avatar>
  );
}


