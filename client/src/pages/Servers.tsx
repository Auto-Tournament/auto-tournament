import React, { useState, useEffect, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
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
import type { SnackbarKey } from 'notistack';

export default function Servers() {
  const { setHeaderActions } = usePageHeader();
  const [servers, setServers] = useState<Server[]>([]);
  const { showError, showSnackbar, showPersistentError, closeSnackbar } = useSnackbar();
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
  const [retryingAll, setRetryingAll] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [statusCheckingIds, setStatusCheckingIds] = useState<Set<string>>(() => new Set());
  const [latestMatchZyVersion, setLatestMatchZyVersion] = useState<string | null>(null);
  const [latestMatchZyReleaseUrl, setLatestMatchZyReleaseUrl] = useState<string | null>(null);
  const [cs2OutdatedSnackbarKey, setCs2OutdatedSnackbarKey] = useState<SnackbarKey | null>(null);
  const { t } = useTranslation();

  const docs = {
    fleetHealth: '/docs/mat/user/fleet-health',
    pluginDbDown: '/docs/mat/user/fleet-health#plugin-db-down',
    cs2Outdated: '/docs/mat/user/fleet-health#cs2-update-required',
    offline: '/docs/mat/user/fleet-health#server-offline-or-unreachable',
    ipBanned: '/docs/mat/user/fleet-health#ip-banned-rcon',
    versionMismatch: '/docs/mat/user/fleet-health#plugin-version-mismatch',
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
      // "API can reach server" / "server can reach API" even when MatchZy hasn't sent events yet.
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
      `⏳ Retrying initialization for ${needRetry.length} server(s)...`,
      'info'
    );

    try {
      for (const server of needRetry) {
        await api.post(`/api/servers/${server.id}/reset-initialization`);
        await new Promise((r) => setTimeout(r, 500));
      }
      closeSnackbar(loadingKey);
      showSnackbar(`✅ Retry triggered for ${needRetry.length} server(s)`, 'success');
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
      showError(`❌ Retry failed: ${msg}`);
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
    
    // Fetch latest MatchZy Enhanced version from GitHub
    api
      .get<{ success: boolean; version?: string; releaseUrl?: string }>('/api/matchzy/latest-version')
      .then((response) => {
        if (response.success && response.version) {
          setLatestMatchZyVersion(response.version);
          setLatestMatchZyReleaseUrl(response.releaseUrl ?? null);
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
            🚨 <strong>CS2 update required</strong> — {outdatedEnabledServers.length}{' '}
            {outdatedEnabledServers.length === 1 ? 'server is' : 'servers are'} out of date. Update
            the server installation and restart.
          </span>,
          'cs2-update-required'
        );
        setCs2OutdatedSnackbarKey(key);
      }
    } else if (cs2OutdatedSnackbarKey) {
      closeSnackbar(cs2OutdatedSnackbarKey);
      setCs2OutdatedSnackbarKey(null);
    }
  }, [servers, cs2OutdatedSnackbarKey, showPersistentError, closeSnackbar]);

  const handleOpenModal = (server?: Server) => {
    setEditingServer(server || null);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingServer(null);
  };

  const handleSave = async (createdIds?: string[]) => {
    await loadServers({ useCached: false });
    if (createdIds?.length) {
      const key = showSnackbar(`⏳ ${t('serversPage.autoConfig.configuring')}`, 'info');
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
    event.stopPropagation();
    if (retryingServerId || retryingAll || statusCheckingIds.has(serverId)) return;

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
      showError(`❌ Failed to retry initialization: ${msg}`);
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
                  {(() => {
                    if (!latestMatchZyVersion) return null;
                    const serversWithVersion = servers.filter((s) => s.pluginVersion);
                    const comparisons = serversWithVersion
                      .map((s) => {
                        const v = s.pluginVersion;
                        if (!v) return null;
                        return compareDottedVersions(v, latestMatchZyVersion);
                      })
                      .filter((x): x is number => typeof x === 'number');

                    const olderCount = comparisons.filter((c) => c < 0).length;
                    const newerCount = comparisons.filter((c) => c > 0).length;
                    if (olderCount === 0 && newerCount === 0) return null;

                    const boxColor = olderCount > 0 ? 'warning' : 'info';
                    const releaseHref =
                      latestMatchZyReleaseUrl ??
                      'https://github.com/sivert-io/MatchZy-Enhanced/releases';

                    return (
                      <Box
                        sx={{
                          bgcolor: `${boxColor}.light`,
                          border: 1,
                          borderColor: `${boxColor}.main`,
                          borderRadius: 1,
                          p: 1.5,
                          mt: 1,
                          color: 'grey.900',
                        }}
                      >
                        <Typography
                          variant="caption"
                          fontWeight={600}
                          sx={{ color: 'inherit' }}
                          display="block"
                          mb={0.5}
                        >
                          ℹ️ Latest released MatchZy Enhanced: v{latestMatchZyVersion}
                        </Typography>
                        {olderCount > 0 && (
                          <Typography variant="caption" sx={{ color: 'inherit' }} display="block">
                            {olderCount} {olderCount === 1 ? 'server is' : 'servers are'} running an older version than the latest release.{' '}
                            <a href={releaseHref} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                              Download latest
                            </a>
                          </Typography>
                        )}
                        {newerCount > 0 && (
                          <Typography
                            variant="caption"
                            sx={{ color: 'inherit', opacity: 0.9 }}
                            display="block"
                          >
                            {newerCount} {newerCount === 1 ? 'server is' : 'servers are'} running a newer version than the latest GitHub release (likely an unreleased build).
                          </Typography>
                        )}
                      </Box>
                    );
                  })()}
                  {cs2UpdateInfo.outOfDate.length > 0 && (
                    <Box
                      sx={{
                        bgcolor: 'error.light',
                        border: 2,
                        borderColor: 'error.main',
                        borderRadius: 2,
                        p: 2,
                        mt: 1.5,
                        color: 'grey.900',
                      }}
                    >
                      <Typography
                        variant="subtitle2"
                        fontWeight={800}
                        sx={{ color: 'inherit' }}
                        display="block"
                        mb={0.5}
                      >
                        🚨 CS2 servers out of date — update required
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'inherit' }} display="block">
                        {cs2UpdateInfo.outOfDate.length}{' '}
                        {cs2UpdateInfo.outOfDate.length === 1 ? 'server has' : 'servers have'} reported a required CS2
                        update from Steam. Update the server installation (SteamCMD/host) and restart.
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
              {sortedServers.map((server) => {
                const allocSnapshot = allocationStatus?.servers.find((s) => s.id === server.id);
                const inGraceWindow = !!allocSnapshot?.inGraceWindow;
                const secondsUntilReady = allocSnapshot?.secondsUntilReady ?? null;
                
                // Config sent via RCON but MatchZy hasn't sent events yet (lastSeen still null)
                const configSentWaitingForMatchzy =
                  server.enabled && !server.lastSeen && !!server.persistentConfigSent;
                // Not initialized: we haven't sent config, or we don't know (no persistentConfigSent)
                const needsInitialization =
                  server.enabled && !server.lastSeen && !server.persistentConfigSent;
                const isChecking = statusCheckingIds.has(server.id);

                return (
                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={server.id}>
                <Card
                  data-testid={`server-card-${server.name.replace(/\s+/g, '-').toLowerCase()}`}
                  sx={(theme) => {
                    const selected = selectedServerIds.has(server.id);
                    const ring = `0 0 0 2px ${theme.palette.primary.main}`;
                    const hoverShadow = selected
                      ? `${ring}, ${theme.shadows[6]}`
                      : theme.shadows[6];
                    return {
                      cursor: 'pointer',
                      transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s, background-color 0.2s',
                      border:
                        needsInitialization || configSentWaitingForMatchzy ? 2 : 0,
                      borderRadius: 2,
                      borderStyle: 'solid',
                      borderColor: needsInitialization
                        ? 'error.main'
                        : configSentWaitingForMatchzy
                        ? 'info.main'
                        : 'transparent',
                      boxShadow: selected ? ring : undefined,
                      ...(selected && {
                        bgcolor: 'action.selected',
                      }),
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: hoverShadow,
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
                          bgcolor: 'error.light',
                          border: 2,
                          borderColor: 'error.main',
                          borderRadius: 1,
                          p: 1.5,
                          mb: 2,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          color: 'grey.900',
                        }}
                      >
                        <UpdateIcon sx={{ color: 'inherit', fontSize: 20 }} aria-label="CS2 update required" />
                        <Box flex={1}>
                          <Typography variant="body2" fontWeight={800} sx={{ color: 'inherit' }}>
                            CS2 update required
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
                          bgcolor: 'error.light',
                          border: 1,
                          borderColor: 'error.main',
                          borderRadius: 1,
                          p: 1.5,
                          mb: 2,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          color: 'grey.900',
                        }}
                      >
                        <BlockIcon sx={{ color: 'inherit', fontSize: 20 }} aria-label="Warning" />
                        <Box flex={1}>
                          <Typography variant="body2" fontWeight={600} sx={{ color: 'inherit' }}>
                            Server Not Initialized
                          </Typography>
                          <Typography variant="caption" display="block" mt={0.25} sx={{ color: 'inherit', opacity: 0.9 }}>
                            {isChecking
                              ? "Checking connectivity…"
                              : server.reachableFromApi === false
                              ? "RCON unreachable. Check host, port, and that the game server is running. Use Retry once it's reachable."
                              : server.reachableFromApi === true
                              ? "RCON reachable, but MatchZy hasn't sent events. Click retry button to configure."
                              : "Connectivity not checked yet. See status below. Click retry to configure once RCON is reachable."}
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
                                ? 'No events yet'
                                : 'Not Configured';
                              color = server.persistentConfigSent ? 'info' : 'error';
                            } else if (isHeartbeatStale && reachableFromApi === true) {
                              label = 'Online (Idle — no recent events)';
                              color = 'info';
                            } else if (server.status !== 'online' && reachableFromApi === false) {
                              // Reserve "Offline" for true reachability failure (or when backend marks it offline).
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
                                    Disabled server
                                  </Typography>
                                  <Typography variant="body2">
                                    Disabled servers are ignored by allocation and health checks.
                                  </Typography>
                                </Box>
                              );
                            } else if (!server.lastSeen) {
                              if (server.persistentConfigSent) {
                                tooltipHref = docs.offline;
                                tooltip = (
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                      No MatchZy events received yet
                                    </Typography>
                                    <Typography variant="body2">
                                      MAT sent webhook config via RCON, but hasn’t received any events. This usually means the
                                      server can’t reach the MAT webhook URL, or MatchZy isn’t running.
                                    </Typography>
                                    <Link
                                      href={tooltipHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      underline="hover"
                                      sx={{ display: 'inline-block', mt: 0.5 }}
                                    >
                                      Fix guide
                                    </Link>
                                  </Box>
                                );
                              } else {
                                tooltip = (
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                      Not configured
                                    </Typography>
                                    <Typography variant="body2">
                                      MAT hasn’t sent persistent config to this server yet. Use <strong>Retry</strong> to
                                      initialize it.
                                    </Typography>
                                  </Box>
                                );
                              }
                            } else if (label === t('serversPage.statusChip.offline') || label === t('serversPage.statusChip.rconFailed')) {
                              tooltipHref = docs.offline;
                              tooltip = (
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    Server unreachable from MAT
                                  </Typography>
                                  <Typography variant="body2">
                                    MAT can’t reach the server via RCON. Check host/port, RCON password, firewall, and that
                                    the server is running.
                                  </Typography>
                                  <Link
                                    href={tooltipHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    Fix guide
                                  </Link>
                                </Box>
                              );
                            } else if (reachableFromApi && serverCanReachApi === false) {
                              tooltipHref = docs.offline;
                              tooltip = (
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    Server can’t reach MAT (webhook)
                                  </Typography>
                                  <Typography variant="body2">
                                    MAT can reach the server via RCON, but the server can’t reach MAT’s webhook. Check egress,
                                    DNS, and the configured webhook URL.
                                  </Typography>
                                  <Link
                                    href={tooltipHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    Fix guide
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
                                          Plugin versions differ across servers
                                        </Typography>
                                        <Typography variant="body2">
                                          Some servers are running a different MatchZy Enhanced version. If you use CSM, run{' '}
                                          <strong>sudo csm update-plugins</strong> and restart servers.
                                        </Typography>
                                        <Link
                                          href={docs.versionMismatch}
                                          target="_blank"
                                          rel="noreferrer"
                                          underline="hover"
                                          sx={{ display: 'inline-block', mt: 0.5 }}
                                        >
                                          Fix guide
                                        </Link>
                                      </Box>
                                    }
                                  >
                                    <Chip
                                      label="Version Mismatch"
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
                                    RCON IP banned
                                  </Typography>
                                  <Typography variant="body2">
                                    The server has temporarily banned MAT’s IP due to repeated RCON auth failures. Fix the RCON
                                    password and unban the IP.
                                  </Typography>
                                  <Link
                                    href={docs.ipBanned}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    Fix guide
                                  </Link>
                                </Box>
                              }
                            >
                              <Chip
                                label="IP Banned"
                                size="small"
                                color="error"
                                variant="outlined"
                                sx={{ fontWeight: 700 }}
                              />
                            </Tooltip>
                          )}
                          {typeof server.cs2BuildId === 'number' && server.enabled && (
                            <Chip
                              label={`CS2 build ${server.cs2BuildId}`}
                              size="small"
                              variant="outlined"
                              color="secondary"
                              sx={{ fontWeight: 600 }}
                            />
                          )}
                          {server.enabled && server.matchzyDbOk === false && (
                            <Tooltip
                              arrow
                              title={
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    MatchZy plugin can’t reach its database.
                                  </Typography>
                                  <Typography variant="body2">
                                    If you use CSM: run <strong>sudo csm</strong> → Tools →{' '}
                                    <strong>MatchZy DB: verify/repair</strong>.
                                  </Typography>
                                  <Link
                                    href={docs.pluginDbDown}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    Fix guide
                                  </Link>
                                </Box>
                              }
                            >
                              <Chip
                                label="Plugin DB DOWN"
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
                                    CS2 update required
                                  </Typography>
                                  <Typography variant="body2">
                                    MAT verified this server’s build is behind Steam. It will be blocked from new allocations
                                    (and tournament start) until updated.
                                  </Typography>
                                  <Link
                                    href={docs.cs2Outdated}
                                    target="_blank"
                                    rel="noreferrer"
                                    underline="hover"
                                    sx={{ display: 'inline-block', mt: 0.5 }}
                                  >
                                    Fix guide
                                  </Link>
                                </Box>
                              }
                            >
                              <Chip
                                label={`CS2 update required (${server.cs2RequiredVersion})`}
                                size="small"
                                color="error"
                                sx={{ fontWeight: 700 }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      </Box>
                        <Tooltip title="Retry server initialization (send persistent config via RCON)">
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
                      {typeof server.cs2BuildId === 'number' && (
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <UpdateIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                          <Typography variant="body2" color="text.secondary">
                            <strong>CS2:</strong> build {server.cs2BuildId}
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
