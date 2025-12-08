import React, { useState, useEffect, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  IconButton,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StorageIcon from '@mui/icons-material/Storage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RefreshIcon from '@mui/icons-material/Refresh';
import BlockIcon from '@mui/icons-material/Block';
import { api } from '../utils/api';
import ServerModal from '../components/modals/ServerModal';
import BatchServerModal from '../components/modals/BatchServerModal';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
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

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Servers';
  }, []);

  const checkServerStatus = async (
    serverId: string
  ): Promise<{ status: 'online' | 'offline'; currentMatch: string | null }> => {
    try {
      const response = await api.get<ServerStatusResponse>(`/api/servers/${serverId}/status`);
      const isOnline = response.status === 'online';
      return {
        status: isOnline ? 'online' : ('offline' as const),
        currentMatch: response.currentMatch ?? null,
      };
    } catch {
      return { status: 'offline', currentMatch: null };
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
        const { status, currentMatch } = await checkServerStatus(server.id);
        return { id: server.id, status, currentMatch };
      });

      const statuses = await Promise.all(statusPromises);

      // Update servers with actual status (only enabled servers)
      setServers((prev) =>
        prev.map((server) => {
          if (!server.enabled) {
            return { ...server, status: 'disabled' as const };
          }
          const statusInfo = statuses.find((s) => s.id === server.id);
          return {
            ...server,
            status: statusInfo?.status || 'offline',
            currentMatch:
              statusInfo?.currentMatch !== undefined
                ? statusInfo.currentMatch
                : server.currentMatch ?? null,
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

  // Set header actions
  useEffect(() => {
    if (servers.length > 0) {
      setHeaderActions(
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={refreshing ? <CircularProgress size={20} /> : <RefreshIcon />}
            onClick={loadServers}
            disabled={refreshing}
          >
            {refreshing ? 'Checking...' : 'Refresh Status'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setBatchModalOpen(true)}
          >
            Batch Add
          </Button>
          <Button
            data-testid="add-server-button"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenModal()}
          >
            Add Server
          </Button>
        </Box>
      );
    } else {
      setHeaderActions(null);
    }

    return () => {
      setHeaderActions(null);
    };
  }, [servers.length, refreshing, setHeaderActions, loadServers]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

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
          <Grid container spacing={2}>
            {servers.map((server) => (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 4 }} key={server.id}>
                <Card
                  data-testid={`server-card-${server.name.replace(/\s+/g, '-').toLowerCase()}`}
                  sx={{
                    cursor: 'pointer',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: 6,
                    },
                  }}
                  onClick={() => handleOpenModal(server)}
                >
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                      <Box>
                        <Typography variant="h6" fontWeight={600} gutterBottom>
                          {server.name}
                        </Typography>
                        <Chip
                          icon={
                            server.status === 'checking' ? (
                              <CircularProgress size={16} />
                            ) : server.status === 'online' ? (
                              <CheckCircleIcon />
                            ) : server.status === 'disabled' ? (
                              <BlockIcon />
                            ) : (
                              <CancelIcon />
                            )
                          }
                          label={
                            server.status === 'checking'
                              ? 'Checking...'
                              : server.status === 'online'
                              ? 'Online'
                              : server.status === 'disabled'
                              ? 'Disabled'
                              : 'Offline'
                          }
                          size="small"
                          color={
                            server.status === 'checking'
                              ? 'default'
                              : server.status === 'online'
                              ? 'success'
                              : server.status === 'disabled'
                              ? 'default'
                              : 'error'
                          }
                          sx={{ fontWeight: 600 }}
                        />
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
                      <Typography variant="body2" color="text.secondary">
                        <strong>Current match:</strong>{' '}
                        {server.currentMatch && server.status === 'online'
                          ? server.currentMatch
                          : 'None'}
                      </Typography>
                    </Box>

                    {server.currentMatch && server.status === 'online' && (
                      <Box display="flex" justifyContent="flex-end" mt={1}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(event) => handleViewCurrentMatch(server, event)}
                          disabled={loadingMatchServerId === server.id}
                        >
                          {loadingMatchServerId === server.id ? 'Loading match...' : 'View Match'}
                        </Button>
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
      />

      {selectedMatch && (
        <MatchDetailsModal
          match={selectedMatch}
          matchNumber={selectedMatch.matchNumber || selectedMatch.id}
          roundLabel={getRoundLabel(selectedMatch.round)}
          onClose={() => setSelectedMatch(null)}
        />
      )}
    </Box>
  );
}
