import React from 'react';
import { Avatar, Skeleton } from '@mui/material';

interface PlayerAvatarProps {
  id?: string | null;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  isAdmin?: boolean;
  /**
   * When true, renders a neutral skeleton/placeholder instead of any avatar
   * content. Useful while player data is still loading to avoid flashes.
   */
  isLoading?: boolean;
}

/**
 * Centralized player avatar component.
 *
 * Rules:
 * - Prefer the explicit avatarUrl passed in (Steam / custom).
 * - Otherwise fall back to the deterministic backend-generated SVG at
 *   /api/players/:id/avatar.svg so all views stay visually consistent.
 */
export function PlayerAvatar({
  id,
  name,
  avatarUrl,
  size = 40,
  isAdmin: _isAdmin,
  isLoading = false,
}: PlayerAvatarProps) {
  const dimension = size;

  if (isLoading) {
    return (
      <Skeleton
        variant="circular"
        width={dimension}
        height={dimension}
        sx={{ bgcolor: 'action.hover', borderRadius: '50%' }}
      />
    );
  }

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

  // If we don't have any source at all, render a neutral gray circle instead of
  // an initial so we don't "flash" a random letter while things load.
  if (!src) {
    return (
      <Avatar
        sx={{
          ...baseSx,
          ...adminSx,
          bgcolor: 'action.hover',
        }}
      />
    );
  }

  return <Avatar src={src} alt={name} sx={{ ...baseSx, ...adminSx }} />;
}


