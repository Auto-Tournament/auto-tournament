import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardActionArea, CardContent, Typography, Box, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import type { MapSide, VetoActionType } from '../../types';
import { FadeInImage } from '../common/FadeInImage';

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
              fontWeight: 700,
              bgcolor: 'success.main',
              color: 'success.contrastText',
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
            sx={(theme) => {
              const bgColor =
                side === 'CT' ? theme.palette.info.main : theme.palette.warning.main;
              return {
                fontWeight: 700,
                bgcolor: bgColor,
                color: theme.palette.getContrastText(bgColor),
              };
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
            bgcolor: 'rgba(0, 0, 0, 0.7)',
            zIndex: 1,
          }}
        >
          <BlockIcon sx={{ fontSize: 60, color: 'error.main' }} />
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
          <CheckCircleIcon sx={{ fontSize: 32, color: 'success.main' }} />
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
            bgcolor: state === 'banned' ? 'background.paper' : 'primary.dark',
            filter: state === 'banned' ? 'grayscale(100%)' : 'none',
          }}
        >
          <Typography variant="h4" fontWeight={700} color="white">
            {displayName}
          </Typography>
        </Box>
      )}

      <CardContent
        sx={{
          py: 1.5,
          px: 2,
          bgcolor: state === 'picked' ? 'success.dark' : 'background.paper',
        }}
      >
        <Typography
          variant="h6"
          fontWeight={700}
          textAlign="center"
          sx={{
            color: state === 'picked' ? 'success.contrastText' : 'text.primary',
          }}
        >
          {displayName}
        </Typography>
      </CardContent>
    </>
  );

  return (
    <Card
      data-testid={`veto-map-card-${mapName}`}
      sx={{
        position: 'relative',
        cursor: isClickable ? 'pointer' : 'default',
        opacity: state === 'banned' ? 0.5 : 1,
        border: state === 'picked' ? 3 : isCurrentTurn ? 2 : 1,
        borderColor:
          state === 'picked'
            ? 'success.main'
            : isCurrentTurn
            ? 'warning.main'
            : 'divider',
        boxShadow: isCurrentTurn ? 6 : 1,
        transition: 'all 0.25s ease',
        transform: 'scale(1)',
        '&:hover': isClickable
          ? {
              transform: 'scale(1.05)',
              boxShadow: 8,
              borderColor: isCurrentTurn ? 'warning.light' : 'primary.main',
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
