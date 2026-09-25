import { useState } from 'react';
import Box from '@mui/material/Box';
import { fontDisplay, gameTintPalette, withAlpha, radii } from '../../theme/tokens';
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

/** The first letter or digit of a name, upper case: "osu!" -> "O", "7 Days" -> "7". */
export function gameInitial(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name);
  return match ? match[0].toUpperCase() : '?';
}

export interface GameMarkProps {
  /** Game display name, used for the monogram fallback and as alt context. */
  name: string;
  /** Catalog slug, when known – used to pick a stable tint and as the tint key. */
  slug?: string;
  /**
   * A square picture of the game, drawn whole: its app icon
   * (`GameSummary.appIconUrl`), or a module's square tile.
   */
  iconUrl?: string | null;
  /**
   * The game pill's fallback: the game's first letter on a neutral tile,
   * rather than its initials on a per-game tint. What a game with no app
   * icon shows wherever players pick or list their games.
   */
  neutral?: boolean;
  size?: number;
}

/**
 * A small square mark for a game, for the game pills and rows: the game's
 * app icon when it has one, else a monogram — never a cover or a logo, which
 * cropped to a square is a sliver of box art nobody recognises. Decorative:
 * the game's name is always rendered next to it.
 *
 * The monogram is the game's first letter on a neutral tile (`neutral`, the
 * game pills), or its initials on a tint picked per game from the theme
 * palette (never inline hex).
 */
export function GameMark({ name, slug, iconUrl, neutral = false, size = 28 }: GameMarkProps) {
  // The URL that failed, not a flag: a mark reused for another game (a list
  // re-sorted) must try that game's picture again.
  const [failed, setFailed] = useState<string | null>(null);

  if (iconUrl && iconUrl !== failed) {
    return (
      <Box
        component="img"
        src={iconUrl}
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setFailed(iconUrl)}
        data-game-mark="icon"
        sx={{
          width: size,
          height: size,
          objectFit: 'cover',
          borderRadius: radii.sm,
          flexShrink: 0,
          bgcolor: 'background.surface2',
        }}
      />
    );
  }

  const tint = neutral ? null : tintFor(slug || name);

  return (
    <Box
      aria-hidden
      data-game-mark="initials"
      sx={{
        width: size,
        height: size,
        borderRadius: radii.sm,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(tint
          ? { bgcolor: withAlpha(tint, 0.16), color: tint }
          : {
              bgcolor: 'background.surface2',
              color: 'text.secondary',
              border: 1,
              borderColor: 'divider',
            }),
        fontFamily: fontDisplay,
        fontWeight: 700,
        fontSize: Math.max(8, Math.round(size * (tint ? 0.32 : 0.5))),
        letterSpacing: '-0.02em',
        lineHeight: 1,
        overflow: 'hidden',
      }}
    >
      {tint ? gameMonogram(name) : gameInitial(name)}
    </Box>
  );
}
