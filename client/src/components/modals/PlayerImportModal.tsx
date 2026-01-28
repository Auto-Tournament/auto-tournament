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
import { useTranslation } from 'react-i18next';

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

export const PlayerImportModal: React.FC<PlayerImportModalProps> = ({
  open,
  onClose,
  onImport,
}) => {
  const { showWarning } = useSnackbar();
  const { t } = useTranslation();
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

  const handleDialogClose = (
    _event: React.SyntheticEvent | Event,
    reason: 'backdropClick' | 'escapeKeyDown'
  ) => {
    // Prevent accidental closes via backdrop or ESC; require explicit Cancel/X.
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
      return;
    }
    handleClose();
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
    if (
      player.initialELO !== undefined &&
      (typeof player.initialELO !== 'number' || player.initialELO < 0)
    ) {
      return `Player "${player.name}": initialELO must be a positive number or omitted`;
    }
    return null;
  };

  const handleParse = () => {
    setError(null);
    setParsedPlayers(null);

    if (!jsonInput.trim()) {
      showWarning(t('playerImportModal.errors.noData'));
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
        setError(t('playerImportModal.errors.noPlayers'));
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
        setError(
          `${t('playerImportModal.errors.validationPrefix')}\n${validationErrors.join('\n')}`
        );
        return;
      }

      setParsedPlayers(players);
    } catch (err) {
      setError(
        t('playerImportModal.errors.parseFailed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      );
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
      setError(
        err instanceof Error ? err.message : t('playerImportModal.errors.importFailed')
      );
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
    <Dialog
      open={open}
      onClose={handleDialogClose}
      maxWidth="md"
      fullWidth
      disableEscapeKeyDown
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">{t('playerImportModal.title')}</Typography>
          <IconButton size="small" onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" gutterBottom>
            {t('playerImportModal.info.description')}
          </Typography>
          <Typography variant="caption" component="div">
            <Link
              href="https://docs.sivert.io/docs/mat/user/shuffle-tournaments#importing-players"
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
              {t('playerImportModal.info.link')}
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
          placeholder={t('playerImportModal.placeholders.jsonCsv')}
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
            {t('playerImportModal.actions.parseValidate')}
          </Button>
          {parsedPlayers && (
            <Chip
              icon={<CheckCircleIcon />}
              label={t('playerImportModal.preview.readyChip', {
                count: parsedPlayers.length,
              })}
              color="success"
            />
          )}
        </Box>

        {parsedPlayers && parsedPlayers.length > 0 && (
          <Paper sx={{ p: 2, maxHeight: 400, overflow: 'auto' }}>
            <Typography variant="subtitle2" gutterBottom>
              {t('playerImportModal.preview.title', { count: parsedPlayers.length })}
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
                        {t('playerImportModal.preview.steamId', { steamId: player.steamId })}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('playerImportModal.preview.name', { name: player.name })}
                      </Typography>
                      {player.initialELO !== undefined && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {t('playerImportModal.preview.initialElo', {
                            elo: player.initialELO,
                          })}
                        </Typography>
                      )}
                      {player.avatarUrl && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {t('playerImportModal.preview.avatar', {
                            url: `${player.avatarUrl.substring(0, 50)}...`,
                          })}
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
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            if (!parsedPlayers) {
              showWarning(t('playerImportModal.errors.parseFirst'));
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
          {importing
            ? t('playerImportModal.actions.importing')
            : t('playerImportModal.actions.import', {
                count: parsedPlayers?.length || 0,
              })}
        </Button>
      </DialogActions>

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="error"
          onClose={() => setError('')}
          variant="filled"
          sx={{ whiteSpace: 'pre-wrap' }}
        >
          {error}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};
