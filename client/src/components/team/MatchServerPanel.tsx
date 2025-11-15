import React from 'react';
import { Box, Button, Stack, Typography, Alert } from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { TeamMatchInfo } from '../../types';
import type { CS2MapData } from '../../constants/maps';

interface MatchServerPanelProps {
  server: TeamMatchInfo['server'];
  currentMapData: CS2MapData | null;
  connected: boolean;
  copied: boolean;
  onConnect: () => void;
  onCopy: () => void;
}

export function MatchServerPanel({
  server,
  currentMapData,
  connected,
  copied,
  onConnect,
  onCopy,
}: MatchServerPanelProps) {
  if (!server) {
    return (
      <Alert severity="info" sx={{ mb: 3 }}>
        Server will be assigned when the match is ready. Please check back soon.
      </Alert>
    );
  }

  return (
    <>
      {currentMapData && (
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: 180,
            mb: 2,
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Box
            component="img"
            src={currentMapData.image}
            alt={currentMapData.displayName}
            sx={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: 'brightness(0.4)',
            }}
          />
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
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.5))',
            }}
          >
            <Typography
              variant="h3"
              sx={{
                fontWeight: 700,
                color: 'white',
                textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
              }}
            >
              {currentMapData.displayName}
            </Typography>
          </Box>
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              right: 12,
              textAlign: 'right',
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: 'rgba(255, 255, 255, 0.6)',
                fontSize: '0.7rem',
                display: 'block',
                textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
              }}
            >
              {server.name}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: 'rgba(255, 255, 255, 0.6)',
                fontSize: '0.7rem',
                fontFamily: 'monospace',
                textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
              }}
            >
              {server.host}:{server.port}
            </Typography>
          </Box>
        </Box>
      )}

      <Stack spacing={2} mb={3}>
        <Button
          variant="contained"
          size="large"
          fullWidth
          color={connected ? 'success' : 'primary'}
          startIcon={<SportsEsportsIcon />}
          onClick={onConnect}
          sx={{ py: 1.5 }}
        >
          {connected ? '✓ Connecting...' : 'Connect to Server'}
        </Button>

        <Button
          variant="outlined"
          size="small"
          fullWidth
          startIcon={copied ? null : <ContentCopyIcon />}
          onClick={onCopy}
        >
          {copied ? '✓ Copied!' : 'Copy Console Command'}
        </Button>
      </Stack>
    </>
  );
}

