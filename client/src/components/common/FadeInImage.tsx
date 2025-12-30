import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

interface FadeInImageProps {
  src: string;
  alt: string;
  /**
   * Optional explicit height/width; otherwise the container should control size.
   */
  height?: number | string;
  width?: number | string;
  /**
   * Additional styles applied to the outer container.
   */
  sx?: SxProps<Theme>;
  /**
   * Optional children rendered on top of the image (e.g., labels, gradients).
   */
  children?: React.ReactNode;
}

export const FadeInImage: React.FC<FadeInImageProps> = ({
  src,
  alt,
  height,
  width,
  sx,
  children,
}) => {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);

  return (
    <Box
      sx={[
        (theme) => ({
          position: 'relative',
          overflow: 'hidden',
          height,
          width,
          background: `linear-gradient(135deg, ${theme.palette.background.default}, ${theme.palette.background.paper})`,
        }),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {!error && (
        <Box
          component="img"
          src={src}
          alt={alt}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.6s ease-in-out',
          }}
        />
      )}

      {/* Overlay content (labels, gradients, etc.) */}
      {children && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
          }}
        >
          {children}
        </Box>
      )}
    </Box>
  );
};
