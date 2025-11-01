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
import { api } from '../utils/api';
import ServerModal from '../components/modals/ServerModal';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);

  const checkServerStatus = async (serverId: string): Promise<'online' | 'offline'> => {
    try {
      const response = await api.get(`/api/servers/${serverId}/status`);
      return response.status;
    } catch {
      return 'offline';
    }
  };

  const loadServers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/servers');
      const serverList = response.servers || [];

      // Set initial status as 'checking'
      const serversWithStatus = serverList.map((s: Server) => ({
        ...s,
        status: 'checking' as const,
      }));
      setServers(serversWithStatus);
      setError('');
      setLoading(false); // Show servers immediately

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
      setLoading(false);
      console.error(err);
    }
  };

  useEffect(() => {
    loadServers();
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
        {!error && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenModal()}>
            New Server
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {!error &&
        (servers.length === 0 ? (
          <Card sx={{ textAlign: 'center', py: 8 }}>
            <StorageIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No servers yet
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={3}>
              Create your first CS2 server to get started
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenModal()}>
              Create Server
            </Button>
          </Card>
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
        onClose={handleCloseModal}
        onSave={handleSave}
      />
    </Box>
  );
}
