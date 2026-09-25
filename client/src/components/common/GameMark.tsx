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

/**
 * Whether a cover URL is an IGDB cover. Only those are box art that crops to
 * a square; a Wikidata "cover" is the game's wide wordmark, and a sliver of a
 * wordmark ("ROC LEA") is exactly what a game mark must never show.
 */
export function isIgdbCover(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url, window.location.origin).hostname === 'images.igdb.com';
  } catch {
    return false;
  }
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
   * The catalogue cover (`GameSummary.coverUrl`). Used only when it is an
   * IGDB cover — cropped to a square from the top — never a wide logo.
   */
  coverUrl?: string | null;
  size?: number;
}

/**
 * A small square mark for a game, for the game pills and rows: the game's
 * app icon, else its IGDB cover cropped square, else its initials on a tint
 * picked per game from the theme palette (never inline hex). Decorative: the
 * game's name is always rendered next to it.
 */
export function GameMark({ name, slug, iconUrl, coverUrl, size = 28 }: GameMarkProps) {
  // The URL that failed, not a flag: a mark reused for another game (a list
  // re-sorted) must try that game's picture again.
  const [failed, setFailed] = useState<string | null>(null);

  const candidates = [
    iconUrl ? { src: iconUrl, position: 'center' } : null,
    isIgdbCover(coverUrl) ? { src: coverUrl, position: 'top' } : null,
  ].filter((c): c is { src: string; position: string } => c !== null && c.src !== failed);
  const picture = candidates[0];

  if (picture) {
    return (
      <Box
        component="img"
        src={picture.src}
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setFailed(picture.src)}
        data-game-mark={picture.src === iconUrl ? 'icon' : 'cover'}
        sx={{
          width: size,
          height: size,
          objectFit: 'cover',
          objectPosition: picture.position,
          borderRadius: radii.sm,
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
      data-game-mark="initials"
      sx={{
        width: size,
        height: size,
        borderRadius: radii.sm,
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
