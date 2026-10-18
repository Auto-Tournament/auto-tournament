import { keyframes } from '@emotion/react';
import React from 'react';
import { Box, Typography } from '@mui/material';
import type { MapSide, VetoActionType } from '../cs2.types';
import { tokens, mono, withAlpha, useModuleTranslation } from '../../../module-sdk';

const { color, radius, ease, duration } = tokens;
const pill = `${radius.pill}px`;
const display = 'Sora, Geist, system-ui, sans-serif';

interface VetoMapCardProps {
  mapName: string;
  displayName: string;
  imageUrl: string;
  state: 'available' | 'banned' | 'picked';
  mapNumber?: number; // For picked maps (Map 1, Map 2, etc.)
  side?: MapSide; // For picked maps with side selection
  onClick?: () => void;
  disabled?: boolean;
  /** This card is a choice for the viewer right now (their turn, the map still in the pool). */
  isCurrentTurn?: boolean;
  /** The veto step in progress: the hover says BAN or PICK, and names the button. */
  currentAction?: VetoActionType;
  /** The last map, left over after the bans rather than picked by a team. */
  isDecider?: boolean;
  /** A matchmaking vote: the avatars of who voted for this map (top right). */
  voters?: React.ReactNode;
  /** A matchmaking vote: the viewer's own vote is on this map (outlined). */
  chosen?: boolean;
}

/**
 * One map of the pool (the drafts' veto): its picture and name. On your turn
 * a hover or focus outlines it in the action's colour (ban red, pick green)
 * and shows what a click does, ✕ BAN or ✓ PICK, so nothing is outlined until
 * you point at it. A picked map shows its number and the side you start on.
 */
/** The glow round a map you can click: out and back in, in the action's colour. */
const glow = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 var(--veto-glow); }
  50% { box-shadow: 0 0 0 6px transparent, 0 0 22px 2px var(--veto-glow); }
`;

export const VetoMapCard: React.FC<VetoMapCardProps> = ({
  mapName,
  displayName,
  imageUrl,
  state,
  mapNumber,
  side,
  onClick,
  disabled,
  isCurrentTurn,
  currentAction,
  isDecider,
  voters,
  chosen = false,
}) => {
  const { t } = useModuleTranslation('cs2');
  const isClickable = !disabled && state === 'available' && !!onClick;
  const isInteractive = typeof onClick === 'function';
  const accessibleName =
    state === 'banned'
      ? t('vetoInterface.mapCardAria.banned', { map: displayName })
      : state === 'picked'
        ? t('vetoInterface.mapCardAria.picked', { map: displayName })
        : currentAction === 'pick'
          ? t('vetoInterface.mapCardAria.pick', { map: displayName })
          : currentAction === 'ban'
            ? t('vetoInterface.mapCardAria.ban', { map: displayName })
            : displayName;
  const actionColor = currentAction === 'pick' ? color.pick : color.ban;
  const actionLabel =
    currentAction === 'pick'
      ? t('vetoInterface.actionLabels.pick')
      : t('vetoInterface.actionLabels.ban');

  const body = (
    <>
      <Box
        component="img"
        src={imageUrl}
        alt=""
        loading="lazy"
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: state === 'banned' ? 'grayscale(1) brightness(0.45)' : 'none',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 1.5,
          background: `linear-gradient(to top, ${withAlpha(color.paper, 0.85)}, ${withAlpha(color.paper, 0)} 55%)`,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
          {state === 'picked' && mapNumber ? (
            <Box
              component="span"
              sx={{
                ...mono,
                px: 1,
                py: 0.25,
                borderRadius: pill,
                bgcolor: color.pick,
                color: color.accentInk,
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              {t('vetoInterface.mapBadge', { n: mapNumber })}
            </Box>
          ) : (
            <span />
          )}
          {voters}
          {state === 'picked' && side && (
            <Box
              component="span"
              data-testid="team-side-badge"
              sx={{
                px: 1,
                py: 0.25,
                borderRadius: pill,
                bgcolor: side === 'CT' ? color.sideCt : color.sideT,
                color: color.accentInk,
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              {side}
            </Box>
          )}
        </Box>
        <Box>
          <Typography
            sx={{
              fontFamily: display,
              fontSize: '1.25rem',
              fontWeight: 700,
              color: state === 'banned' ? color.ban : color.ink,
            }}
          >
            {displayName}
          </Typography>
          {isDecider && (
            <Typography
              data-testid="veto-decider-label"
              sx={{ fontSize: '0.8125rem', color: color.ink2 }}
            >
              {t('vetoInterface.decider')}
            </Typography>
          )}
        </Box>
      </Box>
      {isCurrentTurn && state === 'available' && (
        <Box
          className="veto-hover-action"
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            bgcolor: withAlpha(color.paper, 0.62),
            color: actionColor,
            opacity: 0,
            transition: `opacity ${duration.fast}ms ${ease.out}`,
            pointerEvents: 'none',
            // Touch screens have no hover: the label shows at rest, in the corner.
            '@media (hover: none)': {
              opacity: 1,
              bgcolor: withAlpha(color.paper, 0.3),
              alignItems: 'flex-end',
              justifyContent: 'flex-start',
              p: 1.5,
              '& svg': { display: 'none' },
            },
          }}
        >
          <svg
            width={44}
            height={44}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {currentAction === 'pick' ? (
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            ) : (
              <path d="M6 6l12 12M18 6L6 18" />
            )}
          </svg>
          <Typography
            component="span"
            sx={{
              fontFamily: display,
              fontSize: '1.375rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
            }}
          >
            {actionLabel}
          </Typography>
        </Box>
      )}
    </>
  );

  return (
    <Box
      data-testid={`veto-map-card-${mapName}`}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        aspectRatio: '16 / 9',
        maxWidth: '100%',
        borderRadius: `${radius.md}px`,
        border: `2px solid ${state === 'picked' ? color.pick : chosen ? actionColor : 'transparent'}`,
        bgcolor: color.paper3,
        transition: `transform ${duration.base}ms ${ease.out}, border-color ${duration.fast}ms ${ease.out}`,
        ...(isClickable
          ? {
              // Yours to click: a slow glow in the action's colour, so the pool asks for a click.
              '@media (prefers-reduced-motion: no-preference)': {
                animation: `${glow} 1.8s ease-in-out infinite`,
                '--veto-glow': withAlpha(actionColor, 0.55),
              },
              '&:hover, &:focus-within': { borderColor: actionColor, animation: 'none' },
              '&:hover .veto-hover-action, &:focus-within .veto-hover-action': { opacity: 1 },
              '@media (hover: hover) and (prefers-reduced-motion: no-preference)': {
                '&:hover': { transform: 'translateY(-3px)' },
              },
            }
          : {}),
      }}
    >
      {isInteractive ? (
        <Box
          component="button"
          type="button"
          data-testid={`veto-map-button-${mapName}`}
          aria-label={accessibleName}
          aria-disabled={!isClickable}
          onClick={isClickable ? onClick : undefined}
          sx={{
            all: 'unset',
            position: 'absolute',
            inset: 0,
            cursor: isClickable ? 'pointer' : 'default',
            '&:focus-visible': {
              outline: `2px solid ${color.focus}`,
              outlineOffset: -4,
              borderRadius: `${radius.md}px`,
            },
          }}
        >
          {body}
        </Box>
      ) : (
        body
      )}
    </Box>
  );
};
