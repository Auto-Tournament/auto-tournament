import React, { useState, useEffect, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { Box, Button, Card, CardContent, Typography, Grid, Chip, CircularProgress, IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StorageIcon from '@mui/icons-material/Storage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RefreshIcon from '@mui/icons-material/Refresh';
import BlockIcon from '@mui/icons-material/Block';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import UpdateIcon from '@mui/icons-material/Update';
import DnsIcon from '@mui/icons-material/Dns';
import ReplayIcon from '@mui/icons-material/Replay';
import { api } from '../utils/api';
import ServerModal from '../components/modals/ServerModal';
import BatchServerModal from '../components/modals/BatchServerModal';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import type { Match, Server, ServersResponse, ServerStatusResponse, MatchesResponse } from '../types';
import { useSnackbar } from '../contexts/SnackbarContext';
import { getRoundLabel } from '../utils/matchUtils';
import { useTranslation } from 'react-i18next';

export default function Servers() {
  const { setHeaderActions } = usePageHeader();
  const [servers, setServers] = useState<Server[]>([]);
  const { showError, showSnackbar, closeSnackbar } = useSnackbar();
  const [modalOpen, setModalOpen] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [loadingMatchServerId, setLoadingMatchServerId] = useState<string | null>(null);
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [allocationStatus, setAllocationStatus] = useState<{
    availableServerCount: number;
    requiredServerCount: number;
    gracePeriodSeconds: number;
    nextAllocationInSeconds: number | null;
    servers: Array<{
      id: string;
      name: string;
      online: boolean;
      status: string | null;
      matchSlug: string | null;
      updatedAt: number | null;
      inGraceWindow: boolean;
      secondsUntilReady: number | null;
      allocatable: boolean;
    }>;
  } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(() => new Set());
  const [retryingServerId, setRetryingServerId] = useState<string | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const { t } = useTranslation();

  // Set dynamic page title
  useEffect(() => {
    document.title = t('serversPage.title');
  }, [t]);

  const checkServerStatus = async (
    serverId: string,
    /**
     * When true (default), hit the lightweight cached status endpoint so we
     * don't spam live connectivity checks. When false, call the full
     * `/status` route to force an up-to-date connectivity test – used for
     * manual refreshes initiated by the admin.
     */
    options?: { useCached?: boolean }
  ): Promise<{
    status: 'online' | 'offline';
    currentMatch: string | null;
    queuedMatch?: string | null;
    reachableFromApi?: boolean;
    serverCanReachApi?: boolean;
    pluginStatus?: string | null;
    allocationState?: string | null;
    allocationMatchSlug?: string | null;
    ipBanned?: boolean;
  }> => {
    try {
      const useCached = options?.useCached !== false;
      // Default behaviour is to use the lightweight cached status endpoint so
      // we don't spam live connectivity checks on every automatic refresh.
      // When the admin explicitly clicks the "Refresh" button, we call this
      // function with `useCached: false` to force a live status check instead.
      const endpoint = useCached
        ? `/api/servers/${serverId}/status?cached=true`
        : `/api/servers/${serverId}/status`;
      const response = await api.get<ServerStatusResponse>(endpoint);
      const isOnline = response.status === 'online';
      return {
        status: isOnline ? 'online' : ('offline' as const),
        currentMatch: response.currentMatch ?? null,
        reachableFromApi: response.reachableFromApi,
        serverCanReachApi: response.serverCanReachApi,
        pluginStatus: response.pluginStatus ?? null,
        allocationState: response.allocationState ?? null,
        allocationMatchSlug: response.allocationMatchSlug ?? null,
        ipBanned: response.ipBanned ?? false,
      };
    } catch {
      return {
        status: 'offline',
        currentMatch: null,
        reachableFromApi: false,
        serverCanReachApi: false,
        pluginStatus: null,
        allocationState: null,
        allocationMatchSlug: null,
        ipBanned: false,
      };
    }
  };

  const loadServers = useCallback(
    async (options?: { useCached?: boolean }) => {
    setRefreshing(true);
    try {
      const response = await api.get<ServersResponse>('/api/servers');
      const serverList = response.servers || [];

      // Determine initial status from database fields (no "checking" state)
      const now = Math.floor(Date.now() / 1000);
      const INACTIVE_THRESHOLD = 5 * 60; // 5 minutes
      
      const serversWithStatus = serverList.map((s: Server) => {
        let initialStatus: string;
        if (!s.enabled) {
          initialStatus = 'disabled';
        } else if (!s.lastSeen) {
          initialStatus = 'unknown'; // Never connected
        } else if (now - s.lastSeen < INACTIVE_THRESHOLD) {
          initialStatus = 'online'; // Active heartbeat
        } else {
          initialStatus = 'offline'; // Inactive
        }
        
        return {
          ...s,
          status: initialStatus,
        };
      });
      setServers(serversWithStatus);

      // Only check status for enabled servers that have been configured (have lastSeen)
      // Unconfigured servers (no lastSeen) should use the retry button for manual initialization
      const configuredEnabledServers = serverList.filter((s) => s.enabled && s.lastSeen);
      
      if (configuredEnabledServers.length === 0) {
        setRefreshing(false);
        return;
      }
      
      const statusPromises = configuredEnabledServers.map(async (server: Server) => {
        const {
          status,
          currentMatch,
          queuedMatch,
          reachableFromApi,
          serverCanReachApi,
          pluginStatus,
          allocationState,
          allocationMatchSlug,
          ipBanned,
        } = await checkServerStatus(server.id, { useCached: options?.useCached });
        return {
          id: server.id,
          status,
          currentMatch,
          queuedMatch,
          reachableFromApi,
          serverCanReachApi,
          pluginStatus,
          allocationState,
          allocationMatchSlug,
          ipBanned,
        };
      });

      const statuses = await Promise.all(statusPromises);

      // Update servers with actual status (only configured servers that were checked)
      setServers((prev) =>
        prev.map((server) => {
          if (!server.enabled) {
            return { ...server, status: 'disabled' as const };
          }
          
          // If server was never configured (no lastSeen), keep its initial status
          if (!server.lastSeen) {
            return server;
          }
          
          const statusInfo = statuses.find((s) => s.id === server.id);
          const nextQueuedMatch =
            statusInfo?.queuedMatch !== undefined
              ? statusInfo.queuedMatch
              : (server as Server & { queuedMatch?: string | null }).queuedMatch ?? null;

          return {
            ...server,
            status: statusInfo?.status || server.status,
            currentMatch:
              statusInfo?.currentMatch !== undefined
                ? statusInfo.currentMatch
                : server.currentMatch ?? null,
            queuedMatch: nextQueuedMatch,
            reachableFromApi:
              statusInfo?.reachableFromApi !== undefined
                ? statusInfo.reachableFromApi
                : server.reachableFromApi,
            serverCanReachApi:
              statusInfo?.serverCanReachApi !== undefined
                ? statusInfo.serverCanReachApi
                : server.serverCanReachApi,
            ipBanned:
              statusInfo?.ipBanned !== undefined
                ? statusInfo.ipBanned
                : (server.ipBanned ?? false),
            pluginStatus:
              statusInfo?.pluginStatus !== undefined
                ? statusInfo.pluginStatus
                : server.pluginStatus ?? null,
            allocationState:
              statusInfo?.allocationState !== undefined
                ? statusInfo.allocationState
                : server.allocationState ?? null,
            allocationMatchSlug:
              statusInfo?.allocationMatchSlug !== undefined
                ? statusInfo.allocationMatchSlug
                : server.allocationMatchSlug ?? null,
          };
        })
      );
    } catch (err) {
      showError(t('serversPage.errors.loadServers'));
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  },
  [showError, t]);

  const loadAllocationStatus = useCallback(async () => {
    setAllocationLoading(true);
    try {
      const availability = await api.get<{
        success: boolean;
        availableServerCount: number;
        requiredServerCount: number;
        gracePeriodSeconds?: number;
        nextAllocationInSeconds?: number | null;
        servers?: Array<{
          id: string;
          name: string;
          online: boolean;
          status: string | null;
          matchSlug: string | null;
          updatedAt: number | null;
          inGraceWindow: boolean;
          secondsUntilReady: number | null;
          allocatable: boolean;
        }>;
        simulationEnabled?: boolean;
      }>('/api/tournament/server-availability');

      if (availability.success) {
        setAllocationStatus({
          availableServerCount: availability.availableServerCount,
          requiredServerCount: availability.requiredServerCount,
          gracePeriodSeconds: availability.gracePeriodSeconds ?? 120,
          nextAllocationInSeconds:
            typeof availability.nextAllocationInSeconds === 'number'
              ? availability.nextAllocationInSeconds
              : null,
          servers: availability.servers ?? [],
        });
      } else {
        setAllocationStatus(null);
      }
    } catch (err) {
      console.error('Failed to load server allocation status:', err);
    } finally {
      setAllocationLoading(false);
    }
  }, []);

  // Set header actions
  useEffect(() => {
    if (servers.length > 0) {
      const allSelected =
        servers.length > 0 && servers.every((server) => selectedServerIds.has(server.id));

      setHeaderActions(
        <Box display="flex" gap={2}>
          {!selectionMode && (
            <>
              <Button
                variant="outlined"
                size="small"
                startIcon={refreshing ? <CircularProgress size={20} /> : <RefreshIcon />}
                onClick={() => {
                  // Treat an explicit click on the Refresh button as a manual
                  // connectivity test – bypass the cached status snapshot and
                  // force live checks for each enabled server.
                  void loadServers({ useCached: false });
                  void loadAllocationStatus();
                }}
                disabled={refreshing}
              >
                {refreshing
                  ? t('serversPage.headerActions.refreshChecking')
                  : t('serversPage.headerActions.refresh')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setBatchModalOpen(true)}
              >
                {t('serversPage.headerActions.batchAdd')}
              </Button>
            </>
          )}
          {servers.length > 0 && (
            <>
              <Button
                variant={selectionMode ? 'contained' : 'outlined'}
                color={selectionMode ? 'secondary' : 'inherit'}
                size="small"
                onClick={() => {
                  setSelectionMode((prev) => !prev);
                  if (selectionMode) {
                    setSelectedServerIds(() => new Set());
                  }
                }}
              >
                {selectionMode
                  ? t('serversPage.headerActions.done')
                  : t('serversPage.headerActions.select')}
              </Button>
              {selectionMode && (
                <>
                  <Button
                    variant="outlined"
                    color="inherit"
                    size="small"
                    disabled={servers.length === 0}
                    onClick={() => {
                      setSelectedServerIds((prev) => {
                        const next = new Set(prev);
                        if (allSelected) {
                          next.clear();
                        } else {
                          servers.forEach((server) => {
                            next.add(server.id);
                          });
                        }
                        return next;
                      });
                    }}
                  >
                    {allSelected
                      ? t('serversPage.headerActions.unselectAll')
                      : t('serversPage.headerActions.selectAll')}
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    disabled={selectedServerIds.size === 0}
                    onClick={() => {
                      if (selectedServerIds.size === 0) return;
                      setBulkDeleteConfirmOpen(true);
                    }}
                  >
                    {t('serversPage.headerActions.deleteSelected')}
                  </Button>
                </>
              )}
            </>
          )}
          {!selectionMode && (
            <Button
              data-testid="add-server-button"
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => handleOpenModal()}
            >
              {t('serversPage.headerActions.addServer')}
            </Button>
          )}
        </Box>
      );
    } else {
      setHeaderActions(null);
    }

    return () => {
      setHeaderActions(null);
    };
  }, [
    servers,
    refreshing,
    setHeaderActions,
    loadServers,
    loadAllocationStatus,
    selectionMode,
    selectedServerIds,
    t,
  ]);

  useEffect(() => {
    // Initial page load uses cached status to avoid hammering servers when the
    // Always do full connectivity checks to show real server status (not cached)
    void loadServers({ useCached: false });
    void loadAllocationStatus();
  }, [loadServers, loadAllocationStatus]);

  const handleOpenModal = (server?: Server) => {
    setEditingServer(server || null);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingServer(null);
  };

  const handleSave = async () => {
    // Do a full status check after adding/updating server to show real connectivity
    await loadServers({ useCached: false });
    handleCloseModal();
  };

  const handleViewCurrentMatch = async (server: Server, event: React.MouseEvent) => {
    event.stopPropagation();

    if (!server.id) return;

    setLoadingMatchServerId(server.id);
    try {
      const response = await api.get<MatchesResponse & { tournamentStatus?: string }>(
        `/api/matches?serverId=${encodeURIComponent(server.id)}`
      );

      if (response.success && Array.isArray(response.matches) && response.matches.length > 0) {
        const activeMatches = response.matches.filter(
          (m) => m.status === 'live' || m.status === 'loaded'
        );
        const matchToShow = activeMatches[0] || response.matches[0];
        setSelectedMatch(matchToShow as Match);
      } else {
        showError('No matches found for this server');
      }
    } catch (err) {
      console.error('Failed to load current match for server', err);
      showError('Failed to load current match for this server');
    } finally {
      setLoadingMatchServerId(null);
    }
  };

  const toggleServerSelected = (serverId: string) => {
    setSelectedServerIds((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  };

  const handleRetryInitialization = async (serverId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent card click
    
    // Don't allow spamming the button
    if (retryingServerId) return;
    
    setRetryingServerId(serverId);
    
    // Show loading snackbar
    const loadingKey = showSnackbar('⏳ Sending persistent configuration to server...', 'info');
    
    try {
      await api.post(`/api/servers/${serverId}/reset-initialization`);
      
      // Dismiss loading snackbar and show success
      closeSnackbar(loadingKey);
      showSnackbar('✅ Server initialization triggered successfully', 'success');
      
      // Refresh server status after a short delay
      setTimeout(() => {
        void loadServers({ useCached: false });
      }, 1500);
    } catch (error) {
      // Dismiss loading snackbar
      closeSnackbar(loadingKey);
      showError(`❌ Failed to retry initialization: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRetryingServerId(null);
    }
  };

  // Calculate server statistics based on heartbeat tracking
  const serverStats = React.useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const INACTIVE_THRESHOLD = 5 * 60; // 5 minutes
    
    let online = 0;
    let offline = 0;
    let notConfigured = 0;
    let disabled = 0;
    
    servers.forEach((server) => {
      if (!server.enabled) {
        disabled++;
      } else if (!server.lastSeen) {
        notConfigured++; // Enabled but never configured - cannot be used
      } else if (now - server.lastSeen < INACTIVE_THRESHOLD) {
        online++;
      } else {
        offline++;
      }
    });
    
    return { online, offline, notConfigured, disabled, total: servers.length };
  }, [servers]);

  // Detect plugin version mismatches
  const versionInfo = React.useMemo(() => {
    const versionCounts = new Map<string, number>();
    
    servers.forEach((server) => {
      if (server.pluginVersion) {
        const count = versionCounts.get(server.pluginVersion) || 0;
        versionCounts.set(server.pluginVersion, count + 1);
      }
    });
    
    // Find most common version
    let mostCommonVersion: string | null = null;
    let maxCount = 0;
    
    versionCounts.forEach((count, version) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommonVersion = version;
      }
    });
    
    return {
      mostCommonVersion,
      versionCounts,
      hasMultipleVersions: versionCounts.size > 1,
    };
  }, [servers]);

  return (
    <Box data-testid="servers-page" sx={{ width: '100%', height: '100%' }}>
      {servers.length === 0 ? (
          <Box>
            <EmptyState
              icon={StorageIcon}
              title={t('serversPage.empty.title')}
              description={t('serversPage.empty.description')}
              actionLabel={t('serversPage.empty.addServer')}
              actionIcon={AddIcon}
              onAction={() => handleOpenModal()}
            />
            <Box display="flex" justifyContent="center" mt={2}>
              <Button variant="outlined" onClick={() => setBatchModalOpen(true)}>
                {t('serversPage.empty.batchAdd')}
              </Button>
            </Box>
          </Box>
        ) : (
          <>
            {/* Server Statistics Summary */}
            <Box mb={2}>
              <Card variant="outlined">
                <CardContent>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Server Fleet Status
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {serverStats.total} {serverStats.total === 1 ? 'Server' : 'Servers'}
                    </Typography>
                  </Box>
                  <Box display="flex" gap={2} flexWrap="wrap" mb={versionInfo.hasMultipleVersions ? 2 : 0}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
                      <Typography variant="body2" color="success.main">
                        <strong>{serverStats.online}</strong> Online
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <CancelIcon sx={{ color: 'error.main', fontSize: 20 }} />
                      <Typography variant="body2" color="error.main">
                        <strong>{serverStats.offline}</strong> Offline
                      </Typography>
                    </Box>
                    {serverStats.notConfigured > 0 && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <BlockIcon sx={{ color: 'text.disabled', fontSize: 20 }} />
                        <Typography variant="body2" color="text.disabled">
                          <strong>{serverStats.notConfigured}</strong> Not Configured
                        </Typography>
                      </Box>
                    )}
                    {serverStats.disabled > 0 && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <BlockIcon sx={{ color: 'text.disabled', fontSize: 20 }} />
                        <Typography variant="body2" color="text.disabled">
                          <strong>{serverStats.disabled}</strong> Disabled
                        </Typography>
                      </Box>
                    )}
                  </Box>
                  {versionInfo.hasMultipleVersions && (
                    <Box 
                      sx={{ 
                        bgcolor: 'warning.50', 
                        border: 1, 
                        borderColor: 'warning.main',
                        borderRadius: 1, 
                        p: 1.5,
                        mt: 1
                      }}
                    >
                      <Typography variant="caption" fontWeight={600} color="warning.dark" display="block" mb={0.5}>
                        ⚠️ Version Mismatch Detected
                      </Typography>
                      <Box display="flex" gap={1} flexWrap="wrap">
                        {Array.from(versionInfo.versionCounts.entries()).map(([version, count]) => (
                          <Chip
                            key={version}
                            label={`v${version}: ${count} ${count === 1 ? 'server' : 'servers'}`}
                            size="small"
                            color={version === versionInfo.mostCommonVersion ? 'success' : 'warning'}
                            variant="outlined"
                            sx={{ fontWeight: 500 }}
                          />
                        ))}
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                        Recommended: Update all servers to v{versionInfo.mostCommonVersion} for consistency
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Box>

            {/* Match Allocation Status */}
            <Box mb={2}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                    {t('serversPage.allocation.title')}
                  </Typography>
                  {!allocationStatus ? (
                    <Typography variant="body2" color="text.secondary">
                      {allocationLoading
                        ? t('serversPage.allocation.loading')
                        : t('serversPage.allocation.empty')}
                    </Typography>
                  ) : (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        <strong>{t('serversPage.allocation.available')}</strong>{' '}
                        {allocationStatus.availableServerCount} / {allocationStatus.servers.length}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>{t('serversPage.allocation.waiting')}</strong>{' '}
                        {allocationStatus.requiredServerCount}
                      </Typography>
                      {allocationStatus.nextAllocationInSeconds !== null && (
                        <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                          {t('serversPage.allocation.nextPass', {
                            seconds: allocationStatus.nextAllocationInSeconds,
                          })}
                        </Typography>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </Box>

            <Grid container spacing={2}>
              {servers.map((server) => {
                const allocSnapshot = allocationStatus?.servers.find((s) => s.id === server.id);
                const inGraceWindow = !!allocSnapshot?.inGraceWindow;
                const secondsUntilReady = allocSnapshot?.secondsUntilReady ?? null;
                
                // Check if server needs initialization (enabled but never sent events)
                // Show warning immediately based on database state, don't wait for ping
                const needsInitialization = server.enabled && !server.lastSeen;

                return (
                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={server.id}>
                <Card
                  data-testid={`server-card-${server.name.replace(/\s+/g, '-').toLowerCase()}`}
                  sx={{
                    cursor: 'pointer',
                    transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
                    border: selectedServerIds.has(server.id) 
                      ? 2 
                      : needsInitialization 
                      ? 2 
                      : 0,
                    borderRadius: 2,
                    borderStyle: 'solid',
                    borderColor: selectedServerIds.has(server.id)
                      ? 'primary.main'
                      : needsInitialization
                      ? 'error.main'
                      : 'transparent',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: 6,
                    },
                  }}
                  onClick={() => {
                    if (selectionMode) {
                      toggleServerSelected(server.id);
                    } else {
                      handleOpenModal(server);
                    }
                  }}
                >
                  <CardContent>
                    {needsInitialization && (
                      <Box
                        sx={{
                          bgcolor: 'error.light',
                          border: 1,
                          borderColor: 'error.main',
                          borderRadius: 1,
                          p: 1.5,
                          mb: 2,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                        }}
                      >
                        <BlockIcon sx={{ color: 'text.primary', fontSize: 20 }} aria-label="Warning" />
                        <Box flex={1}>
                          <Typography variant="body2" fontWeight={600} color="text.primary">
                            Server Not Initialized
                          </Typography>
                          <Typography variant="caption" color="text.primary" display="block" mt={0.25}>
                            RCON reachable, but MatchZy hasn't sent events. Click retry button to configure.
                          </Typography>
                        </Box>
                      </Box>
                    )}
                    {server.ipBanned && (
                      <Box
                        sx={{
                          bgcolor: 'error.light',
                          border: 1,
                          borderColor: 'error.main',
                          borderRadius: 1,
                          p: 1.5,
                          mb: 2,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                        }}
                      >
                        <BlockIcon sx={{ color: 'text.primary', fontSize: 20 }} aria-label="IP Banned" />
                        <Box flex={1}>
                          <Typography variant="body2" fontWeight={600} color="text.primary">
                            {t('serversPage.ipBanned.title')}
                          </Typography>
                          <Typography variant="caption" color="text.primary" display="block" mt={0.25}>
                            {t('serversPage.ipBanned.message')}
                          </Typography>
                        </Box>
                      </Box>
                    )}
                    <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                      <Box flex={1}>
                        <Typography variant="h6" fontWeight={600} gutterBottom>
                          {server.name}
                        </Typography>
                        <Box display="flex" gap={0.5} flexWrap="wrap">
                          {(() => {
                            const reachableFromApi = server.reachableFromApi;
                            const serverCanReachApi = server.serverCanReachApi;
                            const now = Math.floor(Date.now() / 1000);
                            const isHeartbeatActive = server.lastSeen && (now - server.lastSeen < 300); // 5 minutes

                            let label: string;
                            let color: 'default' | 'success' | 'error' | 'warning' | 'info' =
                              'default';

                            if (!server.enabled || server.status === 'disabled') {
                              label = t('serversPage.statusChip.disabled');
                              color = 'default';
                            } else if (!server.lastSeen) {
                              // Never connected - show unknown status
                              label = 'Not Configured';
                              color = 'error';
                            } else if (server.lastSeen && !isHeartbeatActive) {
                              // Heartbeat-based offline detection (more reliable)
                              label = 'Offline (No Events)';
                              color = 'error';
                            } else if (server.status !== 'online') {
                              label = t('serversPage.statusChip.offline');
                              color = 'error';
                            } else if (reachableFromApi && serverCanReachApi) {
                              label = isHeartbeatActive ? 'Online (Active)' : t('serversPage.statusChip.onlineOk');
                              color = 'success';
                            } else if (reachableFromApi && serverCanReachApi === false) {
                              label = t('serversPage.statusChip.onlineRconOnly');
                              color = 'warning';
                            } else if (reachableFromApi === false) {
                              label = t('serversPage.statusChip.rconFailed');
                              color = 'error';
                            } else {
                              label = 'Online';
                              color = 'success';
                            }

                            const icon = color === 'success' ? (
                              <CheckCircleIcon />
                            ) : color === 'warning' ? (
                              <RefreshIcon />
                            ) : server.status === 'disabled' || !server.enabled ? (
                              <BlockIcon />
                            ) : (
                              <CancelIcon />
                            );

                            return (
                              <Chip
                                icon={icon}
                                label={label}
                                size="small"
                                color={color}
                                sx={{ fontWeight: 600 }}
                              />
                            );
                          })()}
                          {server.pluginVersion && (
                            <>
                              <Chip
                                label={`v${server.pluginVersion}`}
                                size="small"
                                variant="outlined"
                                color={
                                  versionInfo.mostCommonVersion &&
                                  server.pluginVersion !== versionInfo.mostCommonVersion
                                    ? 'warning'
                                    : 'primary'
                                }
                                sx={{ fontWeight: 500 }}
                              />
                              {versionInfo.hasMultipleVersions &&
                                versionInfo.mostCommonVersion &&
                                server.pluginVersion !== versionInfo.mostCommonVersion && (
                                  <Chip
                                    label="Version Mismatch"
                                    size="small"
                                    color="warning"
                                    sx={{ fontWeight: 500 }}
                                  />
                                )}
                            </>
                          )}
                        </Box>
                      </Box>
                      <Tooltip title="Retry server initialization (send persistent config via RCON)">
                        <IconButton
                          size="small"
                          onClick={(e) => handleRetryInitialization(server.id, e)}
                          disabled={retryingServerId === server.id}
                          sx={{
                            ml: 1,
                            '&:hover': {
                              backgroundColor: 'action.hover',
                            },
                          }}
                        >
                          {retryingServerId === server.id ? (
                            <CircularProgress size={20} />
                          ) : (
                            <ReplayIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Box>

                    <Box display="flex" flexDirection="column" gap={0.5} mb={2}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        data-testid="server-host"
                      >
                        <strong>{t('serversPage.labels.host')}</strong> {server.host}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>{t('serversPage.labels.port')}</strong> {server.port}
                      </Typography>
                      {server.hostname && (
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <DnsIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                          <Typography variant="body2" color="text.secondary">
                            <strong>CS2 Name:</strong> {server.hostname}
                          </Typography>
                        </Box>
                      )}
                      {server.pluginVersion && (
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <UpdateIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                          <Typography variant="body2" color="text.secondary">
                            <strong>Plugin:</strong> MatchZy Enhanced v{server.pluginVersion}
                          </Typography>
                        </Box>
                      )}
                      {server.lastSeen && (
                        <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                          {(() => {
                            const now = Math.floor(Date.now() / 1000);
                            const secondsAgo = now - server.lastSeen;
                            const minutesAgo = Math.floor(secondsAgo / 60);
                            const hoursAgo = Math.floor(minutesAgo / 60);
                            const daysAgo = Math.floor(hoursAgo / 24);
                            
                            let timeStr;
                            if (secondsAgo < 60) {
                              timeStr = 'just now';
                            } else if (minutesAgo < 60) {
                              timeStr = `${minutesAgo}m ago`;
                            } else if (hoursAgo < 24) {
                              timeStr = `${hoursAgo}h ago`;
                            } else {
                              timeStr = `${daysAgo}d ago`;
                            }
                            
                            const isActive = secondsAgo < 300; // 5 minutes
                            return (
                              <span style={{ 
                                color: isActive ? '#4caf50' : '#9e9e9e',
                                fontWeight: isActive ? 600 : 400 
                              }}>
                                ⏱️ Active {timeStr}
                              </span>
                            );
                          })()}
                        </Typography>
                      )}
                    </Box>
                    {server.status === 'online' && (
                      <Box display="flex" flexDirection="column" gap={0.5} mb={1}>
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <ArrowUpwardIcon
                            fontSize="small"
                            sx={{
                              color:
                                server.reachableFromApi === false
                                  ? 'error.main'
                                  : server.reachableFromApi
                                  ? 'success.main'
                                  : 'text.disabled',
                            }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {t('serversPage.connectivity.apiToServer')}{' '}
                            <strong>
                              {server.reachableFromApi === false
                                ? t('serversPage.connectivity.unreachable')
                                : server.reachableFromApi
                                ? t('serversPage.connectivity.reachable')
                                : t('serversPage.connectivity.unknown')}
                            </strong>
                          </Typography>
                        </Box>
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <ArrowDownwardIcon
                            fontSize="small"
                            sx={{
                              color:
                                server.serverCanReachApi === false
                                  ? 'error.main'
                                  : server.serverCanReachApi
                                  ? 'success.main'
                                  : 'text.disabled',
                            }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {t('serversPage.connectivity.serverToApi')}{' '}
                            <strong>
                              {server.serverCanReachApi === false
                                ? t('serversPage.connectivity.unreachable')
                                : server.serverCanReachApi
                                ? t('serversPage.connectivity.reachable')
                                : t('serversPage.connectivity.unknown')}
                            </strong>
                          </Typography>
                        </Box>
                        {server.pluginStatus && (
                          <Box display="flex" alignItems="center" gap={0.5}>
                            <Typography variant="caption" color="text.secondary">
                              <strong>{t('serversPage.connectivity.pluginLabel')}</strong>{' '}
                              <Chip
                                label={server.pluginStatus.toUpperCase()}
                                size="small"
                                color={
                                  server.pluginStatus === 'idle'
                                    ? 'success'
                                    : server.pluginStatus === 'live'
                                    ? 'error'
                                    : server.pluginStatus === 'queued'
                                    ? 'info'
                                    : server.pluginStatus === 'warmup' ||
                                      server.pluginStatus === 'loading'
                                    ? 'info'
                                    : server.pluginStatus === 'postgame'
                                    ? 'default'
                                    : 'warning'
                                }
                                variant="outlined"
                                sx={{ fontWeight: 600, ml: 0.5 }}
                              />
                            </Typography>
                          </Box>
                        )}
                        {inGraceWindow && typeof secondsUntilReady === 'number' && secondsUntilReady > 0 && (
                          <Box display="flex" alignItems="center" gap={0.5}>
                            <Typography variant="caption" color="text.secondary">
                              <strong>{t('serversPage.allocation.cooldownLabel')}:</strong>{' '}
                              {t('serversPage.allocation.cooldownEta', {
                                seconds: secondsUntilReady,
                              })}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    )}
                    {server.status === 'online' && (server.currentMatch || (server as Server & { queuedMatch?: string | null }).queuedMatch) && (
                      <Box display="flex" flexDirection="column" gap={0.5} mt={1}>
                        {server.currentMatch && (
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Chip
                          label={server.currentMatch}
                          size="small"
                          color="primary"
                          variant="outlined"
                              sx={{
                                fontWeight: 600,
                                maxWidth: '60%',
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                              }}
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(event) => handleViewCurrentMatch(server, event)}
                          disabled={loadingMatchServerId === server.id}
                        >
                          {loadingMatchServerId === server.id
                            ? t('serversPage.currentMatch.loading')
                            : t('serversPage.currentMatch.view')}
                        </Button>
                          </Box>
                        )}
                        {(server as Server & { queuedMatch?: string | null }).queuedMatch && (
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Chip
                              label={`${t('serversPage.currentMatch.queuedPrefix')}${
                                (server as Server & { queuedMatch?: string | null }).queuedMatch
                              }`}
                              size="small"
                              color="info"
                              variant="outlined"
                              sx={{
                                fontWeight: 600,
                                maxWidth: '100%',
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                              }}
                            />
                          </Box>
                        )}
                      </Box>
                    )}

                    <Typography variant="caption" color="text.secondary" display="block" mt={2}>
                      {t('serversPage.labels.id')} {server.id}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
                );
              })}
            </Grid>
          </>
        )}

      <ServerModal
        open={modalOpen}
        server={editingServer}
        servers={servers}
        onClose={handleCloseModal}
        onSave={handleSave}
      />

      <BatchServerModal
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        onSave={handleSave}
        existingServers={servers}
      />

      {selectedMatch && (
        <MatchDetailsModal
          match={selectedMatch}
          matchNumber={selectedMatch.matchNumber || selectedMatch.id}
          roundLabel={getRoundLabel(selectedMatch.round)}
          onClose={() => setSelectedMatch(null)}
        />
      )}

      <ConfirmDialog
        open={selectionMode && bulkDeleteConfirmOpen}
        title={t('serversPage.bulkDelete.title')}
        message={t('serversPage.bulkDelete.message', {
          count: selectedServerIds.size,
          suffix: selectedServerIds.size === 1 ? '' : 's',
        })}
        confirmColor="error"
        onConfirm={async () => {
          if (selectedServerIds.size === 0) {
            setBulkDeleteConfirmOpen(false);
            return;
          }
          try {
            await api.post('/api/servers/bulk-delete', {
              ids: Array.from(selectedServerIds),
            });
            setSelectedServerIds(() => new Set());
            setSelectionMode(false);
            await loadServers();
            await loadAllocationStatus();
          } catch (err) {
            console.error('Failed to delete servers', err);
            showError(t('serversPage.errors.bulkDelete'));
          } finally {
            setBulkDeleteConfirmOpen(false);
          }
        }}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />
    </Box>
  );
}
