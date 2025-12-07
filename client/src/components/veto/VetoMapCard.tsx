import React from 'react';
import { Card, CardContent, CardMedia, Typography, Box, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import type { MapSide } from '../../types';

interface VetoMapCardProps {
  mapName: string;
  displayName: string;
  imageUrl: string;
  state: 'available' | 'banned' | 'picked';
  mapNumber?: number; // For picked maps (Map 1, Map 2, etc.)
  side?: MapSide; // For picked maps with side selection
  onClick?: () => void;
  disabled?: boolean;
}

export const VetoMapCard: React.FC<VetoMapCardProps> = ({
  _mapName,
  displayName,
  imageUrl,
  state,
  mapNumber,
  side,
  onClick,
  disabled,
}) => {
  const [imageError, setImageError] = React.useState(false);
  const isClickable = !disabled && state === 'available' && onClick;

  return (
    <Card
      data-testid={`veto-map-card-${_mapName}`}
      sx={{
        position: 'relative',
        cursor: isClickable ? 'pointer' : 'default',
        opacity: state === 'banned' ? 0.5 : 1,
        border: state === 'picked' ? 3 : 1,
        borderColor: state === 'picked' ? 'success.main' : 'divider',
        transition: 'all 0.3s ease',
        transform: isClickable ? 'scale(1)' : 'scale(1)',
        '&:hover': isClickable
          ? {
              transform: 'scale(1.05)',
              boxShadow: 6,
              borderColor: 'primary.main',
            }
          : {},
      }}
      onClick={isClickable ? onClick : undefined}
    >
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
            label={`MAP ${mapNumber}`}
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
            sx={{
              fontWeight: 700,
              bgcolor: side === 'CT' ? 'info.main' : 'warning.main',
              color: 'white',
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
        <CardMedia
          component="img"
          height="140"
          image={imageUrl}
          alt={displayName}
          sx={{
            objectFit: 'cover',
            filter: state === 'banned' ? 'grayscale(100%)' : 'none',
          }}
          onError={() => {
            // Hide image and use colored background instead
            setImageError(true);
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
    </Card>
  );
};

