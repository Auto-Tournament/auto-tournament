import React, { useEffect, useState } from 'react';
import { Box, Typography, Chip, LinearProgress, Paper, Stack, Tooltip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import type { ServerAllocationInfo } from '../../types';

interface ServerAllocationWidgetProps {
  servers: ServerAllocationInfo[];
  gracePeriodSeconds: number;
  requiredServerCount?: number;
}

export const ServerAllocationWidget: React.FC<ServerAllocationWidgetProps> = ({
  servers,
  gracePeriodSeconds,
  requiredServerCount = 0,
}) => {
  // Initialize local countdowns from server data using useMemo to avoid setState in effect
  const initialCountdowns = React.useMemo(() => {
    const countdowns = new Map<string, number>();
    servers.forEach((server) => {
      if (server.secondsUntilReady !== null && server.secondsUntilReady > 0) {
        countdowns.set(server.id, server.secondsUntilReady);
      }
    });
    return countdowns;
  }, [servers]);

  const [localCountdowns, setLocalCountdowns] = useState<Map<string, number>>(initialCountdowns);

  // Update countdowns when servers change
  useEffect(() => {
    setLocalCountdowns(initialCountdowns);
  }, [initialCountdowns]);

  // Local per-second countdown ticker
  useEffect(() => {
    if (localCountdowns.size === 0) return;

    const timer = setInterval(() => {
      setLocalCountdowns((prev) => {
        const next = new Map(prev);
        let hasChanges = false;
        next.forEach((value, key) => {
          if (value > 0) {
            next.set(key, value - 1);
            hasChanges = true;
          } else {
            next.delete(key);
            hasChanges = true;
          }
        });
        return hasChanges ? next : prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [localCountdowns.size]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const availableServers = servers.filter((s) => s.allocatable);
  const busyServers = servers.filter((s) => s.online && !s.allocatable && !s.inGraceWindow);
  const coolingServers = servers.filter((s) => s.inGraceWindow);
  const offlineServers = servers.filter((s) => !s.online);

  const getServerIcon = (server: ServerAllocationInfo) => {
    if (!server.online) return <CloudOffIcon fontSize="small" />;
    if (server.allocatable) return <CheckCircleIcon fontSize="small" />;
    if (server.inGraceWindow) return <HourglassEmptyIcon fontSize="small" />;
    return <SportsEsportsIcon fontSize="small" />;
  };

  const getServerColor = (server: ServerAllocationInfo) => {
    if (!server.online) return 'default';
    if (server.allocatable) return 'success';
    if (server.inGraceWindow) return 'warning';
    return 'error';
  };

  const getServerLabel = (server: ServerAllocationInfo) => {
    const countdown = localCountdowns.get(server.id);
    if (countdown !== undefined && countdown > 0) {
      return `${server.name} (${formatTime(countdown)})`;
    }
    if (server.matchNumber !== null) {
      return `${server.name} (Match #${server.matchNumber})`;
    }
    return server.name;
  };

  return (
    <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
      <Box mb={2}>
        <Typography variant="h6" gutterBottom>
          Server Allocation Status
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="body2" color="text.secondary">
            Available: <strong>{availableServers.length}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Busy: <strong>{busyServers.length}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Cooling: <strong>{coolingServers.length}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Offline: <strong>{offlineServers.length}</strong>
          </Typography>
          {requiredServerCount > 0 && (
            <Typography variant="body2" color="warning.main" fontWeight={600}>
              Waiting: <strong>{requiredServerCount}</strong> match{requiredServerCount !== 1 ? 'es' : ''}
            </Typography>
          )}
        </Stack>
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
        {servers.map((server) => {
          const countdown = localCountdowns.get(server.id);
          const progress =
            countdown !== undefined && countdown > 0
              ? ((gracePeriodSeconds - countdown) / gracePeriodSeconds) * 100
              : 0;

          return (
            <Tooltip
              key={server.id}
              title={
                <Box>
                  <Typography variant="caption" display="block">
                    Status: {server.online ? (server.allocatable ? 'Ready' : server.inGraceWindow ? 'Cooling' : 'Busy') : 'Offline'}
                  </Typography>
                  {server.matchNumber !== null && (
                    <Typography variant="caption" display="block">
                      Match: #{server.matchNumber}
                      {server.matchRound === 0 && ' (Manual)'}
                    </Typography>
                  )}
                  {countdown !== undefined && countdown > 0 && (
                    <Typography variant="caption" display="block">
                      Ready in: {formatTime(countdown)}
                    </Typography>
                  )}
                </Box>
              }
              arrow
            >
              <Box sx={{ position: 'relative', display: 'inline-block' }}>
                <Chip
                  icon={getServerIcon(server)}
                  label={getServerLabel(server)}
                  color={getServerColor(server)}
                  size="small"
                  variant={server.allocatable ? 'filled' : 'outlined'}
                />
                {countdown !== undefined && countdown > 0 && (
                  <LinearProgress
                    variant="determinate"
                    value={progress}
                    sx={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 2,
                      borderBottomLeftRadius: 16,
                      borderBottomRightRadius: 16,
                    }}
                  />
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Stack>
    </Paper>
  );
};
