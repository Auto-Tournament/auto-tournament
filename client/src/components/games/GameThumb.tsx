import { useState } from 'react';
import Box from '@mui/material/Box';
import { fontDisplay } from '../../theme/tokens';

/** Up to three characters standing in for a missing cover: "Counter-Strike 2" -> "CS2". */
export function gameMonogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => (/^\d+$/.test(w) ? w : w[0]))
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

/**
 * A game's IGDB cover, or a monogram tile in the theme's colours when there is
 * none (built-ins, or a cover that fails to load). Decorative: the game name
 * is always rendered next to it.
 */
export function GameThumb({
  name,
  coverUrl,
  size = 32,
}: {
  name: string;
  coverUrl: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  // Covers are portrait (3:4); keep the tile the same shape.
  const width = Math.round(size * 0.75);

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
          width,
          height: size,
          objectFit: 'cover',
          borderRadius: 0.5,
          flexShrink: 0,
          bgcolor: 'background.surface2',
        }}
      />
    );
  }

  return (
    <Box
      aria-hidden
      sx={{
        width,
        height: size,
        borderRadius: 0.5,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.surface2',
        color: 'text.secondary',
        border: 1,
        borderColor: 'divider',
        fontFamily: fontDisplay,
        fontWeight: 600,
        fontSize: Math.max(8, Math.round(size * 0.28)),
        letterSpacing: '-0.02em',
        lineHeight: 1,
        overflow: 'hidden',
      }}
    >
      {gameMonogram(name)}
    </Box>
  );
}
