import React, { useState, useEffect, useCallback } from 'react';
import { Box, Button, Typography, Chip, CircularProgress } from '@mui/material';
import { ArrowClockwiseIcon, HardDrivesIcon, PlusIcon } from '@phosphor-icons/react';
import ServerModal from '../servers/ServerModal';
import BatchServerModal from '../servers/BatchServerModal';
import { ServerRow } from '../servers/ServerRow';
import type {
  Server,
  ServersResponse,
  ServerStatusResponse,
  ServerMatchesResponse,
} from '../cs2.types';
import type { SnackbarKey } from 'notistack';
import {
  api,
  EmptyState,
  ConfirmDialog,
  ExternalLink,
  useSnackbar,
  openMatchDetails,
  tokens,
  withAlpha,
  useModuleTranslation,
  radii,
  PageHead,
  pageTitle,
  FactGrid,
  RowList,
  type Fact,
} from '../../../module-sdk';

export default function Servers() {
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
    document.title = pageTitle(t('serversPage.title'));
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

  const allSelected =
    servers.length > 0 && servers.every((server) => selectedServerIds.has(server.id));

  // The page's own actions, beside its title (the drafts' `.head`), once
  // there is a server; the empty state offers them itself.
  const headActions =
    servers.length === 0 ? null : (
      <>
        {!selectionMode && (
          <>
            <Button
              variant="outlined"
              size="small"
              startIcon={refreshing ? <CircularProgress size={20} /> : <ArrowClockwiseIcon size={24} />}
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
                    <ArrowClockwiseIcon size={24} />
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
              startIcon={<PlusIcon size={24} />}
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
            startIcon={<PlusIcon size={24} />}
            onClick={() => handleOpenModal()}
          >
            {t('serversPage.headerActions.addServer')}
          </Button>
        )}
      </>
    );

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
      const response = await api.get<ServerMatchesResponse>(
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

  // The fleet at a glance (the drafts' joined stat grid): what is up, what
  // is not, and what the allocator can hand out right now.
  const fleetFacts: Fact[] = [
    { key: 'online', label: t('serversPage.strip.online'), value: serverStats.online },
    { key: 'offline', label: t('serversPage.strip.offline'), value: serverStats.offline },
    ...(serverStats.notConfigured > 0
      ? [{ key: 'notConfigured', label: t('serversPage.strip.notConfigured'), value: serverStats.notConfigured }]
      : []),
    ...(serverStats.disabled > 0
      ? [{ key: 'disabled', label: t('serversPage.strip.disabled'), value: serverStats.disabled }]
      : []),
    {
      key: 'free',
      label: t('serversPage.strip.free'),
      value: allocationStatus
        ? `${allocationStatus.availableServerCount} / ${allocationStatus.servers.length}`
        : '—',
    },
    {
      key: 'waiting',
      label: t('serversPage.strip.waiting'),
      value: allocationStatus ? allocationStatus.requiredServerCount : '—',
    },
  ];

  // Servers behind the latest plugin release. A build newer than the latest
  // release is an unreleased one and needs nothing from the admin, so it is
  // not flagged.
  const olderPluginCount = (() => {
    if (!latestPluginVersion) return 0;
    return servers.filter((server) => {
      if (!server.pluginVersion) return false;
      const comparison = compareDottedVersions(server.pluginVersion, latestPluginVersion);
      return typeof comparison === 'number' && comparison < 0;
    }).length;
  })();

  /** A tinted notice box above the list, for what needs the admin across servers. */
  const noticeSx = (color: string) => ({
    bgcolor: withAlpha(color, 0.1),
    border: `1px solid ${withAlpha(color, 0.45)}`,
    borderRadius: radii.md,
    p: 2,
  });

  return (
    <Box data-testid="servers-page" sx={{ width: '100%', height: '100%' }}>
      <PageHead
        title={t('serversPage.title')}
        subtitle={t('serversPage.fleet.total', { count: serverStats.total })}
        actions={headActions}
      />
      {servers.length === 0 ? (
          <Box>
            <EmptyState
              icon={HardDrivesIcon}
              title={t('serversPage.empty.title')}
              description={t('serversPage.empty.description')}
              actionLabel={t('serversPage.empty.addServer')}
              actionIcon={PlusIcon}
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
            <FactGrid
              items={fleetFacts}
              aria-label={t('serversPage.fleet.title')}
              data-testid="servers-fleet-strip"
              sx={{ mb: allocationStatus?.nextAllocationInSeconds != null ? 1 : 3 }}
            />
            {allocationStatus?.nextAllocationInSeconds != null && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('serversPage.allocation.nextPass', {
                  seconds: allocationStatus.nextAllocationInSeconds,
                })}
              </Typography>
            )}
            {!allocationStatus && allocationLoading && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: -2, mb: 3 }}>
                {t('serversPage.allocation.loading')}
              </Typography>
            )}

            {(cs2UpdateInfo.outOfDate.length > 0 || olderPluginCount > 0 || versionInfo.hasMultipleVersions) && (
              <Box sx={{ display: 'grid', gap: 1.5, mb: 3 }}>
                {cs2UpdateInfo.outOfDate.length > 0 && (
                  <Box sx={noticeSx(tokens.color.ban)} data-testid="servers-cs2-update-notice">
                    <Typography variant="body2" fontWeight={700}>
                      {t('serversPage.cs2Update.fleetTitle')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('serversPage.cs2Update.fleetBody', { count: cs2UpdateInfo.outOfDate.length })}
                    </Typography>
                    <Box mt={1} display="flex" gap={1} flexWrap="wrap">
                      {cs2UpdateInfo.versions.map((v) => (
                        <Chip
                          key={v}
                          size="small"
                          label={`required_version=${v} (${cs2UpdateInfo.byVersion.get(v)?.length ?? 0})`}
                          sx={{ color: tokens.color.ban }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}
                {olderPluginCount > 0 && latestPluginVersion && (
                  <Box sx={noticeSx(tokens.color.warning)}>
                    <Typography variant="body2" fontWeight={700}>
                      {t('serversPage.fleet.latestRelease', { version: latestPluginVersion })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('serversPage.fleet.olderVersion', { count: olderPluginCount })}{' '}
                      <ExternalLink
                        href={latestPluginReleaseUrl ?? 'https://github.com/Auto-Tournament/cs2-plugin/releases'}
                        sx={{ color: 'inherit', textDecoration: 'underline' }}
                      >
                        {t('serversPage.fleet.downloadLatest')}
                      </ExternalLink>
                    </Typography>
                  </Box>
                )}
                {versionInfo.hasMultipleVersions && (
                  <Box sx={noticeSx(tokens.color.warning)}>
                    <Typography variant="body2" fontWeight={700}>
                      {t('serversPage.versionMismatch.title')}
                    </Typography>
                    <Box display="flex" gap={1} flexWrap="wrap" my={0.5}>
                      {Array.from(versionInfo.versionCounts.entries()).map(([version, count]) => (
                        <Chip
                          key={version}
                          label={t('serversPage.versionMismatch.chip', { version, count })}
                          size="small"
                          sx={{
                            color:
                              version === versionInfo.mostCommonVersion ? tokens.color.live : tokens.color.warning,
                          }}
                        />
                      ))}
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('serversPage.versionMismatch.recommended', {
                        version: versionInfo.mostCommonVersion,
                      })}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}

            <RowList data-testid="servers-list" aria-label={t('serversPage.title')}>
              {sortedServers.map((server) => (
                <ServerRow
                  key={server.id}
                  server={server}
                  allocation={allocationStatus?.servers.find((s) => s.id === server.id)}
                  isChecking={statusCheckingIds.has(server.id)}
                  selectionMode={selectionMode}
                  selected={selectedServerIds.has(server.id)}
                  retrying={retryingServerId === server.id}
                  retryDisabled={statusCheckingIds.has(server.id) || retryingAll}
                  loadingMatch={loadingMatchServerId === server.id}
                  mostCommonVersion={versionInfo.mostCommonVersion}
                  hasMultipleVersions={versionInfo.hasMultipleVersions}
                  onToggleSelected={() => toggleServerSelected(server.id)}
                  onEdit={() => handleOpenModal(server)}
                  onRetry={(event) => void handleRetryInitialization(server.id, event)}
                  onViewMatch={(event) => void handleViewCurrentMatch(server, event)}
                />
              ))}
            </RowList>
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
