import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Chip,
  Alert,
  Paper,
  IconButton,
  Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ClearIcon from '@mui/icons-material/Clear';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../../utils/api';
import { io, Socket } from 'socket.io-client';
import type { ServerEvent, ServerEventsResponse } from '../../types';

export const ServerEventsMonitor: React.FC = () => {
  const [servers, setServers] = useState<Array<{ id: string; name: string; events?: number }>>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [noEventsHint, setNoEventsHint] = useState(false);
  const [eventsHealthError, setEventsHealthError] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [events]);

  // Load servers with events
  useEffect(() => {
    loadServers();
  }, []);

  // Lightweight health check for events API so we can surface backend issues in the UI
  useEffect(() => {
    const checkEventsHealth = async () => {
      try {
        await api.get('/api/events/test');
        setEventsHealthError('');
      } catch (err) {
        console.error('Failed to reach /api/events/test', err);
        setEventsHealthError(
          'Events API health check failed. Verify that the API is running and /api/events/test is reachable.'
        );
      }
    };
    void checkEventsHealth();
  }, []);

  // Setup WebSocket connection
  useEffect(() => {
    const socket = io(window.location.origin, {
      path: '/socket.io',
    });

    socket.on('connect', () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  // Listen to ALL server events (no filtering)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleServerEvent = (event: ServerEvent) => {
      if (!isPaused) {
        // Show events from all servers if no specific server selected
        if (!selectedServerId || event.serverId === selectedServerId) {
          setEvents((prev) => [event, ...prev].slice(0, 100)); // Keep last 100
        }
      }
    };

    // Listen to all server events
    socket.on('server:event', handleServerEvent);

    // Also listen to server-specific events if one is selected
    if (selectedServerId) {
      socket.on(`server:event:${selectedServerId}`, handleServerEvent);
    }

    return () => {
      socket.off('server:event', handleServerEvent);
      if (selectedServerId) {
        socket.off(`server:event:${selectedServerId}`, handleServerEvent);
      }
    };
  }, [selectedServerId, isPaused]);

  const loadServers = async () => {
    try {
      const response = await api.get<{
        success: boolean;
        servers: Array<{ id: string; name: string }>;
      }>('/api/servers?enabled=true');

      if (response.success && Array.isArray(response.servers)) {
        setServers(
          response.servers.map((server) => ({
            id: server.id,
            name: server.name,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to load servers:', err);
    }
  };

  const loadEvents = useCallback(async () => {
    if (!selectedServerId) return;

    setLoading(true);
    setError('');

    try {
      const response = await api.get<ServerEventsResponse>(
        `/api/events/server/${selectedServerId}`
      );
      if (response.success) {
        setEvents(response.events || []);
      }
    } catch (err) {
      setError('Failed to load events');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedServerId]);

  const handleServerChange = (serverId: string) => {
    setSelectedServerId(serverId);
    setEvents([]);
    setNoEventsHint(false);
  };

  const handleClear = () => {
    setEvents([]);
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
  };

  useEffect(() => {
    if (selectedServerId) {
      loadEvents();
    }
  }, [selectedServerId, loadEvents]);

  // After N seconds with no events for a selected server, show a stronger hint to check webhook config
  useEffect(() => {
    if (!selectedServerId || events.length > 0) {
      setNoEventsHint(false);
      return;
    }

    const timeout = setTimeout(() => {
      if (events.length === 0 && selectedServerId) {
        setNoEventsHint(true);
      }
    }, 15000); // 15 seconds

    return () => clearTimeout(timeout);
  }, [selectedServerId, events.length]);

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  const getEventColor = (eventType: string): string => {
    switch (eventType) {
      case 'series_start':
      case 'going_live':
        return '#A6E3D0'; // success (mint)
      case 'series_end':
        return '#A8C7FA'; // info (soft blue)
      case 'map_result':
        return '#D0BCFF'; // primary purple
      case 'round_end':
        return '#F7CF9A'; // warning amber
      case 'player_death':
        return '#FFB4AB'; // error red
      case 'player_connect':
      case 'player_disconnect':
        return '#607d8b'; // blue-grey
      default:
        return '#757575'; // grey
    }
  };

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box display="flex" alignItems="center" gap={2}>
            <Typography variant="h6" fontWeight={600}>
              Server Events Monitor
            </Typography>
            {isConnected ? (
              <Chip label="Connected" color="success" size="small" />
            ) : (
              <Chip label="Disconnected" color="error" size="small" />
            )}
            {isPaused && <Chip label="Paused" color="warning" size="small" />}
          </Box>
          <Box display="flex" gap={1}>
            <Tooltip title={isPaused ? 'Resume' : 'Pause'}>
              <IconButton onClick={togglePause} color={isPaused ? 'warning' : 'default'}>
                {isPaused ? <PlayArrowIcon /> : <PauseIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Refresh events">
              <span>
                <IconButton onClick={loadEvents} disabled={!selectedServerId || loading}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Clear console">
              <span>
                <IconButton onClick={handleClear} disabled={events.length === 0}>
                  <ClearIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>

        {/* Server Selection */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Select Server</InputLabel>
          <Select
            value={selectedServerId}
            label="Select Server"
            onChange={(e) => handleServerChange(e.target.value)}
          >
            {servers.length === 0 ? (
              <MenuItem value="" disabled>
                No servers with events yet
              </MenuItem>
            ) : (
              servers.map((server) => (
                <MenuItem key={server.id} value={server.id}>
                  {server.id} ({server.events} events)
                </MenuItem>
              ))
            )}
          </Select>
        </FormControl>

        <Button variant="outlined" size="small" onClick={loadServers} sx={{ mb: 2 }}>
          Refresh Server List
        </Button>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {eventsHealthError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {eventsHealthError}
          </Alert>
        )}

        {/* Events Console */}
        <Paper
          variant="outlined"
          sx={{
            height: 600,
            overflow: 'auto',
            bgcolor: '#1e1e1e',
            p: 2,
            fontFamily: 'monospace',
          }}
        >
          {!selectedServerId ? (
            <Typography color="text.secondary" textAlign="center" sx={{ mt: 20 }}>
              Select a server to view events
            </Typography>
          ) : events.length === 0 ? (
            <Box sx={{ mt: 20 }}>
              <Typography color="text.secondary" textAlign="center" mb={1}>
                No events received yet for this server.
              </Typography>
              <Typography color="text.secondary" variant="body2" textAlign="center">
                {noEventsHint
                  ? 'Still no events after 15 seconds – check that your CS2 server is configured to send MatchZy webhooks to /api/events/:matchSlugOrServerId with the correct X-MatchZy-Token.'
                  : 'Waiting for events from server...'}
              </Typography>
            </Box>
          ) : (
            <Box>
              {events.map((event, index) => (
                <EventItem
                  key={`${event.timestamp}-${index}`}
                  event={event}
                  formatTimestamp={formatTimestamp}
                  getEventColor={getEventColor}
                />
              ))}
              <div ref={eventsEndRef} />
            </Box>
          )}
        </Paper>

        <Box display="flex" justifyContent="space-between" alignItems="center" mt={2}>
          <Typography variant="caption" color="text.secondary">
            Showing {events.length} event{events.length !== 1 ? 's' : ''} (max 100) - All servers
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Events update in real-time via WebSocket (unfiltered)
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

// Separate component for event item to handle JSON display
const EventItem: React.FC<{
  event: ServerEvent;
  formatTimestamp: (ts: number) => string;
  getEventColor: (type: string) => string;
}> = ({ event, formatTimestamp, getEventColor }) => {
  return (
    <Box
      sx={{
        mb: 2,
        p: 1.5,
        borderRadius: 1,
        bgcolor: 'rgba(255, 255, 255, 0.05)',
        borderLeft: '3px solid',
        borderLeftColor: getEventColor(event.event.event),
      }}
    >
      {/* Event Header */}
      <Box display="flex" gap={2} mb={1} flexWrap="wrap" alignItems="center">
        <Typography
          component="span"
          sx={{
            color: '#888',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
          }}
        >
          [{formatTimestamp(event.timestamp)}]
        </Typography>
        <Chip
          label={event.event.event}
          size="small"
          sx={{
            bgcolor: getEventColor(event.event.event),
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: '0.7rem',
            height: 20,
          }}
        />
        <Typography
          component="span"
          sx={{
            color: '#61dafb',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
          }}
        >
          Match: {event.matchSlug}
        </Typography>
      </Box>

      {/* Event Data (Pretty JSON) */}
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          bgcolor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: 1,
          overflow: 'auto',
          fontSize: '0.75rem',
          maxHeight: 400,
        }}
      >
        <code>{JSON.stringify(event.event, null, 2)}</code>
      </Box>
    </Box>
  );
};
