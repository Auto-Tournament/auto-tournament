import { useState, type ReactNode, type SyntheticEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import { useTranslation } from 'react-i18next';
import { gameMonogram } from './GameThumb';
import { fontDisplay, mono, tokens, withAlpha } from '../../theme/tokens';
import type { GameSummary } from './gamesApi';

const { color, radius, duration, ease } = tokens;

/** Text for screen readers only. */
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/**
 * How a picture is drawn in the card's 3:4 well.
 *
 * - `cover`: box art (IGDB covers are 3:4). Full bleed; the well has the
 *   cover's own shape, so nothing is cropped.
 * - `photo`: an opaque picture of any other shape (Wikidata sometimes has a
 *   screenshot or a logo on its own background). Drawn whole, over a blurred
 *   copy of itself so the well is filled without cropping or stretching it.
 * - `logo`: a transparent logo (SVG/PNG). Drawn whole on a light plate.
 *   Catalogue logos are made for a white page: on the dark card most of
 *   them (Counter-Strike 2, Valorant, Rocket League, Tekken...) were black on
 *   black and simply not there.
 */
type ArtKind = 'cover' | 'photo' | 'logo';

/** A portrait picture this close to 3:4 is box art and fills the well. */
const COVER_ASPECT_MIN = 0.62;
const COVER_ASPECT_MAX = 0.85;

function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url, window.location.origin).pathname);
  } catch {
    return url;
  }
}

/** The kind is decided from the URL first; `onLoad` can still promote a portrait photo to a cover. */
function guessArtKind(url: string): ArtKind {
  if (/\/t_cover_[a-z_]+\//.test(url)) return 'cover';
  if (/\.(jpe?g|webp|avif)$/i.test(pathOf(url))) return 'photo';
  return 'logo';
}

/**
 * The API hands out small pictures that suit a list row: IGDB's smallest
 * cover (90x128) and Wikimedia files at 128px wide. The card is ~200px wide
 * (400 device pixels on a phone), so it asks for the same image bigger —
 * IGDB's big cover size, Wikimedia at 320px — rather than blowing up the
 * thumbnail.
 */
function cardArtUrl(url: string): string {
  return url
    .replace('/t_cover_small/', '/t_cover_big/')
    .replace(/([?&]width=)128\b/, '$1320');
}

/**
 * A game's catalogue picture filling its (relatively positioned) parent. The
 * parent sets the size and the 3:4 shape; `compact` is for a list-row
 * thumbnail, where the plate padding and the monogram shrink with it.
 */
export function GameArt({ game, compact = false }: { game: GameSummary; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = game.imageUrl && !failed ? cardArtUrl(game.imageUrl) : null;
  const [kind, setKind] = useState<ArtKind>(() => (src ? guessArtKind(src) : 'logo'));

  const well = {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
  } as const;

  const monogramWell = (
    <Box
      aria-hidden
      sx={{
        ...well,
        backgroundColor: color.paper3,
        backgroundImage: `radial-gradient(120% 90% at 50% 0%, ${withAlpha(color.accent, 0.14)}, transparent 70%)`,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontFamily: fontDisplay,
          fontWeight: 700,
          fontSize: compact ? '0.6875rem' : 'clamp(1.5rem, 4vw, 2rem)',
          letterSpacing: '-0.03em',
          color: color.ink2,
        }}
      >
        {gameMonogram(game.name)}
      </Typography>
    </Box>
  );

  if (!src) return monogramWell;

  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
    if (kind === 'photo' && h > 0) {
      const aspect = w / h;
      if (aspect >= COVER_ASPECT_MIN && aspect <= COVER_ASPECT_MAX) setKind('cover');
    }
    setLoaded(true);
  };

  const fadeIn = {
    opacity: loaded ? 1 : 0,
    transition: `opacity ${duration.base}ms ${ease.out}`,
  };

  // A logo's light plate only appears once the logo is there. Before, the
  // plate showed at once, so a slow or blocked image (Wikimedia) left a
  // blank bright rectangle — on a phone, the whole first screen.
  const showPlate = kind === 'logo' && loaded;

  return (
    <Box
      aria-hidden
      sx={{
        ...well,
        bgcolor: showPlate ? color.ink : color.paper3,
        transition: `background-color ${duration.base}ms ${ease.out}`,
        p: kind !== 'logo' ? 0 : compact ? '3px' : { xs: 2, sm: 2.5 },
      }}
    >
      {!loaded && <Box sx={{ position: 'absolute', inset: 0 }}>{monogramWell}</Box>}
      {kind === 'photo' && (
        <Box
          component="img"
          src={src}
          alt=""
          loading="lazy"
          sx={{
            ...fadeIn,
            position: 'absolute',
            inset: '-12%',
            width: '124%',
            height: '124%',
            objectFit: 'cover',
            filter: compact ? 'blur(4px) brightness(0.55)' : 'blur(20px) brightness(0.55)',
          }}
        />
      )}
      <Box
        component="img"
        src={src}
        alt=""
        loading="lazy"
        onLoad={onLoad}
        onError={() => setFailed(true)}
        sx={{
          ...fadeIn,
          position: 'relative',
          display: 'block',
          ...(kind === 'cover'
            ? { width: '100%', height: '100%', objectFit: 'cover' }
            : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }),
        }}
      />
    </Box>
  );
}

