import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  Typography,
  Box,
  Chip,
  Stack,
  Paper,
  IconButton,
  Collapse,
} from '@mui/material';
import { PlayerName } from '../player/PlayerName';
import {
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import Link from '@mui/material/Link';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useTranslation } from 'react-i18next';

interface Player {
  name: string;
  steamId: string;
  elo?: number; // Optional ELO rating (defaults to 1500 Skill Rating if not specified)
}

interface ImportTeam {
  name: string;
  tag?: string;
  players: Player[];
}

interface TeamImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (teams: ImportTeam[]) => Promise<void>;
}

export const TeamImportModal: React.FC<TeamImportModalProps> = ({ open, onClose, onImport }) => {
  const { showError, showWarning } = useSnackbar();
  const { t } = useTranslation();
  const [jsonInput, setJsonInput] = useState('');
  const [parsedTeams, setParsedTeams] = useState<ImportTeam[] | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());

  const handleClose = () => {
    setJsonInput('');
    setParsedTeams(null);
    setValidationError(null);
    setExpandedTeams(new Set());
    onClose();
  };

  const validateTeam = (
    team: { name?: string; players?: Array<{ name?: string; steamId?: string; elo?: number }> },
    index: number
  ): string | null => {
    if (!team.name || typeof team.name !== 'string') {
      return `Team ${index + 1}: Missing or invalid team name`;
    }
    if (!team.players || !Array.isArray(team.players)) {
      return `Team "${team.name}": Missing or invalid players array`;
    }
    if (team.players.length === 0) {
      return `Team "${team.name}": Must have at least one player`;
    }

    for (let i = 0; i < team.players.length; i++) {
      const player = team.players[i];
      if (!player.name || typeof player.name !== 'string') {
        return `Team "${team.name}", Player ${i + 1}: Missing or invalid player name`;
      }
      if (!player.steamId || typeof player.steamId !== 'string') {
        return `Team "${team.name}", Player "${player.name}": Missing or invalid Steam ID`;
      }
      // Basic Steam ID format validation (17 digits starting with 7656119)
      if (!/^7656119\d{10}$/.test(player.steamId)) {
        return `Team "${team.name}", Player "${player.name}": Invalid Steam ID format (${player.steamId})`;
      }
      // Validate ELO if provided
      if (
        player.elo !== undefined &&
        (typeof player.elo !== 'number' || player.elo < 0 || player.elo > 10000)
      ) {
        return `Team "${team.name}", Player "${player.name}": ELO must be a number between 0 and 10000`;
      }
    }

    return null;
  };

  const handlePreview = () => {
    setValidationError(null);
    setParsedTeams(null);

    try {
      const parsed = JSON.parse(jsonInput);

      if (!Array.isArray(parsed)) {
        setValidationError(t('teamImportModal.errors.mustBeArray'));
        return;
      }

      if (parsed.length === 0) {
        setValidationError(t('teamImportModal.errors.emptyArray'));
        return;
      }

      // Validate each team
      for (let i = 0; i < parsed.length; i++) {
        const validationErr = validateTeam(parsed[i], i);
        if (validationErr) {
          setValidationError(validationErr);
          return;
        }
      }

      setParsedTeams(parsed);
    } catch (err) {
      setValidationError(
        err instanceof Error
          ? t('teamImportModal.errors.parseWithMessage', { message: err.message })
          : t('teamImportModal.errors.parseGeneric')
      );
    }
  };

  const handleImport = async () => {
    if (!parsedTeams) return;

    setImporting(true);
    try {
      await onImport(parsedTeams);
      handleClose();
    } catch (err) {
      showError(
        err instanceof Error ? err.message : t('teamImportModal.errors.importFailed')
      );
    } finally {
      setImporting(false);
    }
  };

  const toggleTeamExpanded = (index: number) => {
    const newExpanded = new Set(expandedTeams);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedTeams(newExpanded);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" fontWeight={600}>
            {t('teamImportModal.title')}
          </Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 3, pt: 2, pb: 1 }}>
        <Stack spacing={3}>
          {/* Instructions */}
          <Alert severity="info" icon={<InfoIcon />}>
            <Typography variant="body2" gutterBottom>
              <strong>{t('teamImportModal.info.title')}</strong>
            </Typography>
            <Typography variant="caption" component="div">
              {t('teamImportModal.info.format')}
            </Typography>
            <Typography variant="caption" component="div" sx={{ mt: 1 }}>
              <Link
                href="https://docs.sivert.io/docs/mat/user/teams#bulk-import-json"
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
                {t('teamImportModal.info.link')}
                <OpenInNewIcon sx={{ fontSize: '0.875rem' }} />
              </Link>
            </Typography>
          </Alert>

          {/* JSON Input */}
          <TextField
            label={t('teamImportModal.jsonLabel')}
            multiline
            rows={12}
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`[\n  {\n    "name": "Team Name",\n    "tag": "TN",\n    "players": [\n      {\n        "name": "Player 1",\n        "steamId": "76561198123456789"\n      }\n    ]\n  }\n]`}
            fullWidth
            disabled={importing}
            error={!!validationError}
            helperText={validationError}
            sx={{
              '& .MuiInputBase-input': {
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              },
            }}
          />

          {/* Preview */}
          {parsedTeams && parsedTeams.length > 0 && (
            <Box>
              <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
                <Typography variant="body2">
                  {t('teamImportModal.preview.summary', {
                    teamCount: parsedTeams.length,
                    playerCount: parsedTeams.reduce((sum, t) => sum + t.players.length, 0),
                  })}
                </Typography>
              </Alert>

              <Typography variant="subtitle2" fontWeight={600} mb={1}>
                {t('teamImportModal.preview.title')}
              </Typography>

              <Stack spacing={1}>
                {parsedTeams.map((team, index) => (
                  <Paper key={index} variant="outlined" sx={{ overflow: 'hidden' }}>
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      p={2}
                      sx={{
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                      onClick={() => toggleTeamExpanded(index)}
                    >
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body1" fontWeight={600}>
                          {team.name}
                        </Typography>
                        {team.tag && <Chip label={team.tag} size="small" />}
                        <Chip
                          label={t('teamImportModal.preview.playersChip', {
                            count: team.players.length,
                          })}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                      <IconButton size="small">
                        {expandedTeams.has(index) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </Box>

                    <Collapse in={expandedTeams.has(index)}>
                      <Box px={2} pb={2} bgcolor="action.hover">
                        <Stack spacing={0.5}>
                          {team.players.map((player, pIndex) => (
                            <Box
                              key={pIndex}
                              display="flex"
                              alignItems="center"
                              justifyContent="space-between"
                              py={0.5}
                              gap={1}
                            >
                              <Box>
                                <PlayerName name={player.name} variant="body2" />
                                {player.elo !== undefined && (
                                  <Typography variant="caption" color="text.secondary">
                                    ELO: {player.elo}
                                  </Typography>
                                )}
                              </Box>
                              <Typography
                                variant="caption"
                                fontFamily="monospace"
                                color="text.secondary"
                              >
                                {player.steamId}
                              </Typography>
                            </Box>
                          ))}
                        </Stack>
                      </Box>
                    </Collapse>
                  </Paper>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        {!parsedTeams ? (
          <Button
            onClick={() => {
              if (!jsonInput.trim()) {
                showWarning(t('teamImportModal.errors.noJson'));
                return;
              }
              handlePreview();
            }}
            variant="contained"
            disabled={importing}
            sx={{
              ml: 'auto',
              ...(!jsonInput.trim() && {
                bgcolor: 'action.disabledBackground',
                color: 'action.disabled',
                '&:hover': {
                  bgcolor: 'action.disabledBackground',
                },
              }),
            }}
          >
            {t('teamImportModal.actions.preview')}
          </Button>
        ) : (
          <Button
            onClick={handleImport}
            variant="contained"
            disabled={importing}
            sx={{ ml: 'auto' }}
          >
            {importing
              ? t('teamImportModal.actions.importing')
              : t('teamImportModal.actions.import', { count: parsedTeams.length })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
