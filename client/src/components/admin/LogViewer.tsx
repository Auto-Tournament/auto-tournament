import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../../utils/api';

interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  meta?: Record<string, any>;
}

export const LogViewer: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadLogs = async () => {
    try {
      setError('');
      const params = new URLSearchParams();
      params.append('limit', '200');
      if (levelFilter) {
        params.append('level', levelFilter);
      }

      const response = await api.get(`/api/logs?${params.toString()}`);
      if (response.success) {
        setLogs(response.logs || []);
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [levelFilter]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadLogs();
    }, 2000); // Refresh every 2 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, levelFilter]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'error';
      case 'warn':
        return 'warning';
      case 'debug':
        return 'info';
      default:
        return 'default';
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">Application Logs</Typography>
          <Box display="flex" gap={1} alignItems="center">
            <ToggleButtonGroup
              size="small"
              value={levelFilter}
              exclusive
              onChange={(_, value) => setLevelFilter(value || '')}
            >
              <ToggleButton value="">All</ToggleButton>
              <ToggleButton value="debug">Debug</ToggleButton>
              <ToggleButton value="info">Info</ToggleButton>
              <ToggleButton value="warn">Warn</ToggleButton>
              <ToggleButton value="error">Error</ToggleButton>
            </ToggleButtonGroup>
            <ToggleButton
              value="autoRefresh"
              selected={autoRefresh}
              onChange={() => setAutoRefresh(!autoRefresh)}
              size="small"
            >
              Auto
            </ToggleButton>
            <IconButton onClick={loadLogs} disabled={loading} size="small">
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading && logs.length === 0 ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        ) : (
          <Box
            sx={{
              maxHeight: '600px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '13px',
              bgcolor: 'background.default',
              p: 2,
              borderRadius: 1,
              '& .log-entry': {
                py: 0.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-child': {
                  borderBottom: 'none',
                },
              },
            }}
          >
            {logs.length === 0 ? (
              <Typography color="text.secondary" textAlign="center">
                No logs to display
              </Typography>
            ) : (
              logs.map((log, index) => (
                <Box key={index} className="log-entry">
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography component="span" sx={{ color: 'text.secondary', minWidth: '80px' }}>
                      {formatTimestamp(log.timestamp)}
                    </Typography>
                    <Chip
                      label={log.level.toUpperCase()}
                      size="small"
                      color={getLevelColor(log.level) as any}
                      sx={{ minWidth: '70px', fontWeight: 'bold', fontSize: '11px' }}
                    />
                    <Typography component="span" sx={{ wordBreak: 'break-word' }}>
                      {log.message}
                    </Typography>
                  </Box>
                  {log.meta && Object.keys(log.meta).length > 0 && (
                    <Box
                      sx={{
                        ml: 12,
                        mt: 0.5,
                        color: 'text.secondary',
                        fontSize: '12px',
                        fontStyle: 'italic',
                      }}
                    >
                      {JSON.stringify(log.meta, null, 2)}
                    </Box>
                  )}
                </Box>
              ))
            )}
          </Box>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Showing {logs.length} recent logs
          {autoRefresh && ' (auto-refreshing)'}
        </Typography>
      </CardContent>
    </Card>
  );
};
