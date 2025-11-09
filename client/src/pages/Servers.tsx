import React, { useState, useEffect, useCallback } from 'react';
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
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StorageIcon from '@mui/icons-material/Storage';
import EditIcon from '@mui/icons-material/Edit';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RefreshIcon from '@mui/icons-material/Refresh';
import BlockIcon from '@mui/icons-material/Block';
import { api } from '../utils/api';
import ServerModal from '../components/modals/ServerModal';
import BatchServerModal from '../components/modals/BatchServerModal';
import { EmptyState } from '../components/shared/EmptyState';
import type { Server, ServersResponse, ServerStatusResponse } from '../types';

export default function Servers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Servers';
  }, []);

  const checkServerStatus = async (serverId: string): Promise<'online' | 'offline'> => {
    try {
      const response = await api.get<ServerStatusResponse>(`/api/servers/${serverId}/status`);
      return response.status === 'online' ? 'online' : 'offline';
    } catch {
      return 'offline';
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
      setError('');

      // Check status only for enabled servers
      const enabledServers = serverList.filter((s) => s.enabled);
      const statusPromises = enabledServers.map(async (server: Server) => {
        const status = await checkServerStatus(server.id);
        return { id: server.id, status };
      });

      const statuses = await Promise.all(statusPromises);

      // Update servers with actual status (only enabled servers)
      setServers((prev) =>
        prev.map((server) => {
          if (!server.enabled) {
            return { ...server, status: 'disabled' as const };
          }
          const statusInfo = statuses.find((s) => s.id === server.id);
          return { ...server, status: statusInfo?.status || 'offline' };
        })
      );
    } catch (err) {
      setError('Failed to load servers');
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  }, []);

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

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Box display="flex" alignItems="center" gap={2}>
          <StorageIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Servers
          </Typography>
          <Chip
            label={servers.length}
            color="primary"
            sx={{ fontWeight: 600, fontSize: '0.9rem' }}
          />
        </Box>
        {!error && servers.length > 0 && (
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
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenModal()}>
              Add Server
            </Button>
          </Box>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {!error &&
        (servers.length === 0 ? (
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
          <Grid container spacing={3}>
            {servers.map((server) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={server.id}>
                <Card
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
                      <IconButton size="small" onClick={() => handleOpenModal(server)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Box>

                    <Box display="flex" flexDirection="column" gap={0.5} mb={2}>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Host:</strong> {server.host}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Port:</strong> {server.port}
                      </Typography>
                    </Box>

                    <Typography variant="caption" color="text.secondary" display="block" mt={2}>
                      ID: {server.id}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ))}

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
    </Box>
  );
}
