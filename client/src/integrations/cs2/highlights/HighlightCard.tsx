import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase } from '@mui/material';
import { PlayIcon, StarIcon } from '@phosphor-icons/react';
import { mono, radii, textSize, tokens, useModuleTranslation, withAlpha } from '../../../module-sdk';
import { clock, isBigPlay, kindLabel, type ClipMarkers } from './data';

/**
 * A still of a video: the browser's own frame at `at` seconds (the moment
 * the slow motion starts, for a clip), so no thumbnail has to be made.
 */
export function VideoThumb({ src, at = 1.5, alt = '' }: { src: string; at?: number; alt?: string }) {
  return (
    <Box
      component="video"
      src={`${src}#t=${at.toFixed(2)}`}
      muted
      playsInline
      preload="metadata"
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      tabIndex={-1}
      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
    />
  );
}

/** Where a clip's still is taken: as the slow motion starts, else a second and a half in. */
export const thumbAt = (markers: ClipMarkers | null | undefined) => markers?.slowmo?.[0] ?? 1.5;

/** A small badge over a still: ACE and 4K in the accent, the rest quiet. */
export function KindBadge({ kind, clutch, label }: { kind: string; clutch: boolean; label?: string }) {
  const { t } = useModuleTranslation('cs2');
  const big = isBigPlay(kind);
  return (
    <Box
      component="span"
      sx={{
        position: 'absolute',
        top: 8,
        left: 8,
        px: 1,
        py: 0.375,
        borderRadius: radii.pill,
        fontSize: '0.6875rem',
        fontWeight: big ? 700 : 600,
        letterSpacing: '0.02em',
        bgcolor: big ? tokens.color.accent : 'rgba(16,9,8,0.8)',
        color: big ? tokens.color.accentInk : tokens.color.ink,
        pointerEvents: 'none',
      }}
    >
      {label ?? kindLabel(t, kind, clutch)}
    </Box>
  );
}

export interface HighlightCardProps {
  to: string;
  video: string | null;
  markers?: ClipMarkers | null;
  title: string;
  sub: ReactNode;
  badge?: ReactNode;
  /** Large: the profile's favourite. */
  large?: boolean;
  /** The video's length, bottom right of the still. */
  duration?: number | null;
  /** Shown instead of the still while it is not recorded. */
  waiting?: string;
  /** The player's own clip: a star to make it their favourite. */
  favourite?: { on: boolean; onToggle: () => void };
  testId?: string;
}

/** A highlight or reel: its still, a badge, a play button on hover, and two lines under it. */
export function HighlightCard({ to, video, markers, title, sub, badge, large, duration, waiting, favourite, testId }: HighlightCardProps) {
  const { t } = useModuleTranslation('cs2');
  const still = (
    <Box sx={{ position: 'relative', aspectRatio: '16 / 9', bgcolor: tokens.color.paper3, overflow: 'hidden' }}>
      {video ? (
        <VideoThumb src={video} at={thumbAt(markers)} />
      ) : (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: tokens.color.muted, fontSize: textSize.sm }}>
          {waiting}
        </Box>
      )}
      {video && (
        <Box
          className="hl-play"
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: large ? 72 : 48,
            height: large ? 72 : 48,
            transform: 'translate(-50%, -50%)',
            borderRadius: radii.pill,
            bgcolor: large ? tokens.color.accent : withAlpha(tokens.color.paper, 0.75),
            color: large ? tokens.color.accentInk : tokens.color.ink,
            display: 'grid',
            placeItems: 'center',
            opacity: large ? 1 : 0,
            transition: 'opacity 150ms, transform 150ms',
          }}
        >
          <PlayIcon size={large ? 26 : 18} weight="fill" />
        </Box>
      )}
      {badge}
      {duration ? (
        <Box
          component="span"
          sx={{ position: 'absolute', right: 8, bottom: 8, px: 0.75, py: 0.25, borderRadius: 1, bgcolor: 'rgba(16,9,8,0.8)', ...mono, fontSize: '0.75rem', color: tokens.color.ink2 }}
        >
          {clock(duration)}
        </Box>
      ) : null}
    </Box>
  );

  return (
    <Box
      data-testid={testId}
      sx={{
        position: 'relative',
        borderRadius: large ? '22px' : '16px',
        overflow: 'hidden',
        bgcolor: tokens.color.paper2,
        border: `1px solid ${tokens.color.rule}`,
        transition: 'border-color 150ms',
        '&:hover': { borderColor: tokens.color.ink2 },
        '&:hover .hl-play, &:focus-within .hl-play': { opacity: 1 },
      }}
    >
      <Box
        component={video ? RouterLink : 'div'}
        {...(video ? { to } : {})}
        sx={{
          display: 'block',
          color: 'inherit',
          textDecoration: 'none',
          '&:focus-visible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: -2 },
        }}
      >
        {still}
        <Box sx={{ px: large ? 2.5 : 1.5, py: large ? 1.75 : 1.25, display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
          <Box sx={{ fontWeight: 600, fontSize: large ? '1.125rem' : textSize.sm, overflowWrap: 'anywhere' }}>{title}</Box>
          <Box sx={{ fontSize: '0.75rem', color: tokens.color.muted, overflowWrap: 'anywhere' }}>{sub}</Box>
        </Box>
      </Box>
      {favourite && (
        <ButtonBase
          onClick={favourite.onToggle}
          aria-pressed={favourite.on}
          aria-label={t(favourite.on ? 'highlights.unfavourite' : 'highlights.makeFavourite')}
          title={t(favourite.on ? 'highlights.unfavourite' : 'highlights.makeFavourite')}
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 36,
            height: 36,
            borderRadius: radii.pill,
            bgcolor: 'rgba(16,9,8,0.75)',
            color: favourite.on ? tokens.color.medalGold : tokens.color.ink,
            '&:hover': { bgcolor: 'rgba(16,9,8,0.92)' },
            '&.Mui-focusVisible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2 },
          }}
        >
          <StarIcon size={18} weight={favourite.on ? 'fill' : 'regular'} />
        </ButtonBase>
      )}
    </Box>
  );
}

/** "Favourite" chip over the profile's lead clip. */
export function FavouriteChip() {
  const { t } = useModuleTranslation('cs2');
  return (
    <Box
      component="span"
      sx={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.25,
        py: 0.5,
        borderRadius: radii.pill,
        bgcolor: 'rgba(16,9,8,0.8)',
        color: tokens.color.medalGold,
        fontSize: '0.75rem',
        fontWeight: 600,
        pointerEvents: 'none',
      }}
    >
      <StarIcon size={12} weight="fill" />
      {t('highlights.favourite')}
    </Box>
  );
}
