import React from 'react';
import { Box, Card, CardContent, Typography, Chip, IconButton, Tooltip } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import SettingsIcon from '@mui/icons-material/Settings';
import type { Team } from '../../types';

interface TeamHeaderProps {
  team: Team | null;
  isMuted: boolean;
  onToggleMute: () => void;
  onToggleSettings: () => void;
}

export function TeamHeader({ team, isMuted, onToggleMute, onToggleSettings }: TeamHeaderProps) {
  return (
    <Card
      sx={{
        background:
          'linear-gradient(135deg, rgba(103, 80, 164, 0.1) 0%, rgba(103, 80, 164, 0.05) 100%)',
      }}
    >
      <CardContent sx={{ py: 4 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box flex={1} textAlign="center">
            <Typography variant="h3" fontWeight={700} gutterBottom>
              {team?.name}
            </Typography>
            {team?.tag && (
              <Chip label={team.tag} size="medium" sx={{ fontSize: '1rem', fontWeight: 600 }} />
            )}
          </Box>
          <Box display="flex" gap={1}>
            <Tooltip title="Sound settings">
              <IconButton onClick={onToggleSettings} color="primary">
                <SettingsIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={isMuted ? 'Unmute notifications' : 'Mute notifications'}>
              <IconButton onClick={onToggleMute} color={isMuted ? 'default' : 'primary'}>
                {isMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
