/**
 * What starting a CS2 tournament does, and whether the fleet is ready for it
 * (3.0 phase E).
 *
 * This is the body the "Start Tournament" confirmation used to have built in:
 * the checklist of what the start routine does to the servers, and the live
 * count of how many of them can take a match right now. All of it is CS2's —
 * an allocation, an RCON load and a warmup only happen where there is a server
 * — so it moved here whole, copy and fetch unchanged, and an instance whose
 * tournament has no servers gets the core's dialog instead of a fleet report
 * about a fleet it does not have.
 *
 * The English is the literal English this dialog has always shown. It is not
 * translated here for the same reason it was not translated before: changing
 * it is a copy change for every CS2 install, and this PR changes no copy.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { api } from '../../../module-sdk';
import type { TournamentStartConfirmProps } from '../../types';

export const Cs2StartConfirm: React.FC<TournamentStartConfirmProps> = ({ open }) => {
  const [availableServerCount, setAvailableServerCount] = useState<number | null>(null);
  const [onlineServerCount, setOnlineServerCount] = useState<number | null>(null);
  const [busyServerCount, setBusyServerCount] = useState<number | null>(null);
  const [loadingServers, setLoadingServers] = useState(false);

  // Check server availability when the dialog opens.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const loadServerAvailability = async () => {
      try {
        setLoadingServers(true);
        const response = await api.get<{
          success: boolean;
          availableServerCount: number;
          requiredServerCount: number;
          servers: Array<{
            id: string;
            name: string;
            online: boolean;
            allocatable: boolean;
          }>;
        }>('/api/tournament/server-availability');
        if (cancelled) return;
        if (response.success) {
          setAvailableServerCount(response.availableServerCount);
          const online = response.servers.filter((s) => s.online).length;
          const busy = response.servers.filter((s) => s.online && !s.allocatable).length;
          setOnlineServerCount(online);
          setBusyServerCount(busy);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading server availability:', err);
        setAvailableServerCount(null);
        setOnlineServerCount(null);
        setBusyServerCount(null);
      } finally {
        if (!cancelled) setLoadingServers(false);
      }
    };

    void loadServerAvailability();

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <>
      <Typography variant="body2" color="text.secondary" paragraph>
        🚀 Ready to start the tournament?
      </Typography>
      <Typography variant="body2" fontWeight={600} gutterBottom>
        This will:
      </Typography>
      <Box component="ul" sx={{ mt: 0, mb: 2, pl: 2 }}>
        <Typography component="li" variant="body2" color="text.secondary">
          Check all available servers
        </Typography>
        <Typography component="li" variant="body2" color="text.secondary">
          Automatically allocate servers to ready matches
        </Typography>
        <Typography component="li" variant="body2" color="text.secondary">
          Load matches on servers via RCON
        </Typography>
        <Typography component="li" variant="body2" color="text.secondary">
          Set servers to warmup mode
        </Typography>
        <Typography component="li" variant="body2" color="text.secondary">
          Change tournament status to IN PROGRESS
        </Typography>
      </Box>
      {!loadingServers && availableServerCount !== null && availableServerCount === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} gutterBottom>
            ⚠️ No servers are currently available for new matches
          </Typography>
          {onlineServerCount && onlineServerCount > 0 ? (
            <Typography variant="body2">
              All {onlineServerCount} online server
              {onlineServerCount !== 1 ? 's are' : ' is'} currently busy (loading, warmup, live, or
              in cooldown). The tournament will start, and matches will be queued and automatically
              allocated as soon as a server becomes idle.
            </Typography>
          ) : (
            <Typography variant="body2">
              No servers are online or ready right now. The tournament will start, but matches will
              be postponed until a server comes online. The system will automatically allocate
              matches when servers are ready.
            </Typography>
          )}
        </Alert>
      )}
      {!loadingServers && availableServerCount !== null && availableServerCount > 0 && (
        <Typography variant="body2" color="success.main" fontWeight={600} sx={{ mb: 2 }}>
          ✓ {availableServerCount} server{availableServerCount !== 1 ? 's are' : ' is'} currently
          available for new matches
          {busyServerCount && busyServerCount > 0
            ? ` (${busyServerCount} busy running matches or in cooldown)`
            : ''}
        </Typography>
      )}
      {availableServerCount === null && !loadingServers && (
        <Typography variant="body2" color="warning.main" fontWeight={600}>
          Make sure all servers are online and ready before proceeding.
        </Typography>
      )}
    </>
  );
};
