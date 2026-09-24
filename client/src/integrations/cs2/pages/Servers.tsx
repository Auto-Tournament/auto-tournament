import React, { useState, useEffect, useCallback } from 'react';
import { Box, Button, Card, CardContent, Typography, Grid, Chip, CircularProgress, IconButton, Tooltip, Link } from '@mui/material';
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
import ServerModal from '../servers/ServerModal';
import BatchServerModal from '../servers/BatchServerModal';
import type { Server, ServersResponse, ServerStatusResponse, MatchesResponse } from '../../../types';
import type { SnackbarKey } from 'notistack';
import {
  usePageHeader,
  api,
  EmptyState,
  ConfirmDialog,
  useSnackbar,
  openMatchDetails,
  tokens,
  mono,
  withAlpha,
  StatusDot,
  useModuleTranslation,
} from '../../../module-sdk';

export default function Servers() {
  const { setHeaderActions } = usePageHeader();
  const [servers, setServers] = useState<Server[]>([]);
  const { showError, showSnackbar, showPersistentError, closeSnackbar } = useSnackbar();
  const [modalOpen, setModalOpen] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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
  const [retryingAll, setRetryingAll] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [statusCheckingIds, setStatusCheckingIds] = useState<Set<string>>(() => new Set());
  const [latestPluginVersion, setLatestPluginVersion] = useState<string | null>(null);
  const [latestPluginReleaseUrl, setLatestPluginReleaseUrl] = useState<string | null>(null);
  const [cs2OutdatedSnackbarKey, setCs2OutdatedSnackbarKey] = useState<SnackbarKey | null>(null);
  const { t } = useModuleTranslation('cs2');

  const docs = {
    fleetHealth: 'https://docs.autotournament.gg/reference/servers-health',
    pluginDbDown: 'https://docs.autotournament.gg/reference/servers-health#plugin-db-down',
    cs2Outdated: 'https://docs.autotournament.gg/reference/servers-health#cs2-update-required',
    offline: 'https://docs.autotournament.gg/reference/servers-health#server-offline-or-unreachable',
    ipBanned: 'https://docs.autotournament.gg/reference/servers-health#ip-banned-rcon',
    versionMismatch: 'https://docs.autotournament.gg/reference/servers-health#plugin-version-mismatch',
  } as const;

  const compareDottedVersions = React.useCallback((a: string, b: string): number | null => {
    const normalize = (v: string) => {
      const cleaned = v.trim().replace(/^v/i, '').split('-')[0]; // drop leading v + prerelease
      const parts = cleaned.split('.').map((p) => Number(p));
      if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
      return parts;
    };

    const pa = normalize(a);
    const pb = normalize(b);
    if (!pa || !pb) return null;

    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na !== nb) return na < nb ? -1 : 1;
    }
    return 0;
  }, []);

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
    cs2BuildId?: number | null;
    cs2VersionString?: string | null;
    cs2VersionFetchedAt?: number | null;
    cs2RequiredVersion?: number | null;
    cs2UpdatePhase?: string | null;
    cs2UpdateCheckedAt?: number | null;
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
        queuedMatch: response.queuedMatch ?? null,
        reachableFromApi: response.reachableFromApi,
        serverCanReachApi: response.serverCanReachApi,
        pluginStatus: response.pluginStatus ?? null,
        allocationState: response.allocationState ?? null,
        allocationMatchSlug: response.allocationMatchSlug ?? null,
        ipBanned: response.ipBanned ?? false,
        cs2BuildId: response.cs2BuildId ?? null,
        cs2VersionString: response.cs2VersionString ?? null,
        cs2VersionFetchedAt: response.cs2VersionFetchedAt ?? null,
        cs2RequiredVersion: response.cs2RequiredVersion ?? null,
        cs2UpdatePhase: response.cs2UpdatePhase ?? null,
        cs2UpdateCheckedAt: response.cs2UpdateCheckedAt ?? null,
      };
    } catch {
      return {
        status: 'offline',
        currentMatch: null,
        queuedMatch: null,
        reachableFromApi: false,
        serverCanReachApi: false,
        pluginStatus: null,
        allocationState: null,
        allocationMatchSlug: null,
        ipBanned: false,
        cs2BuildId: null,
        cs2VersionString: null,
        cs2VersionFetchedAt: null,
        cs2RequiredVersion: null,
        cs2UpdatePhase: null,
        cs2UpdateCheckedAt: null,
      };
    }
  };

  const loadServers = useCallback(
    async (options?: { useCached?: boolean; autoRetry?: boolean }) => {
    setRefreshing(true);
    try {
      const response = await api.get<ServersResponse>('/api/servers');
      const serverList = response.servers || [];

      // Determine an initial status without treating "no recent events" as offline.
      // Actual reachability is populated shortly after via `/api/servers/:id/status`.
      const serversWithStatus = serverList.map((s: Server) => {
        let initialStatus: string;
        if (!s.enabled) {
          initialStatus = 'disabled';
        } else if (s.status === 'offline') {
          initialStatus = 'offline';
        } else if (!s.lastSeen) {
          initialStatus = 'unknown'; // Never connected
        } else {
          initialStatus = 'online';
        }
        
        return {
          ...s,
          status: initialStatus,
        };
      });
      setServers(serversWithStatus);

      // Check status for all enabled servers (including unconfigured) so we can show
      // "API can reach server" / "server can reach API" even when Auto Tournament CS2 hasn't sent events yet.
      const enabledServersToCheck = serverList.filter((s) => s.enabled);

      if (enabledServersToCheck.length === 0) {
        setRefreshing(false);
        return;
      }

      const checkingIds = new Set(enabledServersToCheck.map((s) => s.id));
      setStatusCheckingIds(checkingIds);

      const mergeStatusIntoServer = (
        prev: Server[],
        serverId: string,
        statusInfo: {
          status?: 'online' | 'offline';
          currentMatch?: string | null;
          queuedMatch?: string | null;
          reachableFromApi?: boolean;
          serverCanReachApi?: boolean;
          pluginStatus?: string | null;
          allocationState?: string | null;
          allocationMatchSlug?: string | null;
          ipBanned?: boolean;
          cs2BuildId?: number | null;
          cs2VersionString?: string | null;
          cs2VersionFetchedAt?: number | null;
          cs2RequiredVersion?: number | null;
          cs2UpdatePhase?: string | null;
          cs2UpdateCheckedAt?: number | null;
        }
      ) =>
        prev.map((server) => {
          if (server.id !== serverId || !server.enabled) return server;
          const nextQueuedMatch =
            statusInfo.queuedMatch !== undefined
              ? statusInfo.queuedMatch
              : (server as Server & { queuedMatch?: string | null }).queuedMatch ?? null;
          return {
            ...server,
            status: (statusInfo.status || server.status) as Server['status'],
            currentMatch: statusInfo.currentMatch !== undefined ? statusInfo.currentMatch : server.currentMatch ?? null,
            queuedMatch: nextQueuedMatch,
            reachableFromApi: statusInfo.reachableFromApi !== undefined ? statusInfo.reachableFromApi : server.reachableFromApi,
            serverCanReachApi: statusInfo.serverCanReachApi !== undefined ? statusInfo.serverCanReachApi : server.serverCanReachApi,
            ipBanned: statusInfo.ipBanned !== undefined ? statusInfo.ipBanned : (server.ipBanned ?? false),
            pluginStatus: statusInfo.pluginStatus !== undefined ? statusInfo.pluginStatus : server.pluginStatus ?? null,
            allocationState: statusInfo.allocationState !== undefined ? statusInfo.allocationState : server.allocationState ?? null,
            allocationMatchSlug: statusInfo.allocationMatchSlug !== undefined ? statusInfo.allocationMatchSlug : server.allocationMatchSlug ?? null,
            cs2BuildId: statusInfo.cs2BuildId !== undefined ? statusInfo.cs2BuildId : server.cs2BuildId ?? null,
            cs2VersionString:
              statusInfo.cs2VersionString !== undefined ? statusInfo.cs2VersionString : server.cs2VersionString ?? null,
            cs2VersionFetchedAt:
              statusInfo.cs2VersionFetchedAt !== undefined
                ? statusInfo.cs2VersionFetchedAt
                : server.cs2VersionFetchedAt ?? null,
            cs2RequiredVersion:
              statusInfo.cs2RequiredVersion !== undefined
                ? statusInfo.cs2RequiredVersion
                : server.cs2RequiredVersion ?? null,
            cs2UpdatePhase:
              statusInfo.cs2UpdatePhase !== undefined
                ? statusInfo.cs2UpdatePhase
                : server.cs2UpdatePhase ?? null,
            cs2UpdateCheckedAt:
              statusInfo.cs2UpdateCheckedAt !== undefined
                ? statusInfo.cs2UpdateCheckedAt
                : server.cs2UpdateCheckedAt ?? null,
          };
        });

      const removeFromChecking = (id: string) => {
        setStatusCheckingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      };

      const statusPromises = enabledServersToCheck.map(async (server: Server) => {
        try {
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
            cs2BuildId,
            cs2VersionString,
            cs2VersionFetchedAt,
          } = await checkServerStatus(server.id, { useCached: options?.useCached });
          const statusInfo = {
            status,
            currentMatch,
            queuedMatch,
            reachableFromApi,
            serverCanReachApi,
            pluginStatus,
            allocationState,
            allocationMatchSlug,
            ipBanned,
            cs2BuildId,
            cs2VersionString,
            cs2VersionFetchedAt,
          };
          setServers((prev) => mergeStatusIntoServer(prev, server.id, statusInfo));
          return { server, statusInfo };
        } catch {
          // Leave server state unchanged; avoid sticking in "Checking..." forever
          return null;
        } finally {
          removeFromChecking(server.id);
        }
      });

      const results = await Promise.allSettled(statusPromises);
      
      // Auto-retry servers that need initialization (unless explicitly disabled)
      if (options?.autoRetry !== false) {
        const serversNeedingRetry: Server[] = [];
        
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            const { server, statusInfo } = result.value;
            const needsConfig = !server.persistentConfigSent || statusInfo.serverCanReachApi === false;
            if (needsConfig && statusInfo.reachableFromApi) {
              serversNeedingRetry.push(server);
            }
          }
        });

        if (serversNeedingRetry.length > 0) {
          // Trigger auto-retry in background without blocking
          void (async () => {
            for (const server of serversNeedingRetry) {
              try {
                await api.post(`/api/servers/${server.id}/reset-initialization`);
                await new Promise((r) => setTimeout(r, 400));
              } catch (e) {
                console.warn(`Auto-retry failed for ${server.id}:`, e);
              }
            }
            // Reload after auto-retry completes
            setTimeout(() => void loadServers({ useCached: true, autoRetry: false }), 1500);
          })();
        }
      }
    } catch (err) {
      showError(t('serversPage.errors.loadServers'));
      console.error(err);
      setStatusCheckingIds(() => new Set());
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

  const uninitializedCount = React.useMemo(
    () => servers.filter((s) => s.enabled && !s.lastSeen).length,
    [servers]
  );

  const handleRetryAllUninitialized = useCallback(async () => {
    const needRetry = servers.filter((s) => s.enabled && !s.lastSeen);
    if (needRetry.length === 0 || retryingAll) return;

    setRetryingAll(true);
    const loadingKey = showSnackbar(
      t('serversPage.retry.retryingAll', { count: needRetry.length }),
      'info'
    );

    try {
      for (const server of needRetry) {
        await api.post(`/api/servers/${server.id}/reset-initialization`);
        await new Promise((r) => setTimeout(r, 500));
      }
      closeSnackbar(loadingKey);
      showSnackbar(`✅ ${t('serversPage.retry.triggeredAll', { count: needRetry.length })}`, 'success');
      setTimeout(() => void loadServers({ useCached: false }), 1500);
    } catch (error) {
      closeSnackbar(loadingKey);
      const raw = error instanceof Error ? error.message : String(error);
      let msg = raw;
      try {
        const parsed = JSON.parse(raw) as { error?: string };
        if (typeof parsed?.error === 'string' && parsed.error.length > 0) {
          msg = parsed.error;
        }
      } catch {
        /* use raw */
      }
      showError(`❌ ${t('serversPage.retry.failedAll', { message: msg })}`);
    } finally {
      setRetryingAll(false);
    }
  }, [
    servers,
    retryingAll,
    showSnackbar,
    closeSnackbar,
    showError,
    loadServers,
    t,
  ]);

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
                  void loadServers({ useCached: false });
                  void loadAllocationStatus();
                }}
                disabled={refreshing}
              >
                {refreshing
                  ? t('serversPage.headerActions.refreshChecking')
                  : t('serversPage.headerActions.refresh')}
              </Button>
              {uninitializedCount > 0 && (
                <Button
                  variant="outlined"
                  size="small"
                  color="warning"
                  startIcon={
                    retryingAll ? (
                      <CircularProgress size={20} />
                    ) : (
                      <RefreshIcon />
                    )
                  }
                  onClick={() => void handleRetryAllUninitialized()}
                  disabled={retryingAll || refreshing}
                >
                  {retryingAll
                    ? t('serversPage.headerActions.retryUninitializedChecking')
                    : t('serversPage.headerActions.retryUninitialized', {
                        count: uninitializedCount,
                      })}
                </Button>
              )}
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
    uninitializedCount,
    retryingAll,
    handleRetryAllUninitialized,
    t,
  ]);

  useEffect(() => {
    // Initial page load uses cached status to avoid hammering servers when the
    // Always do full connectivity checks to show real server status (not cached)
    void loadServers({ useCached: false });
    void loadAllocationStatus();
    
    // Fetch latest Auto Tournament CS2 version from GitHub
    api
      .get<{ success: boolean; version?: string; releaseUrl?: string }>('/api/cs2-plugin/latest-version')
      .then((response) => {
        if (response.success && response.version) {
          setLatestPluginVersion(response.version);
          setLatestPluginReleaseUrl(response.releaseUrl ?? null);
        }
      })
      .catch(() => {
        // Silently fail - not critical
      });
  }, [loadServers, loadAllocationStatus]);

  // 🚨 Urgent: keep an error snackbar on screen while any enabled server reports CS2 update required.
  useEffect(() => {
    const outdatedEnabledServers = servers.filter(
      (s) => s.enabled && typeof s.cs2RequiredVersion === 'number'
    );

    if (outdatedEnabledServers.length > 0) {
      if (!cs2OutdatedSnackbarKey) {
        const key = showPersistentError(
          <span>
            🚨 <strong>{t('serversPage.cs2Update.title')}</strong> —{' '}
            {t('serversPage.cs2Update.snackbarBody', { count: outdatedEnabledServers.length })}
          </span>,
          'cs2-update-required'
        );
        setCs2OutdatedSnackbarKey(key);
      }
    } else if (cs2OutdatedSnackbarKey) {
      closeSnackbar(cs2OutdatedSnackbarKey);
      setCs2OutdatedSnackbarKey(null);
    }
  }, [servers, cs2OutdatedSnackbarKey, showPersistentError, closeSnackbar, t]);

  const handleOpenModal = (server?: Server) => {
    setEditingServer(server || null);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingServer(null);
  };

  /**
   * Runs after a server is created, updated or deleted.
   *
   * Note this deliberately does NOT close the modal: ServerModal already calls
   * onClose() itself, synchronously, right after onSave(). This function is
   * async and can run for several seconds — auto-configuration posts to each
   * new server with a 400ms gap, then schedules another reload 1.5s later — so
   * a close here lands long after the dialog is gone, and shuts whatever the
   * user has opened in the meantime.
   */
  const handleSave = async (createdIds?: string[]) => {
    await loadServers({ useCached: false });
    if (createdIds?.length) {
      const key = showSnackbar(t('serversPage.autoConfig.configuring'), 'info');
      try {
        for (const id of createdIds) {
          try {
            await api.post(`/api/servers/${id}/reset-initialization`);
          } catch (e) {
            console.warn(`Auto-init failed for ${id}:`, e);
          }
          await new Promise((r) => setTimeout(r, 400));
        }
        closeSnackbar(key);
        showSnackbar(`✅ ${t('serversPage.autoConfig.done')}`, 'success');
        setTimeout(() => void loadServers({ useCached: false }), 1500);
      } catch {
        closeSnackbar(key);
      }
    }
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
        // Core's match details dialog; resolves once it is showing.
        await openMatchDetails(matchToShow.slug);
      } else {
        showError(t('serversPage.errors.noMatchesForServer'));
      }
    } catch (err) {
      console.error('Failed to load current match for server', err);
      showError(t('serversPage.errors.loadCurrentMatch'));
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
    event.stopPropagation();
    if (retryingServerId || retryingAll || statusCheckingIds.has(serverId)) return;

    setRetryingServerId(serverId);
    
    // Show loading snackbar
    const loadingKey = showSnackbar(t('serversPage.retry.sendingConfig'), 'info');
    
    try {
      await api.post(`/api/servers/${serverId}/reset-initialization`);
      
      // Dismiss loading snackbar and show success
      closeSnackbar(loadingKey);
      showSnackbar(`✅ ${t('serversPage.retry.triggered')}`, 'success');
      
      // Refresh server status after a short delay
      setTimeout(() => {
        void loadServers({ useCached: false });
      }, 1500);
    } catch (error) {
      closeSnackbar(loadingKey);
      const raw = error instanceof Error ? error.message : String(error);
      let msg = raw;
      try {
        const parsed = JSON.parse(raw) as { error?: string };
        if (typeof parsed?.error === 'string' && parsed.error.length > 0) {
          msg = parsed.error;
        }
      } catch {
        /* use raw */
      }
      showError(`❌ ${t('serversPage.retry.failed', { message: msg })}`);
    } finally {
      setRetryingServerId(null);
    }
  };

  // Sort servers by id: numeric suffix first (s_1, s_2, s_3), then by id string
  const sortedServers = React.useMemo(() => {
    const key = (id: string): [number, string] => {
      const m = id.match(/_(\d+)$/);
      return [m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER, id];
    };
    return [...servers].sort((a, b) => {
      const [na, sa] = key(a.id);
      const [nb, sb] = key(b.id);
      return na !== nb ? na - nb : sa.localeCompare(sb);
    });
  }, [servers]);

  // Calculate server statistics based on heartbeat tracking
  const serverStats = React.useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const HEARTBEAT_RECENT_THRESHOLD = 5 * 60; // 5 minutes
    
    let online = 0;
    let offline = 0;
    let notConfigured = 0;
    let disabled = 0;
    
    servers.forEach((server) => {
      if (!server.enabled) {
        disabled++;
      } else if (!server.lastSeen) {
        notConfigured++; // Enabled but never configured - cannot be used
      } else {
        const heartbeatRecent = now - server.lastSeen < HEARTBEAT_RECENT_THRESHOLD;
        const reachable = server.reachableFromApi === true;
        const explicitlyOffline = server.status !== 'online' && server.reachableFromApi === false;

        if (explicitlyOffline) {
          offline++;
        } else if (reachable || heartbeatRecent || server.status === 'online') {
          online++;
        } else {
          // Conservatively treat as online until we have a definitive reachability failure.
          online++;
        }
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

  // Detect CS2 update-required servers
  const cs2UpdateInfo = React.useMemo(() => {
    const outOfDate = servers.filter((s) => s.enabled && typeof s.cs2RequiredVersion === 'number');
    const byVersion = new Map<number, Server[]>();
    for (const s of outOfDate) {
      const v = s.cs2RequiredVersion as number;
      const list = byVersion.get(v) ?? [];
      list.push(s);
      byVersion.set(v, list);
    }
    const versions = Array.from(byVersion.keys()).sort((a, b) => b - a);
    return { outOfDate, byVersion, versions };
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
                      {t('serversPage.fleet.title')}
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {t('serversPage.fleet.total', { count: serverStats.total })}
                    </Typography>
                  </Box>
                  <Box display="flex" gap={2} flexWrap="wrap" mb={versionInfo.hasMultipleVersions ? 2 : 0}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
                      <Typography variant="body2" color="success.main">
                        <strong>{serverStats.online}</strong> {t('serversPage.fleet.online')}
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <CancelIcon sx={{ color: 'error.main', fontSize: 20 }} />
                      <Typography variant="body2" color="error.main">
                        <strong>{serverStats.offline}</strong> {t('serversPage.fleet.offline')}
                      </Typography>
                    </Box>
                    {serverStats.notConfigured > 0 && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <BlockIcon sx={{ color: 'text.disabled', fontSize: 20 }} />
                        <Typography variant="body2" color="text.disabled">
                          <strong>{serverStats.notConfigured}</strong>{' '}
                          {t('serversPage.fleet.notConfigured')}
                        </Typography>
                      </Box>
                    )}
                    {serverStats.disabled > 0 && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <BlockIcon sx={{ color: 'text.disabled', fontSize: 20 }} />
                        <Typography variant="body2" color="text.disabled">
                          <strong>{serverStats.disabled}</strong> {t('serversPage.fleet.disabled')}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                  {(() => {
                    if (!latestPluginVersion) return null;
                    const serversWithVersion = servers.filter((s) => s.pluginVersion);
                    const comparisons = serversWithVersion
                      .map((s) => {
                        const v = s.pluginVersion;
                        if (!v) return null;
                        return compareDottedVersions(v, latestPluginVersion);
                      })
                      .filter((x): x is number => typeof x === 'number');

                    const olderCount = comparisons.filter((c) => c < 0).length;
                    const newerCount = comparisons.filter((c) => c > 0).length;
                    if (olderCount === 0 && newerCount === 0) return null;

                    const boxColor = olderCount > 0 ? 'warning' : 'info';
                    const releaseHref =
                      latestPluginReleaseUrl ??
                      'https://github.com/Auto-Tournament/cs2-plugin/releases';

                    return (
                      <Box
                        sx={{
                          bgcolor: withAlpha(boxColor === 'warning' ? tokens.color.warning : tokens.color.info, 0.1),
                          border: 1,
                          borderColor: withAlpha(boxColor === 'warning' ? tokens.color.warning : tokens.color.info, 0.4),
                          borderRadius: `${tokens.radius.md}px`,
                          p: 1.5,
                          mt: 1,
                          color: 'text.primary',
                        }}
                      >
                        <Typography
                          variant="caption"
                          fontWeight={600}
                          sx={{ color: 'inherit' }}
                          display="block"
                          mb={0.5}
                        >
                          {t('serversPage.fleet.latestRelease', { version: latestPluginVersion })}
                        </Typography>
                        {olderCount > 0 && (
                          <Typography variant="caption" sx={{ color: 'inherit' }} display="block">
                            {t('serversPage.fleet.olderVersion', { count: olderCount })}{' '}
                            <a href={releaseHref} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                              {t('serversPage.fleet.downloadLatest')}
                            </a>
                          </Typography>
                        )}
                        {newerCount > 0 && (
                          <Typography
                            variant="caption"
                            sx={{ color: 'inherit', opacity: 0.9 }}
                            display="block"
                          >
                            {t('serversPage.fleet.newerVersion', { count: newerCount })}
                          </Typography>
                        )}
                      </Box>
                    );
                  })()}
                  {cs2UpdateInfo.outOfDate.length > 0 && (
                    <Box
                      sx={{
                        bgcolor: withAlpha(tokens.color.ban, 0.1),
                        border: 1,
                        borderColor: withAlpha(tokens.color.ban, 0.45),
                        borderRadius: `${tokens.radius.md}px`,
                        p: 2,
                        mt: 1.5,
                        color: 'text.primary',
                      }}
                    >
                      <Typography
                        variant="subtitle2"
                        fontWeight={800}
                        sx={{ color: 'inherit' }}
                        display="block"
                        mb={0.5}
                      >
                        🚨 {t('serversPage.cs2Update.fleetTitle')}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'inherit' }} display="block">
                        {t('serversPage.cs2Update.fleetBody', { count: cs2UpdateInfo.outOfDate.length })}
                      </Typography>
                      <Box mt={1} display="flex" gap={1} flexWrap="wrap">
                        {cs2UpdateInfo.versions.map((v) => (
                          <Chip
                            key={v}
                            label={`required_version=${v} (${cs2UpdateInfo.byVersion.get(v)?.length ?? 0})`}
                            color="error"
                            variant="outlined"
                            sx={{ fontWeight: 700 }}
                          />
                        ))}
                      </Box>
                    </Box>
                  )}
                  {versionInfo.hasMultipleVersions && (
                    <Box 
                      sx={{ 
                        bgcolor: (theme) => `${theme.palette.warning.main}14`, // 8% amber wash
                        border: 1, 
                        borderColor: 'warning.main',
                        borderRadius: 1, 
                        p: 1.5,
                        mt: 1
                      }}
                    >
                      <Typography variant="caption" fontWeight={600} color="warning.dark" display="block" mb={0.5}>
                        ⚠️ {t('serversPage.versionMismatch.title')}
                      </Typography>
                      <Box display="flex" gap={1} flexWrap="wrap">
                        {Array.from(versionInfo.versionCounts.entries()).map(([version, count]) => (
                          <Chip
                            key={version}
                            label={t('serversPage.versionMismatch.chip', { version, count })}
                            size="small"
                            color={version === versionInfo.mostCommonVersion ? 'success' : 'warning'}
                            variant="outlined"
                            sx={{ fontWeight: 500 }}
                          />
                        ))}
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                        {t('serversPage.versionMismatch.recommended', {
                          version: versionInfo.mostCommonVersion,
                        })}
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
              {sortedServers.map((server) => {
                const allocSnapshot = allocationStatus?.servers.find((s) => s.id === server.id);
                const inGraceWindow = !!allocSnapshot?.inGraceWindow;
                const secondsUntilReady = allocSnapshot?.secondsUntilReady ?? null;
                
                // Config sent via RCON but Auto Tournament CS2 hasn't sent events yet (lastSeen still null)
                const configSentWaitingForPlugin =
                  server.enabled && !server.lastSeen && !!server.persistentConfigSent;
                // Not initialized: we haven't sent config, or we don't know (no persistentConfigSent)
                const needsInitialization =
                  server.enabled && !server.lastSeen && !server.persistentConfigSent;
                const isChecking = statusCheckingIds.has(server.id);

                return (
                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={server.id}>
                <Card
                  data-testid={`server-card-${server.name.replace(/\s+/g, '-').toLowerCase()}`}
                  sx={() => {
                    const selected = selectedServerIds.has(server.id);
                    const ring = `0 0 0 2px ${tokens.color.accent}`;
                    return {
                      cursor: 'pointer',
                      borderColor: needsInitialization
                        ? 'error.main'
                        : configSentWaitingForPlugin
                        ? 'info.main'
                        : 'divider',
                      boxShadow: selected ? ring : undefined,
                      ...(selected && {
                        bgcolor: 'action.selected',
                      }),
                      '&:hover': {
                        bgcolor: selected ? 'action.selected' : 'var(--at-paper3)',
                        ...(selected && {
                          bgcolor: 'action.selected',
                        }),
                      },
                    };
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
                    {typeof server.cs2RequiredVersion === 'number' && server.enabled && (
                      <Box
                        sx={{
                          bgcolor: withAlpha(tokens.color.ban, 0.1),
                          border: 1,
                          borderColor: withAlpha(tokens.color.ban, 0.45),
                          borderRadius: `${tokens.radius.md}px`,
                          p: 1.5,
                          mb: 2,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          color: 'text.primary',
                          '& svg': { color: tokens.color.ban },
                        }}
                      >
                        <UpdateIcon
                          sx={{ color: 'inherit', fontSize: 20 }}
                          aria-label={t('serversPage.cs2Update.title')}
                        />
                        <Box flex={1}>
                          <Typography variant="body2" fontWeight={800} sx={{ color: 'inherit' }}>
                            {t('serversPage.cs2Update.title')}
                          </Typography>
                          <Typography
                            variant="caption"
                            display="block"
                            mt={0.25}
                            sx={{ color: 'inherit', opacity: 0.9 }}
                          >
                            required_version={server.cs2RequiredVersion}
                            {server.cs2UpdatePhase ? ` • phase=${server.cs2UpdatePhase}` : ''}
                          </Typography>
                        </Box>
                      </Box>
                    )}
                    {needsInitialization && (
                      <Box
                        sx={{
                          bgcolor: withAlpha(tokens.color.ban, 0.1),
                          border: 1,
                          borderColor: withAlpha(tokens.color.ban, 0.45),
                          borderRadius: `${tokens.radius.md}px`,
                          p: 1.5,
                          mb: 2,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          color: 'text.primary',
                          '& svg': { color: tokens.color.ban },
                        }}
                      >
                        <BlockIcon
                          sx={{ color: 'inherit', fontSize: 20 }}
                          aria-label={t('serversPage.notInitialized.title')}
                        />
                        <Box flex={1}>
                          <Typography variant="body2" fontWeight={600} sx={{ color: 'inherit' }}>
                            {t('serversPage.notInitialized.title')}
                          </Typography>
                          <Typography variant="caption" display="block" mt={0.25} sx={{ color: 'inherit', opacity: 0.9 }}>
                            {isChecking
                              ? t('serversPage.notInitialized.checking')
                              : server.reachableFromApi === false
                              ? t('serversPage.notInitialized.rconUnreachable')
                              : server.reachableFromApi === true
                              ? t('serversPage.notInitialized.noEvents')
                              : t('serversPage.notInitialized.notChecked')}
                          </Typography>
                          {!isChecking && server.reachableFromApi === true && (
                            <Typography variant="caption" display="block" mt={0.5} sx={{ color: 'inherit', opacity: 0.85 }}>
                              {t('serversPage.checkServerLogs')}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    )}
                    <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                      <Box flex={1} minWidth={0}>
                        <Box display="flex" alignItems="center" gap={1.25} mb={0.75}>
                          <StatusDot
                            state={
                              isChecking || configSentWaitingForPlugin
                                ? 'loading'
                                : !server.enabled || server.status === 'disabled'
                                ? 'free'
                                : needsInitialization ||
                                  (server.status !== 'online' && server.reachableFromApi === false)
                                ? 'error'
                                : server.currentMatch
                                ? 'live'
                                : 'free'
                            }
                          />
                          <Typography
                            variant="h6"
                            sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {server.name}
                          </Typography>
                        </Box>
                        <Box display="flex" gap={0.5} flexWrap="wrap">
                          {(() => {
                            const reachableFromApi = server.reachableFromApi;
                            const serverCanReachApi = server.serverCanReachApi;
                            const now = Math.floor(Date.now() / 1000);
                            const isHeartbeatActive = server.lastSeen && (now - server.lastSeen < 300); // 5 minutes
                            const isHeartbeatStale = !!server.lastSeen && !isHeartbeatActive;

                            let label: string;
                            let color: 'default' | 'success' | 'error' | 'warning' | 'info' =
                              'default';

                            if (isChecking) {
                              label = t('serversPage.statusChip.checking');
                              color = 'default';
                            } else if (!server.enabled || server.status === 'disabled') {
                              label = t('serversPage.statusChip.disabled');
                              color = 'default';
                            } else if (!server.lastSeen) {
                              label = server.persistentConfigSent
                                ? t('serversPage.statusChip.noEventsYet')
                                : t('serversPage.statusChip.notConfigured');
                              color = server.persistentConfigSent ? 'info' : 'error';
                            } else if (isHeartbeatStale && reachableFromApi === true) {
                              label = t('serversPage.statusChip.onlineIdle');
                              color = 'info';
                            } else if (server.status !== 'online' && reachableFromApi === false) {
                              // Reserve "Offline" for true reachability failure (or when backend marks it offline).
                              label = t('serversPage.statusChip.offline');
                              color = 'error';
                            } else if (reachableFromApi && serverCanReachApi) {
                              label = isHeartbeatActive
                                ? t('serversPage.statusChip.onlineActive')
                                : t('serversPage.statusChip.onlineOk');
                              color = 'success';
                            } else if (reachableFromApi && serverCanReachApi === false) {
                              label = t('serversPage.statusChip.onlineRconOnly');
                              color = 'warning';
                            } else if (reachableFromApi === false) {
                              label = t('serversPage.statusChip.rconFailed');
                              color = 'error';
                            } else {
                              label = t('serversPage.statusChip.online');
                              color = 'success';
                            }

                            const icon = isChecking ? (
                              <CircularProgress size={16} sx={{ color: 'text.secondary' }} />
                            ) : color === 'success' ? (
                              <CheckCircleIcon />
                            ) : color === 'warning' ? (
                              <RefreshIcon />
                            ) : server.status === 'disabled' || !server.enabled ? (
                              <BlockIcon />
                            ) : (
                              <CancelIcon />
                            );

                            let tooltip: React.ReactNode | null = null;
                            let tooltipHref: string | null = null;

                            if (!server.enabled || server.status === 'disabled') {
                              tooltip = (
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {t('serversPage.tooltips.disabledTitle')}
                                  </Typography>
                                  <Typography variant="body2">
                                    {t('serversPage.tooltips.disabledBody')}
                                  </Typography>
                                </Box>
                              );
                            } else if (!server.lastSeen) {
                              if (server.persistentConfigSent) {
                                tooltipHref = docs.offline;
                                tooltip = (
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                      {t('serversPage.tooltips.noEventsTitle')}
                                    </Typography>
                                    <Typography variant="body2">
                                      {t('serversPage.tooltips.noEventsBody')}
                                    </Typography>
                                    <Link
                                      href={tooltipHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      underline="hover"
                                      sx={{ display: 'inline-block', mt: 0.5 }}
                                    >
                                      {t('serversPage.tooltips.fixGuide')}
                                    </Link>
                                  </Box>
                                );
                              } else {
                                tooltip = (
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                      {t('serversPage.tooltips.notConfiguredTitle')}
                                    </Typography>
                                    <Typography variant="body2">
                                      {t('serversPage.tooltips.notConfiguredBody')}
                                    </Typography>
                                  </Box>
                                );
                              }
                            } else if (label === t('serversPage.statusChip.offline') || label === t('serversPage.statusChip.rconFailed')) {
                              tooltipHref = docs.offline;
                              tooltip = (
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {t('serversPage.tooltips.unreachableTitle')}
                                  </Typography>
                                  <Typography variant="body2">
                                    {t('serversPage.tooltips.unreachableBody')}
                                  </Typography>
                                  <Link
                                    href={tooltipHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    {t('serversPage.tooltips.fixGuide')}
                                  </Link>
                                </Box>
                              );
                            } else if (reachableFromApi && serverCanReachApi === false) {
                              tooltipHref = docs.offline;
                              tooltip = (
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {t('serversPage.tooltips.webhookTitle')}
                                  </Typography>
                                  <Typography variant="body2">
                                    {t('serversPage.tooltips.webhookBody')}
                                  </Typography>
                                  <Link
                                    href={tooltipHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    {t('serversPage.tooltips.fixGuide')}
                                  </Link>
                                </Box>
                              );
                            }

                            const chip = (
                              <Chip
                                icon={icon}
                                label={label}
                                size="small"
                                color={color}
                                sx={{ fontWeight: 600 }}
                              />
                            );

                            if (!tooltip) {
                              return chip;
                            }

                            return (
                              <Tooltip arrow title={tooltip}>
                                {chip}
                              </Tooltip>
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
                                  <Tooltip
                                    arrow
                                    title={
                                      <Box>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                          {t('serversPage.tooltips.versionDiffTitle')}
                                        </Typography>
                                        <Typography variant="body2">
                                          {t('serversPage.tooltips.versionDiffBody', {
                                            command: 'sudo csm update-plugins',
                                          })}
                                        </Typography>
                                        <Link
                                          href={docs.versionMismatch}
                                          target="_blank"
                                          rel="noreferrer"
                                          underline="hover"
                                          sx={{ display: 'inline-block', mt: 0.5 }}
                                        >
                                          {t('serversPage.tooltips.fixGuide')}
                                        </Link>
                                      </Box>
                                    }
                                  >
                                    <Chip
                                      label={t('serversPage.chips.versionMismatch')}
                                      size="small"
                                      color="warning"
                                      sx={{ fontWeight: 500 }}
                                    />
                                  </Tooltip>
                                )}
                            </>
                          )}
                          {server.ipBanned && server.enabled && (
                            <Tooltip
                              arrow
                              title={
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {t('serversPage.tooltips.ipBannedTitle')}
                                  </Typography>
                                  <Typography variant="body2">
                                    {t('serversPage.tooltips.ipBannedBody')}
                                  </Typography>
                                  <Link
                                    href={docs.ipBanned}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    {t('serversPage.tooltips.fixGuide')}
                                  </Link>
                                </Box>
                              }
                            >
                              <Chip
                                label={t('serversPage.chips.ipBanned')}
                                size="small"
                                color="error"
                                variant="outlined"
                                sx={{ fontWeight: 700 }}
                              />
                            </Tooltip>
                          )}
                          {typeof server.cs2BuildId === 'number' && server.enabled && (
                            <Chip
                              label={t('serversPage.chips.cs2Build', { build: server.cs2BuildId })}
                              size="small"
                              variant="outlined"
                              color="secondary"
                              sx={{ fontWeight: 600 }}
                            />
                          )}
                          {server.enabled && server.atDbOk === false && (
                            <Tooltip
                              arrow
                              title={
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {t('serversPage.tooltips.pluginDbTitle')}
                                  </Typography>
                                  <Typography variant="body2">
                                    {t('serversPage.tooltips.pluginDbBody', {
                                      path: 'sudo csm → Tools → Auto Tournament CS2 DB: verify/repair',
                                    })}
                                  </Typography>
                                  <Link
                                    href={docs.pluginDbDown}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    {t('serversPage.tooltips.fixGuide')}
                                  </Link>
                                </Box>
                              }
                            >
                              <Chip
                                label={t('serversPage.chips.pluginDbDown')}
                                size="small"
                                color="error"
                                sx={{ fontWeight: 800 }}
                              />
                            </Tooltip>
                          )}
                          {typeof server.cs2RequiredVersion === 'number' && server.enabled && (
                            <Tooltip
                              arrow
                              title={
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {t('serversPage.cs2Update.title')}
                                  </Typography>
                                  <Typography variant="body2">
                                    {t('serversPage.tooltips.cs2UpdateBody')}
                                  </Typography>
                                  <Link
                                    href={docs.cs2Outdated}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    {t('serversPage.tooltips.fixGuide')}
                                  </Link>
                                </Box>
                              }
                            >
                              <Chip
                                label={t('serversPage.chips.cs2UpdateRequired', {
                                  version: server.cs2RequiredVersion,
                                })}
                                size="small"
                                color="error"
                                sx={{ fontWeight: 700 }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      </Box>
                        <Tooltip title={t('serversPage.tooltips.retryInit')}>
                        <IconButton
                          size="small"
                          onClick={(e) => handleRetryInitialization(server.id, e)}
                          disabled={isChecking || retryingServerId === server.id || retryingAll}
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
                            <strong>{t('serversPage.labels.cs2Name')}</strong> {server.hostname}
                          </Typography>
                        </Box>
                      )}
                      {server.pluginVersion && (
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <UpdateIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                          <Typography variant="body2" color="text.secondary">
                            <strong>{t('serversPage.labels.plugin')}</strong> Auto Tournament CS2 v{server.pluginVersion}
                          </Typography>
                        </Box>
                      )}
                      {typeof server.cs2BuildId === 'number' && (
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <UpdateIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                          <Typography variant="body2" color="text.secondary">
                            <strong>CS2:</strong>{' '}
                            {t('serversPage.labels.cs2BuildValue', { build: server.cs2BuildId })}
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
                              timeStr = t('serversPage.lastActive.justNow');
                            } else if (minutesAgo < 60) {
                              timeStr = t('serversPage.lastActive.minutesAgo', { count: minutesAgo });
                            } else if (hoursAgo < 24) {
                              timeStr = t('serversPage.lastActive.hoursAgo', { count: hoursAgo });
                            } else {
                              timeStr = t('serversPage.lastActive.daysAgo', { count: daysAgo });
                            }
                            
                            const isActive = secondsAgo < 300; // 5 minutes
                            return (
                              <Box
                                component="span"
                                sx={{
                                  ...mono,
                                  color: isActive ? tokens.color.live : tokens.color.muted,
                                  fontWeight: isActive ? 600 : 400,
                                }}
                              >
                                {timeStr}
                              </Box>
                            );
                          })()}
                        </Typography>
                      )}
                    </Box>
                    {(server.reachableFromApi !== undefined || isChecking) && server.enabled && (
                      <Box display="flex" flexDirection="column" gap={0.5} mb={1}>
                        <Box display="flex" alignItems="center" gap={0.5}>
                          {isChecking ? (
                            <CircularProgress size={14} sx={{ color: 'text.disabled' }} />
                          ) : (
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
                          )}
                          <Typography variant="caption" color="text.secondary">
                            {t('serversPage.connectivity.apiToServer')}{' '}
                            <strong>
                              {isChecking
                                ? t('serversPage.connectivity.loading')
                                : server.reachableFromApi === false
                                ? t('serversPage.connectivity.unreachable')
                                : server.reachableFromApi
                                ? t('serversPage.connectivity.reachable')
                                : t('serversPage.connectivity.unknown')}
                            </strong>
                          </Typography>
                        </Box>
                        <Box display="flex" alignItems="center" gap={0.5}>
                          {isChecking ? (
                            <CircularProgress size={14} sx={{ color: 'text.disabled' }} />
                          ) : (
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
                          )}
                          <Typography variant="caption" color="text.secondary">
                            {t('serversPage.connectivity.serverToApi')}{' '}
                            <strong>
                              {isChecking
                                ? t('serversPage.connectivity.loading')
                                : server.serverCanReachApi === false
                                ? t('serversPage.connectivity.unreachable')
                                : server.serverCanReachApi
                                ? t('serversPage.connectivity.reachable')
                                : t('serversPage.connectivity.unknown')}
                            </strong>
                          </Typography>
                        </Box>
                        {!isChecking && server.pluginStatus && server.status === 'online' && (
                          <Box display="flex" alignItems="center" gap={0.5}>
                            <Typography variant="caption" color="text.secondary">
                              <strong>{t('serversPage.connectivity.pluginLabel')}</strong>{' '}
                              <Chip
                                label={t(`serversPage.pluginStatus.${server.pluginStatus}`, {
                                  defaultValue: server.pluginStatus,
                                }).toUpperCase()}
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

      <ConfirmDialog
        open={selectionMode && bulkDeleteConfirmOpen}
        title={t('serversPage.bulkDelete.title')}
        message={t('serversPage.bulkDelete.message', {
          count: selectedServerIds.size,
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
