import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardActionArea, CardContent, Typography, Box, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import type { MapSide, VetoActionType } from '../../types';
import { FadeInImage } from '../common/FadeInImage';
import { tokens, mono, withAlpha } from '../../theme/tokens';

const { color, radius, ease, duration } = tokens;

interface VetoMapCardProps {
  mapName: string;
  displayName: string;
  imageUrl: string;
  state: 'available' | 'banned' | 'picked';
  mapNumber?: number; // For picked maps (Map 1, Map 2, etc.)
  side?: MapSide; // For picked maps with side selection
  onClick?: () => void;
  disabled?: boolean;
  /**
   * When true, this card is the primary actionable choice for the current team
   * (e.g. it is their turn and the map is available). Used to visually
   * highlight "click me now" maps during the veto phase.
   */
  isCurrentTurn?: boolean;
  /**
   * The veto step currently in progress. Used for the tile's accessible name
   * ("Ban Mirage" / "Pick Mirage").
   */
  currentAction?: VetoActionType;
  /** The last map, left over after the bans rather than picked by a team. */
  isDecider?: boolean;
}

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
}) => {
  const { t } = useTranslation();
  const [imageError] = React.useState(false);
  const isClickable = !disabled && state === 'available' && !!onClick;
  // Tiles in the live veto grid (the ones given an onClick) are real buttons,
  // so keyboard and screen-reader users can reach and operate them. A tile that
  // can't be chosen right now stays focusable and says so via aria-disabled.
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

  const content = (
    <>
      {/* Map Number Badge (for picked maps) */}
      {state === 'picked' && mapNumber && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 2,
          }}
        >
          <Chip
            label={t('vetoInterface.mapBadge', { n: mapNumber })}
            color="success"
            size="small"
            sx={{
              ...mono,
              fontWeight: 600,
              bgcolor: color.pick,
              color: color.accentInk,
            }}
          />
        </Box>
      )}

      {/* Side Badge (for picked maps with side) */}
      {state === 'picked' && side && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 2,
          }}
        >
          <Chip
            data-testid="team-side-badge"
            label={side}
            color="primary"
            size="small"
            sx={{
              fontWeight: 600,
              bgcolor: side === 'CT' ? color.sideCt : color.sideT,
              color: color.accentInk,
            }}
          />
        </Box>
      )}

      {/* Banned Overlay */}
      {state === 'banned' && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: color.scrim,
            zIndex: 1,
          }}
        >
          <BlockIcon sx={{ fontSize: 44, color: color.ban }} />
        </Box>
      )}

      {/* Picked Checkmark */}
      {state === 'picked' && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            zIndex: 2,
          }}
        >
          <CheckCircleIcon sx={{ fontSize: 28, color: color.pick }} />
        </Box>
      )}

      {!imageError ? (
        <FadeInImage
          src={imageUrl}
          alt={displayName}
          height={140}
          sx={{
            filter: state === 'banned' ? 'grayscale(100%)' : 'none',
          }}
        />
      ) : (
        <Box
          sx={{
            height: 140,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: color.paper3,
            filter: state === 'banned' ? 'grayscale(100%)' : 'none',
          }}
        >
          <Typography variant="h4" fontWeight={700} color="text.primary">
            {displayName}
          </Typography>
        </Box>
      )}

      <CardContent
        sx={{
          py: 1.25,
          px: 1.75,
          '&:last-child': { pb: 1.25 },
          bgcolor: color.paper3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Typography
          variant="subtitle1"
          component="span"
          sx={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: state === 'banned' ? color.ban : state === 'picked' ? color.pick : color.ink,
            textDecoration: state === 'banned' ? 'line-through' : 'none',
            textDecorationThickness: '2px',
            transition: `color ${duration.base}ms ${ease.out}`,
          }}
        >
          {displayName}
        </Typography>
        {state === 'picked' && isDecider && (
          <Box
            component="span"
            data-testid="veto-decider-label"
            sx={{ ...mono, fontSize: '0.75rem', color: color.pick, whiteSpace: 'nowrap' }}
          >
            {t('vetoInterface.decider')}
          </Box>
        )}
      </CardContent>
    </>
  );

  return (
    <Card
      data-testid={`veto-map-card-${mapName}`}
      sx={{
        position: 'relative',
        cursor: isClickable ? 'pointer' : 'default',
        borderRadius: `${radius.md}px`,
        // Banned tiles dim the image (scrim overlay) but keep the red name readable.
        border: 1,
        borderColor: state === 'picked' ? color.pick : isCurrentTurn ? color.accent : color.rule,
        boxShadow:
          state === 'picked'
            ? `0 0 0 1px ${color.pick}`
            : isCurrentTurn
            ? `0 0 0 1px ${withAlpha(color.accent, 0.5)}`
            : 'none',
        transition: `box-shadow ${duration.base}ms ${ease.out}, border-color ${duration.base}ms ${ease.out}`,
        '&:hover': isClickable
          ? {
              boxShadow: `0 0 0 1px ${color.accent}`,
            }
          : {},
      }}
    >
      {isInteractive ? (
        <CardActionArea
          data-testid={`veto-map-button-${mapName}`}
          aria-label={accessibleName}
          aria-disabled={!isClickable}
          onClick={isClickable ? onClick : undefined}
          disableRipple={!isClickable}
          sx={{
            cursor: 'inherit',
            // Keep the tile looking as it did: no grey wash on mouse hover.
            // The highlight overlay only appears for keyboard focus.
            '&:hover .MuiCardActionArea-focusHighlight': { opacity: 0 },
            '&.Mui-focusVisible .MuiCardActionArea-focusHighlight': { opacity: 0.12 },
          }}
        >
          {content}
        </CardActionArea>
      ) : (
        content
      )}
    </Card>
  );
};
