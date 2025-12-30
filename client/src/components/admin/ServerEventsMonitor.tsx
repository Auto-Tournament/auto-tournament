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
  const [autoScroll, setAutoScroll] = useState(true);
  const [noEventsHint, setNoEventsHint] = useState(false);
  const [eventsHealthError, setEventsHealthError] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (autoScroll) {
      scrollToBottom();
    }
  }, [events, autoScroll]);

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

  // Listen to ALL server events (filter by selected server if set)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleServerEvent = (event: ServerEvent) => {
      if (!isPaused) {
        // Show events from all servers if no specific server selected
        if (!selectedServerId || event.serverId === selectedServerId) {
          // Append newest events at the bottom; keep only the last 100
          setEvents((prev) => {
            const next = [...prev, event];
            return next.length > 100 ? next.slice(next.length - 100) : next;
          });
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

  const loadServers = useCallback(async () => {
    try {
      const response = await api.get<{
        success: boolean;
        servers: Array<{ id: string; name: string }>;
      }>('/api/servers?enabled=true');

      if (response.success && Array.isArray(response.servers)) {
        const mapped = response.servers.map((server) => ({
          id: server.id,
          name: server.name,
        }));
        setServers(mapped);

        // Auto-select first server if none selected
        if (!selectedServerId && mapped.length > 0) {
          setSelectedServerId(mapped[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load servers:', err);
    }
  }, [selectedServerId]);

  // Load servers with events
  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const loadEvents = useCallback(async () => {
    if (!selectedServerId) return;

    setLoading(true);
    setError('');

    try {
      const response = await api.get<ServerEventsResponse>(
        `/api/events/server/${selectedServerId}`
      );
      if (response.success) {
        const ordered = (response.events || []).slice().sort((a, b) => a.timestamp - b.timestamp);
        setEvents(ordered);
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

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

    // If the user is within 40px of the bottom, treat as "pinned"
    setAutoScroll(distanceFromBottom < 40);
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
      case 'map_picked':
      case 'side_picked':
      case 'map_vetoed':
        return '#C4B5FD'; // veto / map flow (violet)
      case 'round_started':
      case 'warmup_ended':
      case 'knife_round_started':
      case 'knife_round_ended':
      case 'halftime_started':
      case 'overtime_started':
      case 'side_swap':
      case 'backup_loaded':
        return '#6EE7B7'; // round / phase transitions (teal)
      case 'round_end':
        return '#F59E0B'; // round result (amber)
      case 'round_mvp':
        return '#FBBF24'; // MVP highlight (gold)
      case 'player_death':
        return '#F87171'; // kills/deaths (red)
      case 'player_connect':
      case 'player_disconnect':
        return '#93C5FD'; // connection events (blue)
      case 'player_ready':
      case 'player_unready':
      case 'team_ready':
      case 'all_players_ready':
      case 'unpause_requested':
      case 'match_paused':
      case 'match_unpaused':
        return '#FACC15'; // ready / pause system (yellow)
      case 'bomb_planted':
      case 'bomb_defused':
      case 'bomb_exploded':
        return '#FB923C'; // bomb events (orange)
      case 'player_stats_update':
        return '#38BDF8'; // stats updates (sky blue)
      case 'test_event':
      case 'MatchZyTestEvent':
        return '#A855F7'; // connectivity test events (purple)
      default:
        return '#E5E7EB'; // neutral light grey
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
          <InputLabel>Filter by Server (optional)</InputLabel>
          <Select
            value={selectedServerId}
            label="Filter by Server (optional)"
            onChange={(e) => handleServerChange(e.target.value)}
          >
            {servers.length === 0 ? (
              <MenuItem value="" disabled>
                No servers available
              </MenuItem>
            ) : (
              servers.map((server) => (
                <MenuItem key={server.id} value={server.id}>
                  {server.name || server.id} ({server.id})
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
          onScroll={handleScroll}
        >
          {events.length === 0 && selectedServerId ? (
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
            Showing {events.length} event{events.length !== 1 ? 's' : ''} (max 100)
            {selectedServerId ? ` for server ${selectedServerId}` : ''}
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
  const [expanded, setExpanded] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const toggleExpanded = () => {
    setExpanded((prev) => !prev);
  };

  const payload = event.event as Record<string, unknown>;

  // Many MatchZy events include map_number; surface it when present
  const rawMapNumber = payload['map_number'];
  const mapNumber = typeof rawMapNumber === 'number' ? (rawMapNumber as number) : undefined;

  // Some events (round_*) also include round_number
  const rawRoundNumber = payload['round_number'];
  const roundNumber =
    typeof rawRoundNumber === 'number' ? (rawRoundNumber as number) : undefined;

  // Many score-bearing events include team1_score / team2_score and sometimes
  // team1_series_score / team2_series_score – surface them when present
  const rawTeam1Score = payload['team1_score'];
  const rawTeam2Score = payload['team2_score'];
  const rawTeam1Series = payload['team1_series_score'];
  const rawTeam2Series = payload['team2_series_score'];

  const hasMapScore =
    typeof rawTeam1Score === 'number' && typeof rawTeam2Score === 'number';
  const hasSeriesScore =
    typeof rawTeam1Series === 'number' && typeof rawTeam2Series === 'number';

  // When expanding an event, make sure it scrolls into view within the console
  React.useEffect(() => {
    if (expanded && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expanded]);

  return (
    <Box
      ref={containerRef}
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
      <Box
        display="flex"
        gap={2}
        mb={1}
        flexWrap="wrap"
        alignItems="center"
        sx={{ cursor: 'pointer' }}
        onClick={toggleExpanded}
      >
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
        <Typography
          component="span"
          sx={{
            color: getEventColor(event.event.event),
            fontSize: '0.8rem',
            fontFamily: 'monospace',
          }}
        >
          {event.event.event}
        </Typography>
        <Typography
          component="span"
          sx={{
            color: '#61dafb',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
          }}
        >
          Match: {event.matchSlug}
          {mapNumber !== undefined ? `, map: ${mapNumber}` : ''}
          {roundNumber !== undefined ? `, round: ${roundNumber}` : ''}
        </Typography>
        {hasMapScore && (
          <Typography
            component="span"
            sx={{
              color: '#F9FAFB',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
            }}
          >
            {' '}
            | Score: {rawTeam1Score}-{rawTeam2Score}
          </Typography>
        )}
        {hasSeriesScore && (
          <Typography
            component="span"
            sx={{
              color: '#E5E7EB',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
            }}
          >
            {' '}
            (Series: {rawTeam1Series}-{rawTeam2Series})
          </Typography>
        )}
      </Box>

      {/* Event Data (Pretty JSON) */}
      {expanded && (
        <Box
          component="pre"
          sx={{
            m: 0,
            mt: 1,
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
      )}
    </Box>
  );
};
