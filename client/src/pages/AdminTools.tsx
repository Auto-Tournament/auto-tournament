import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Stack,
  Alert,
  Chip,
  FormControl,
  FormLabel,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Divider,
  Grid,
  CircularProgress,
} from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../utils/api';

interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  enabled: boolean;
}

export default function AdminTools() {
  const [message, setMessage] = useState('');
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServers, setSelectedServers] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingServers, setLoadingServers] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [broadcastResults, setBroadcastResults] = useState<{
    successful: number;
    failed: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      setLoadingServers(true);
      const response: { servers: Server[] } = await api.get('/api/servers');
      const enabledServers = (response.servers || []).filter((s: Server) => s.enabled);
      setServers(enabledServers);
      setSelectedServers(enabledServers.map((s) => s.id));
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to load servers');
    } finally {
      setLoadingServers(false);
    }
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedServers(servers.map((s) => s.id));
    } else {
      setSelectedServers([]);
    }
    setSelectAll(!selectAll);
  };

  const handleServerToggle = (serverId: string) => {
    setSelectedServers((prev) =>
      prev.includes(serverId) ? prev.filter((id) => id !== serverId) : [...prev, serverId]
    );
  };

  const handleBroadcast = async () => {
    if (!message.trim()) {
      setError('Please enter a message');
      return;
    }

    if (selectedServers.length === 0) {
      setError('Please select at least one server');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setBroadcastResults(null);

    try {
      const response: {
        success: boolean;
        message: string;
        stats: { total: number; successful: number; failed: number };
      } = await api.post('/api/rcon/broadcast', {
        message: message.trim(),
        serverIds: selectedServers,
      });

      setBroadcastResults(response.stats);
      setSuccess(response.message);
      setMessage(''); // Clear message after successful broadcast

      // Clear success after 5 seconds
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to send broadcast');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Box display="flex" alignItems="center" gap={2}>
          <CampaignIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Admin Tools
          </Typography>
        </Box>
      </Box>

      {/* Broadcast Message Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography
            variant="h6"
            fontWeight={600}
            mb={2}
            display="flex"
            alignItems="center"
            gap={1}
          >
            <CampaignIcon color="primary" />
            Broadcast Message
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Send an admin message (css_asay) to selected servers. The message will appear in chat
            with an admin prefix.
          </Typography>

          {error && (
            <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert
              severity="success"
              onClose={() => setSuccess('')}
              sx={{ mb: 2 }}
              icon={<CheckCircleIcon />}
            >
              {success}
            </Alert>
          )}

          {broadcastResults && (
            <Alert severity={broadcastResults.failed === 0 ? 'success' : 'warning'} sx={{ mb: 2 }}>
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  Broadcast Results:
                </Typography>
                <Box display="flex" gap={2} mt={1}>
                  <Chip
                    label={`${broadcastResults.successful} Successful`}
                    color="success"
                    size="small"
                    icon={<CheckCircleIcon />}
                  />
                  {broadcastResults.failed > 0 && (
                    <Chip
                      label={`${broadcastResults.failed} Failed`}
                      color="error"
                      size="small"
                      icon={<ErrorIcon />}
                    />
                  )}
                </Box>
              </Box>
            </Alert>
          )}

          <Stack spacing={3}>
            {/* Message Input */}
            <TextField
              label="Message"
              placeholder="Enter your admin message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              multiline
              rows={3}
              fullWidth
              inputProps={{ maxLength: 200 }}
              helperText={`${message.length}/200 characters`}
            />

            <Divider />

            {/* Server Selection */}
            <Box>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <FormLabel component="legend">Target Servers</FormLabel>
                <Button
                  size="small"
                  startIcon={<RefreshIcon />}
                  onClick={loadServers}
                  disabled={loadingServers}
                >
                  Refresh
                </Button>
              </Box>

              {loadingServers ? (
                <Box display="flex" justifyContent="center" p={3}>
                  <CircularProgress />
                </Box>
              ) : servers.length === 0 ? (
                <Alert severity="warning">
                  No enabled servers found. Please add and enable servers first.
                </Alert>
              ) : (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={selectedServers.length === servers.length}
                        indeterminate={
                          selectedServers.length > 0 && selectedServers.length < servers.length
                        }
                        onChange={handleSelectAll}
                      />
                    }
                    label={
                      <Typography fontWeight={600}>
                        Select All ({selectedServers.length}/{servers.length})
                      </Typography>
                    }
                  />

                  <FormControl component="fieldset" fullWidth sx={{ mt: 1 }}>
                    <FormGroup>
                      <Grid container spacing={1}>
                        {servers.map((server) => (
                          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={server.id}>
                            <Card
                              variant="outlined"
                              sx={{
                                bgcolor: selectedServers.includes(server.id)
                                  ? 'action.selected'
                                  : 'background.paper',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                '&:hover': {
                                  bgcolor: 'action.hover',
                                },
                              }}
                              onClick={() => handleServerToggle(server.id)}
                            >
                              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                <FormControlLabel
                                  control={
                                    <Checkbox
                                      checked={selectedServers.includes(server.id)}
                                      onChange={() => handleServerToggle(server.id)}
                                    />
                                  }
                                  label={
                                    <Box>
                                      <Typography variant="body2" fontWeight={600}>
                                        {server.name}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {server.host}:{server.port}
                                      </Typography>
                                    </Box>
                                  }
                                  sx={{ m: 0 }}
                                />
                              </CardContent>
                            </Card>
                          </Grid>
                        ))}
                      </Grid>
                    </FormGroup>
                  </FormControl>
                </>
              )}
            </Box>

            {/* Send Button */}
            <Button
              variant="contained"
              size="large"
              startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
              onClick={handleBroadcast}
              disabled={loading || !message.trim() || selectedServers.length === 0}
              fullWidth
            >
              {loading ? 'Sending...' : `Send to ${selectedServers.length} Server(s)`}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Alert severity="info">
        <Typography variant="body2" fontWeight={600} gutterBottom>
          About Admin Broadcasts
        </Typography>
        <Typography variant="body2">
          Messages sent via <code>css_asay</code> appear in the game chat with an admin prefix,
          making them visually distinct from regular player messages. This is useful for important
          announcements, warnings, or instructions during tournaments.
        </Typography>
      </Alert>
    </Box>
  );
}
