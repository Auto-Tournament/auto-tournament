import React, { useEffect, useState } from 'react';
import { Box, Typography, Chip, LinearProgress, Paper, Stack, Tooltip } from '@mui/material';
import {
  CheckCircleIcon,
  CloudSlashIcon,
  GameControllerIcon,
  HourglassIcon,
} from '@phosphor-icons/react';
import { getBracketMatchLabel, useModuleTranslation } from '../../../module-sdk';
import type { MatchAllocationPanelProps } from '../../types';
import type { ServerAllocationInfo } from '../cs2.types';
import { useServerAvailability } from './useServerAvailability';

/**
 * The admin match list's server panel (`matchPanels.adminView`). It asks the
 * fleet itself, on the match list's 5-second cadence, and shows nothing until
 * there is at least one server to show.
 */
export const ServerAllocationWidget: React.FC<MatchAllocationPanelProps> = () => {
  const { availability } = useServerAvailability(5000);
  if (!availability || availability.servers.length === 0) return null;
  return (
    <ServerAllocationPanel
      servers={availability.servers}
      gracePeriodSeconds={availability.gracePeriodSeconds}
      requiredServerCount={availability.requiredServerCount}
    />
  );
};

interface ServerAllocationPanelProps {
  servers: ServerAllocationInfo[];
  gracePeriodSeconds: number;
  requiredServerCount?: number;
}

const ServerAllocationPanel: React.FC<ServerAllocationPanelProps> = ({
  servers,
  gracePeriodSeconds,
  requiredServerCount = 0,
}) => {
  const { t } = useModuleTranslation('cs2');
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
    if (!server.online) return <CloudSlashIcon size={20} />;
    if (server.allocatable) return <CheckCircleIcon size={20} />;
    if (server.inGraceWindow) return <HourglassIcon size={20} />;
    return <GameControllerIcon size={20} />;
  };

  const getServerColor = (server: ServerAllocationInfo) => {
    if (!server.online) return 'default';
    if (server.allocatable) return 'success';
    if (server.inGraceWindow) return 'warning';
    return 'error';
  };

  // "UB R1 M1" / "Grand Final" for double elimination; the raw match_number
  // alone said "Match #1" for the grand final.
  const serverMatchLabel = (server: ServerAllocationInfo) =>
    (server.matchSlug &&
      server.matchRound !== null &&
      getBracketMatchLabel({
        slug: server.matchSlug,
        bracket: server.matchBracket,
        round: server.matchRound,
        matchNumber: server.matchNumber ?? 0,
      })) ||
    t('matchesPage.card.matchNumber', { number: server.matchNumber });

  const getServerLabel = (server: ServerAllocationInfo) => {
    const countdown = localCountdowns.get(server.id);
    if (countdown !== undefined && countdown > 0) {
      return `${server.name} (${formatTime(countdown)})`;
    }
    if (server.matchNumber !== null) {
      return `${server.name} (${serverMatchLabel(server)})`;
    }
    return server.name;
  };

  return (
    <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
      <Box mb={2}>
        <Typography variant="h6" gutterBottom>
          {t('matchesPage.allocationWidget.title')}
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="body2" color="text.secondary">
            {t('matchesPage.allocationWidget.available')} <strong>{availableServers.length}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('matchesPage.allocationWidget.busy')} <strong>{busyServers.length}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('matchesPage.allocationWidget.cooling')} <strong>{coolingServers.length}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('matchesPage.allocationWidget.offline')} <strong>{offlineServers.length}</strong>
          </Typography>
          {requiredServerCount > 0 && (
            <Typography variant="body2" color="warning.main" fontWeight={600}>
              {t('matchesPage.allocationWidget.waitingMatches', { count: requiredServerCount })}
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
                    {t('matchesPage.allocationWidget.statusLine', {
                      status: server.online
                        ? server.allocatable
                          ? t('matchesPage.allocationWidget.statusReady')
                          : server.inGraceWindow
                            ? t('matchesPage.allocationWidget.statusCooling')
                            : t('matchesPage.allocationWidget.statusBusy')
                        : t('matchesPage.allocationWidget.statusOffline'),
                    })}
                  </Typography>
                  {server.matchNumber !== null && (
                    <Typography variant="caption" display="block">
                      {serverMatchLabel(server)}
                      {server.matchRound === 0 && ` (${t('matchesPage.card.manual')})`}
                    </Typography>
                  )}
                  {countdown !== undefined && countdown > 0 && (
                    <Typography variant="caption" display="block">
                      {t('matchesPage.allocationWidget.readyIn', { time: formatTime(countdown) })}
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
