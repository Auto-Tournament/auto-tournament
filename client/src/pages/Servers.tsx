import React, { useState, useEffect, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { Box, Button, Card, CardContent, Typography, Grid, Chip, CircularProgress } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StorageIcon from '@mui/icons-material/Storage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RefreshIcon from '@mui/icons-material/Refresh';
import BlockIcon from '@mui/icons-material/Block';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { api } from '../utils/api';
import ServerModal from '../components/modals/ServerModal';
import BatchServerModal from '../components/modals/BatchServerModal';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import type { Match, Server, ServersResponse, ServerStatusResponse, MatchesResponse } from '../types';
import { useSnackbar } from '../contexts/SnackbarContext';
import { getRoundLabel } from '../utils/matchUtils';

export default function Servers() {
  const { setHeaderActions } = usePageHeader();
  const [servers, setServers] = useState<Server[]>([]);
  const { showError } = useSnackbar();
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
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Servers';
  }, []);

  const checkServerStatus = async (
    serverId: string
  ): Promise<{
    status: 'online' | 'offline';
    currentMatch: string | null;
    queuedMatch?: string | null;
    reachableFromApi?: boolean;
    serverCanReachApi?: boolean;
    pluginStatus?: string | null;
    allocationState?: string | null;
    allocationMatchSlug?: string | null;
  }> => {
    try {
      // Use the lightweight cached status endpoint for the Servers page so we
      // don't spam live connectivity checks or show flapping statuses. Manual
      // "Test Connection" in the server modal still calls the uncached route.
      const response = await api.get<ServerStatusResponse>(
        `/api/servers/${serverId}/status?cached=true`
      );
      const isOnline = response.status === 'online';
      return {
        status: isOnline ? 'online' : ('offline' as const),
        currentMatch: response.currentMatch ?? null,
        reachableFromApi: response.reachableFromApi,
        serverCanReachApi: response.serverCanReachApi,
        pluginStatus: response.pluginStatus ?? null,
        allocationState: response.allocationState ?? null,
        allocationMatchSlug: response.allocationMatchSlug ?? null,
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
      };
    }
  };

  const loadServers = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await api.get<ServersResponse>('/api/servers');
      const serverList = response.servers || [];

      // Set initial status - disabled servers get 'disabled', others get 'checking'
      const serversWithStatus = serverList.map((s: Server) => ({
        ...s,
        status: s.enabled ? ('checking' as const) : ('disabled' as const),
      }));
      setServers(serversWithStatus);

      // Check status only for enabled servers
      const enabledServers = serverList.filter((s) => s.enabled);
      const statusPromises = enabledServers.map(async (server: Server) => {
        const {
          status,
          currentMatch,
          queuedMatch,
          reachableFromApi,
          serverCanReachApi,
          pluginStatus,
          allocationState,
          allocationMatchSlug,
        } = await checkServerStatus(server.id);
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
        };
      });

      const statuses = await Promise.all(statusPromises);

      // Update servers with actual status (only enabled servers)
      setServers((prev) =>
        prev.map((server) => {
          if (!server.enabled) {
            return { ...server, status: 'disabled' as const };
          }
          const statusInfo = statuses.find((s) => s.id === server.id);
          const nextQueuedMatch =
            statusInfo?.queuedMatch !== undefined
              ? statusInfo.queuedMatch
              : (server as Server & { queuedMatch?: string | null }).queuedMatch ?? null;

          return {
            ...server,
            status: statusInfo?.status || 'offline',
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
      showError('Failed to load servers');
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  }, [showError]);

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
      }>('/api/tournament/server-availability');

      if (availability.success) {
        setAllocationStatus({
          availableServerCount: availability.availableServerCount,
          requiredServerCount: availability.requiredServerCount,
          gracePeriodSeconds: availability.gracePeriodSeconds ?? 300,
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
                  void loadServers();
                  void loadAllocationStatus();
                }}
                disabled={refreshing}
              >
                {refreshing ? 'Checking...' : 'Refresh Status'}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setBatchModalOpen(true)}
              >
                Batch Add
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
                {selectionMode ? 'Done Selecting' : 'Select'}
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
                    {allSelected ? 'Unselect All' : 'Select All'}
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
                    Delete Selected
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
              Add Server
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
    servers.length,
    refreshing,
    setHeaderActions,
    loadServers,
    loadAllocationStatus,
    selectionMode,
    selectedServerIds,
  ]);

  useEffect(() => {
    void loadServers();
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
    await loadServers();
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

  return (
    <Box data-testid="servers-page" sx={{ width: '100%', height: '100%' }}>
      {servers.length === 0 ? (
          <Box>
            <EmptyState
              icon={StorageIcon}
              title="No servers registered"
              description="Add your first CS2 server to get started with the tournament"
              actionLabel="Add Server"
              actionIcon={AddIcon}
              onAction={() => handleOpenModal()}
            />
            <Box display="flex" justifyContent="center" mt={2}>
              <Button variant="outlined" onClick={() => setBatchModalOpen(true)}>
                Or Batch Add Multiple Servers
              </Button>
            </Box>
          </Box>
        ) : (
          <>
            <Box mb={2}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                    Server allocation
                  </Typography>
                  {!allocationStatus ? (
                    <Typography variant="body2" color="text.secondary">
                      {allocationLoading
                        ? 'Loading allocation status...'
                        : 'No allocation data available.'}
                    </Typography>
                  ) : (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Available servers:</strong>{' '}
                        {allocationStatus.availableServerCount} / {allocationStatus.servers.length}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Matches waiting for servers:</strong>{' '}
                        {allocationStatus.requiredServerCount}
                      </Typography>
                      {allocationStatus.nextAllocationInSeconds !== null && (
                        <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                          Next allocator pass in ~{allocationStatus.nextAllocationInSeconds}s
                        </Typography>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </Box>

            <Grid container spacing={2}>
              {servers.map((server) => (
                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={server.id}>
                <Card
                  data-testid={`server-card-${server.name.replace(/\s+/g, '-').toLowerCase()}`}
                  sx={{
                    cursor: 'pointer',
                    transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
                    border: selectedServerIds.has(server.id) ? 2 : 0,
                    borderRadius: 2,
                    borderStyle: 'solid',
                    borderColor: selectedServerIds.has(server.id)
                      ? 'primary.main'
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
                    <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                      <Box>
                        <Typography variant="h6" fontWeight={600} gutterBottom>
                          {server.name}
                        </Typography>
                        {(() => {
                          const reachableFromApi = server.reachableFromApi;
                          const serverCanReachApi = server.serverCanReachApi;

                          let label: string;
                          let color: 'default' | 'success' | 'error' | 'warning' | 'info' =
                            'default';

                          if (server.status === 'checking') {
                            label = 'Checking...';
                            color = 'default';
                          } else if (!server.enabled || server.status === 'disabled') {
                            label = 'Disabled';
                            color = 'default';
                          } else if (server.status !== 'online') {
                            label = 'Offline';
                            color = 'error';
                          } else if (reachableFromApi && serverCanReachApi) {
                            label = 'Online (API ↔ Server OK)';
                            color = 'success';
                          } else if (reachableFromApi && serverCanReachApi === false) {
                            label = 'Online (RCON only)';
                            color = 'warning';
                          } else if (reachableFromApi === false) {
                            label = 'RCON failed';
                            color = 'error';
                          } else {
                            label = 'Online (testing)';
                            color = 'info';
                          }

                          const icon =
                            server.status === 'checking' ? (
                              <CircularProgress size={16} />
                            ) : color === 'success' ? (
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
                      </Box>
                      {/* Clicking the card already opens the edit modal, so no separate Edit button needed */}
                    </Box>

                    <Box display="flex" flexDirection="column" gap={0.5} mb={2}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        data-testid="server-host"
                      >
                        <strong>Host:</strong> {server.host}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Port:</strong> {server.port}
                      </Typography>
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
                            API → Server (RCON){' '}
                            <strong>
                              {server.reachableFromApi === false
                                ? 'Unreachable'
                                : server.reachableFromApi
                                ? 'Reachable'
                                : 'Unknown'}
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
                            Server → API (/api/events){' '}
                            <strong>
                              {server.serverCanReachApi === false
                                ? 'Unreachable'
                                : server.serverCanReachApi
                                ? 'Reachable'
                                : 'Unknown'}
                            </strong>
                          </Typography>
                        </Box>
                        {server.pluginStatus && (
                          <Box display="flex" alignItems="center" gap={0.5}>
                            <Typography variant="caption" color="text.secondary">
                              <strong>MatchZy:</strong>{' '}
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
                          {loadingMatchServerId === server.id ? 'Loading...' : 'View Match'}
                        </Button>
                          </Box>
                        )}
                        {(server as Server & { queuedMatch?: string | null }).queuedMatch && (
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Chip
                              label={`Queued: ${(server as Server & { queuedMatch?: string | null }).queuedMatch}`}
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
                      ID: {server.id}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              ))}
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
        title="Delete Servers"
        message={`Are you sure you want to delete ${selectedServerIds.size} server${
          selectedServerIds.size === 1 ? '' : 's'
        }? This action cannot be undone.`}
        confirmLabel="Delete"
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
            showError('Failed to delete one or more servers');
          } finally {
            setBulkDeleteConfirmOpen(false);
          }
        }}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />
    </Box>
  );
}
