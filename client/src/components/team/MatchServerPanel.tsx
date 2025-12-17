import React from 'react';
import { Box, Button, Typography, Alert } from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { TeamMatchInfo } from '../../types';
import type { CS2MapData } from '../../constants/maps';
import { FadeInImage } from '../common/FadeInImage';

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
      <Alert severity="info">
        <Typography variant="body2" fontWeight={600} gutterBottom>
          ⏳ Waiting for Server Assignment
        </Typography>
        <Typography variant="body2">
          A server will be automatically assigned shortly. This page will update automatically when the server is ready.
        </Typography>
      </Alert>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {currentMapData && (
        <FadeInImage
          src={currentMapData.image}
          alt={currentMapData.displayName}
          height={180}
          sx={{
            borderRadius: 2,
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
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
        </FadeInImage>
      )}

      <Box display="flex" flexDirection="column" gap={2}>
        {/* Server info */}
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Server: {server.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" fontFamily="monospace">
            {server.host}:{server.port}
          </Typography>
          {server.status && (
            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
              Status: {server.statusDescription?.label || server.status}
            </Typography>
          )}
        </Box>

        <Button
          variant="contained"
          size="large"
          fullWidth
          color={connected ? 'success' : 'primary'}
          startIcon={<SportsEsportsIcon />}
          onClick={onConnect}
          disabled={!server.host || !server.port} // Disable if server details missing
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
          disabled={!server.host || !server.port} // Disable if server details missing
        >
          {copied ? '✓ Copied!' : 'Copy Console Command'}
        </Button>
      </Box>
    </Box>
  );
}

