import { useState } from 'react';
import Box from '@mui/material/Box';
import { fontDisplay, gameTintPalette, withAlpha } from '../../theme/tokens';
import { gameMonogram } from '../games/GameThumb';

/**
 * Deterministically picks a tint from `gameTintPalette` for a game key (its
 * catalog slug, falling back to its name), so the same game always renders
 * with the same colour.
 */
function tintFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % gameTintPalette.length;
  return gameTintPalette[index];
}

export interface GameMarkProps {
  /** Game display name, used for the monogram fallback and as alt context. */
  name: string;
  /** Catalog slug, when known – used to pick a stable tint and as the tint key. */
  slug?: string;
  /** Cover thumbnail URL from the games table, when available. */
  coverUrl?: string | null;
  size?: number;
}

/**
 * A small square mark for a game: its catalog cover thumbnail when one is
 * available, otherwise a monogram tile tinted per-game from theme tokens
 * (never inline hex).
 */
export function GameMark({ name, slug, coverUrl, size = 28 }: GameMarkProps) {
  const [failed, setFailed] = useState(false);

  if (coverUrl && !failed) {
    return (
      <Box
        component="img"
        src={coverUrl}
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setFailed(true)}
        sx={{
          width: size,
          height: size,
          objectFit: 'cover',
          borderRadius: 1,
          flexShrink: 0,
          bgcolor: 'background.surface2',
        }}
      />
    );
  }

  const tint = tintFor(slug || name);

  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: 1,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: withAlpha(tint, 0.16),
        color: tint,
        fontFamily: fontDisplay,
        fontWeight: 700,
        fontSize: Math.max(8, Math.round(size * 0.32)),
        letterSpacing: '-0.02em',
        lineHeight: 1,
        overflow: 'hidden',
      }}
    >
      {gameMonogram(name)}
    </Box>
  );
}