/** A round marker in a corner of the well: dark glass, so it reads on a light plate and on box art. */
function Badge({ children, filled, placement }: { children: ReactNode; filled?: boolean; placement: 'start' | 'end' }) {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        top: 8,
        [placement === 'start' ? 'left' : 'right']: 8,
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        bgcolor: filled ? color.accent : withAlpha(color.paper, 0.78),
        color: filled ? color.accentInk : color.accent,
        backdropFilter: filled ? undefined : 'blur(6px)',
        boxShadow: `0 0 0 2px ${withAlpha(color.paper, filled ? 0.9 : 0)}`,
        '& svg': { fontSize: 18 },
      }}
    >
      {children}
    </Box>
  );
}

interface GameCardProps {
  game: GameSummary;
  selected: boolean;
  /** The pick limit is reached: an unpicked card cannot be added, and looks it. */
  locked?: boolean;
  onToggle: (game: GameSummary) => void;
}

/**
 * A selectable card on the "/welcome/games" grid: the game's catalogue art in
 * a 3:4 well, its name and year. Catalogue art (IGDB/Wikidata), not the
 * module tiles — this page is about recognising your own game, and the
 * module tiles answer a different question (see `GameCatalogEntry.icon`).
 *
 * "Tournaments run here" is a trophy badge on the art, explained once by the
 * legend over the grid, instead of the same sentence on every card. Selected
 * is an accent ring plus a check badge — never colour alone — and the card is
 * a real toggle button (`aria-pressed`).
 */
export function GameCard({ game, selected, locked = false, onToggle }: GameCardProps) {
  const { t } = useTranslation();
  const dimmed = locked && !selected;

  return (
    <ButtonBase
      focusRipple
      aria-pressed={selected}
      aria-disabled={dimmed || undefined}
      data-testid={`game-card-${game.slug}`}
      onClick={() => onToggle(game)}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        textAlign: 'left',
        width: '100%',
        minWidth: 0,
        borderRadius: `${radius.md}px`,
        overflow: 'hidden',
        bgcolor: selected ? withAlpha(color.accent, 0.08) : 'background.surface1',
        border: 1,
        borderColor: selected ? color.accent : 'divider',
        boxShadow: selected ? `0 0 0 1px ${color.accent}` : 'none',
        opacity: dimmed ? 0.45 : 1,
        cursor: dimmed ? 'not-allowed' : 'pointer',
        transition: `border-color ${duration.fast}ms ${ease.out}, background-color ${duration.fast}ms ${ease.out}, box-shadow ${duration.fast}ms ${ease.out}`,
        '&:hover': dimmed
          ? {}
          : {
              borderColor: selected ? color.accent : color.muted,
              bgcolor: selected ? withAlpha(color.accent, 0.12) : 'background.surface2',
            },
        '&.Mui-focusVisible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
      }}
    >
      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '3 / 4' }}>
        <GameArt game={game} />
        {game.supported && (
          <Badge placement="start">
            <EmojiEventsRoundedIcon />
          </Badge>
        )}
        {selected && (
          <Badge placement="end" filled>
            <CheckRoundedIcon />
          </Badge>
        )}
      </Box>

      <Box sx={{ px: 1.5, pt: 1.25, pb: 1.5, width: '100%', minWidth: 0 }}>
        <Typography
          variant="body2"
          fontWeight={600}
          title={game.name}
          sx={{
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
          }}
        >
          {game.name}
        </Typography>
        {game.releaseYear && (
          <Typography variant="caption" color="text.secondary" sx={{ ...mono, display: 'block', mt: 0.25 }}>
            {game.releaseYear}
          </Typography>
        )}
        {game.supported && (
          <Box component="span" sx={visuallyHidden}>
            {t('games.welcome.supportedLegend')}
          </Box>
        )}
      </Box>
    </ButtonBase>
  );
}
