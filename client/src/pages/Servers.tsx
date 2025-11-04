import React, { useState, useEffect } from 'react';
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
import { api } from '../utils/api';
import ServerModal from '../components/modals/ServerModal';
import BatchServerModal from '../components/modals/BatchServerModal';
import { EmptyState } from '../components/shared/EmptyState';

interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  status?: 'online' | 'offline' | 'checking';
}

export default function Servers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const checkServerStatus = async (serverId: string): Promise<'online' | 'offline'> => {
    try {
      const response: { status: 'online' | 'offline' } = await api.get(
        `/api/servers/${serverId}/status`
      );
      return response.status;
    } catch {
      return 'offline';
    }
  };

  const loadServers = async () => {
    setRefreshing(true);
    try {
      const response: { servers: Server[] } = await api.get('/api/servers');
      const serverList = response.servers || [];

      // Set initial status as 'checking'
      const serversWithStatus = serverList.map((s: Server) => ({
        ...s,
        status: 'checking' as const,
      }));
      setServers(serversWithStatus);
      setError('');

      // Check status for each server in parallel
      const statusPromises = serverList.map(async (server: Server) => {
        const status = await checkServerStatus(server.id);
        return { id: server.id, status };
      });

      const statuses = await Promise.all(statusPromises);

      // Update servers with actual status
      setServers((prev) =>
        prev.map((server) => {
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
  };

  useEffect(() => {
    loadServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setBatchModalOpen(true)}>
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
          <EmptyState
            icon={StorageIcon}
            title="No servers registered"
            description="Add your first CS2 server to get started with the tournament"
            actionLabel="Add Server"
            actionIcon={AddIcon}
            onAction={() => handleOpenModal()}
          />
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
                            ) : (
                              <CancelIcon />
                            )
                          }
                          label={
                            server.status === 'checking'
                              ? 'Checking...'
                              : server.status === 'online'
                              ? 'Online'
                              : 'Offline'
                          }
                          size="small"
                          color={
                            server.status === 'checking'
                              ? 'default'
                              : server.status === 'online'
                              ? 'success'
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
