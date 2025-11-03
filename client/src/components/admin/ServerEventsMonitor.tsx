import React, { useState, useEffect, useRef } from 'react';
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

interface Server {
  id: string;
  name: string;
}

interface ServerEvent {
  timestamp: number;
  serverId: string;
  matchSlug: string;
  event: {
    event: string;
    matchid: string;
    [key: string]: unknown;
  };
}

export const ServerEventsMonitor: React.FC = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
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

  // Listen to server-specific events
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !selectedServerId) return;

    const handleServerEvent = (event: ServerEvent) => {
      if (!isPaused && event.serverId === selectedServerId) {
        setEvents((prev) => [event, ...prev].slice(0, 50)); // Keep last 50
      }
    };

    socket.on(`server:event:${selectedServerId}`, handleServerEvent);

    return () => {
      socket.off(`server:event:${selectedServerId}`, handleServerEvent);
    };
  }, [selectedServerId, isPaused]);

  const loadServers = async () => {
    try {
      const response = await api.get('/api/events/servers/list');
      if (response.success && response.servers) {
        setServers(response.servers);
      }
    } catch (err) {
      console.error('Failed to load servers:', err);
    }
  };

  const loadEvents = async () => {
    if (!selectedServerId) return;

    setLoading(true);
    setError('');

    try {
      const response = await api.get(`/api/events/server/${selectedServerId}`);
      if (response.success) {
        setEvents(response.events || []);
      }
    } catch (err) {
      setError('Failed to load events');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleServerChange = (serverId: string) => {
    setSelectedServerId(serverId);
    setEvents([]);
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
  }, [selectedServerId]);

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
        return '#4caf50'; // green
      case 'series_end':
        return '#2196f3'; // blue
      case 'map_result':
        return '#9c27b0'; // purple
      case 'round_end':
        return '#ff9800'; // orange
      case 'player_death':
        return '#f44336'; // red
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
              <IconButton onClick={loadEvents} disabled={!selectedServerId || loading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Clear console">
              <IconButton onClick={handleClear} disabled={events.length === 0}>
                <ClearIcon />
              </IconButton>
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

        <Button
          variant="outlined"
          size="small"
          onClick={loadServers}
          sx={{ mb: 2 }}
        >
          Refresh Server List
        </Button>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
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
            <Typography color="text.secondary" textAlign="center" sx={{ mt: 20 }}>
              No events yet. Waiting for events from server...
            </Typography>
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
            Showing {events.length} event{events.length !== 1 ? 's' : ''} (max 50)
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Events update in real-time via WebSocket
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

