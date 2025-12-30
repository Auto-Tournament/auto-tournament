import React from 'react';
import { Avatar } from '@mui/material';

interface PlayerAvatarProps {
  id: string;
  name: string;
  avatarUrl?: string | null;
  size?: number;
}

/**
 * Centralized player avatar component.
 *
 * Rules:
 * - Prefer the explicit avatarUrl passed in (Steam / custom).
 * - Otherwise fall back to the deterministic backend-generated SVG at
 *   /api/players/:id/avatar.svg so all views stay visually consistent.
 */
export function PlayerAvatar({ id, name, avatarUrl, size = 40 }: PlayerAvatarProps) {
  const fallback = `/api/players/${id}/avatar.svg`;
  const src = avatarUrl && avatarUrl.trim().length > 0 ? avatarUrl : fallback;

  return (
    <Avatar src={src} alt={name} sx={{ width: size, height: size }}>
      {name.charAt(0).toUpperCase()}
    </Avatar>
  );
}


