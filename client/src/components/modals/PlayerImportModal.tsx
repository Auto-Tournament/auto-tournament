import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Snackbar,
  Alert,
  Typography,
  Box,
  Chip,
  Stack,
  Paper,
  IconButton,
  Collapse,
} from '@mui/material';
import {
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import Link from '@mui/material/Link';
import { CircularProgress } from '@mui/material';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface ImportPlayer {
  steamId: string;
  name: string;
  initialELO?: number;
  avatarUrl?: string;
}

interface PlayerImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (players: ImportPlayer[]) => Promise<void>;
}

export const PlayerImportModal: React.FC<PlayerImportModalProps> = ({ open, onClose, onImport }) => {
  const { showWarning } = useSnackbar();
  const [jsonInput, setJsonInput] = useState('');
  const [parsedPlayers, setParsedPlayers] = useState<ImportPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [expandedPlayers, setExpandedPlayers] = useState<Set<number>>(new Set());

  const handleClose = () => {
    setJsonInput('');
    setParsedPlayers(null);
    setError(null);
    setExpandedPlayers(new Set());
    onClose();
  };

  const validatePlayer = (player: unknown, index: number): string | null => {
    if (typeof player !== 'object' || player === null) {
      return `Player ${index + 1}: Invalid player object`;
    }
    if (!player.steamId || typeof player.steamId !== 'string') {
      return `Player ${index + 1}: Missing or invalid steamId`;
    }
    if (!player.name || typeof player.name !== 'string') {
      return `Player ${index + 1} (${player.steamId}): Missing or invalid name`;
    }
    if (player.initialELO !== undefined && (typeof player.initialELO !== 'number' || player.initialELO < 0)) {
      return `Player "${player.name}": initialELO must be a positive number or omitted`;
    }
    return null;
  };

  const handleParse = () => {
    setError(null);
    setParsedPlayers(null);

    if (!jsonInput.trim()) {
      showWarning('Please enter JSON or CSV data');
      return;
    }

    try {
      let players: ImportPlayer[];

      // Try parsing as JSON first
      if (jsonInput.trim().startsWith('[') || jsonInput.trim().startsWith('{')) {
        const parsed = JSON.parse(jsonInput);
        players = Array.isArray(parsed) ? parsed : parsed.players ? parsed.players : [parsed];
      } else {
        // Try parsing as CSV
        const lines = jsonInput.trim().split('\n');
        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
        players = lines.slice(1).map((_line) => {
          const values = _line.split(',').map((v) => v.trim());
          const player: Record<string, string | number | undefined> = {};
          headers.forEach((header, i) => {
            const value = values[i] || '';
            if (header === 'steamid' || header === 'steam_id') {
              player.steamId = value;
            } else if (header === 'name') {
              player.name = value;
            } else if (header === 'initialelo' || header === 'initial_elo' || header === 'elo') {
              player.initialELO = value ? parseInt(value, 10) : undefined;
            } else if (header === 'avatarurl' || header === 'avatar_url' || header === 'avatar') {
              player.avatarUrl = value || undefined;
            }
          });
          return player;
        });
      }

      if (!Array.isArray(players) || players.length === 0) {
        setError('No players found in the data');
        return;
      }

      // Validate all players
      const validationErrors: string[] = [];
      players.forEach((player, index) => {
        const error = validatePlayer(player, index);
        if (error) {
          validationErrors.push(error);
        }
      });

      if (validationErrors.length > 0) {
        setError(`Validation errors:\n${validationErrors.join('\n')}`);
        return;
      }

      setParsedPlayers(players);
    } catch (err) {
      setError(`Failed to parse data: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleImport = async () => {
    if (!parsedPlayers) return;

    setImporting(true);
    setError(null);

    try {
      await onImport(parsedPlayers);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import players');
    } finally {
      setImporting(false);
    }
  };

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedPlayers);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedPlayers(newExpanded);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Import Players</Typography>
          <IconButton size="small" onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" gutterBottom>
            Import players from JSON or CSV format. Required fields: <strong>steamId</strong>, <strong>name</strong>.
            Optional: <strong>initialELO</strong> (defaults to 3000), <strong>avatarUrl</strong>.
          </Typography>
          <Typography variant="caption" component="div">
            <Link
              href="https://me.sivert.io/guides/shuffle-tournaments/#bulk-import-players-with-elo"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                textDecoration: 'none',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              View documentation with examples
              <OpenInNewIcon sx={{ fontSize: '0.875rem' }} />
            </Link>
          </Typography>
        </Alert>

        <TextField
          fullWidth
          multiline
          rows={10}
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder={`JSON format:\n[\n  {\n    "steamId": "76561198012345678",\n    "name": "Player One",\n    "initialELO": 3000,\n    "avatarUrl": "https://..."\n  }\n]\n\nCSV format:\nsteamId,name,initialELO,avatarUrl\n76561198012345678,Player One,3000,https://...`}
          sx={{ mb: 2, fontFamily: 'monospace' }}
        />

        <Box display="flex" gap={2} mb={2}>
          <Button
            variant="outlined"
            onClick={handleParse}
            sx={{
              ...(!jsonInput.trim() && {
                bgcolor: 'action.disabledBackground',
                color: 'action.disabled',
                borderColor: 'action.disabled',
                '&:hover': {
                  bgcolor: 'action.disabledBackground',
                  borderColor: 'action.disabled',
                },
              }),
            }}
          >
            Parse & Validate
          </Button>
          {parsedPlayers && (
            <Chip
              icon={<CheckCircleIcon />}
              label={`${parsedPlayers.length} player(s) ready to import`}
              color="success"
            />
          )}
        </Box>


        {parsedPlayers && parsedPlayers.length > 0 && (
          <Paper sx={{ p: 2, maxHeight: 400, overflow: 'auto' }}>
            <Typography variant="subtitle2" gutterBottom>
              Players to Import ({parsedPlayers.length}):
            </Typography>
            <Stack spacing={1}>
              {parsedPlayers.map((player, index) => (
                <Box key={index}>
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ cursor: 'pointer' }}
                    onClick={() => toggleExpand(index)}
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      {expandedPlayers.has(index) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      <Typography variant="body2" fontWeight={600}>
                        {player.name}
                      </Typography>
                      <Chip label={player.steamId} size="small" variant="outlined" />
                      {player.initialELO !== undefined && (
                        <Chip label={`ELO: ${player.initialELO}`} size="small" />
                      )}
                    </Box>
                  </Box>
                  <Collapse in={expandedPlayers.has(index)}>
                    <Box sx={{ pl: 4, pt: 1 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Steam ID: {player.steamId}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Name: {player.name}
                      </Typography>
                      {player.initialELO !== undefined && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Initial ELO: {player.initialELO}
                        </Typography>
                      )}
                      {player.avatarUrl && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Avatar: {player.avatarUrl.substring(0, 50)}...
                        </Typography>
                      )}
                    </Box>
                  </Collapse>
                </Box>
              ))}
            </Stack>
          </Paper>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={importing}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            if (!parsedPlayers) {
              showWarning('Please parse and validate the data first');
              return;
            }
            handleImport();
          }}
          disabled={importing}
          startIcon={importing ? <CircularProgress size={16} /> : undefined}
          sx={{
            ...(!parsedPlayers && {
              bgcolor: 'action.disabledBackground',
              color: 'action.disabled',
              '&:hover': {
                bgcolor: 'action.disabledBackground',
              },
            }),
          }}
        >
          {importing ? 'Importing...' : `Import ${parsedPlayers?.length || 0} Player(s)`}
        </Button>
      </DialogActions>

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError('')} variant="filled" sx={{ whiteSpace: 'pre-wrap' }}>
          {error}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

