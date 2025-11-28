import React from 'react';
import {
  Box,
  Typography,
  Alert,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Warning as WarningIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { TOURNAMENT_TYPES, MATCH_FORMATS } from '../../constants/tournament';
import { validateTeamCountForType } from '../../utils/tournamentValidation';

interface TournamentTypeFormatStepProps {
  type: string;
  format: string;
  selectedTeams: string[];
  maps: string[];
  serverCount: number;
  requiredServers: number;
  hasEnoughServers: boolean;
  loadingServers: boolean;
  canEdit: boolean;
  saving: boolean;
  onTypeChange: (type: string) => void;
  onFormatChange: (format: string) => void;
  onAddServer?: () => void;
  onBatchAddServers?: () => void;
}

export function TournamentTypeFormatStep({
  type,
  format,
  selectedTeams,
  serverCount,
  requiredServers,
  hasEnoughServers,
  loadingServers,
  canEdit,
  saving,
  onTypeChange,
  onFormatChange,
  onAddServer,
  onBatchAddServers,
}: TournamentTypeFormatStepProps) {
  return (
    <Box>
      <Typography variant="overline" color="primary" fontWeight={600}>
        Step 4
      </Typography>
      <Typography variant="subtitle2" fontWeight={600} mb={2}>
        Tournament Type & Format
      </Typography>

      {/* Team Count Validation Alert */}
      {selectedTeams.length > 0 && (() => {
        const validation = validateTeamCountForType(type, selectedTeams.length);
        if (!validation.isValid) {
          return (
            <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
              <Typography variant="body2">{validation.error}</Typography>
            </Alert>
          );
        }
        return null;
      })()}

      {/* Not Enough Servers Alert */}
      {!loadingServers && selectedTeams.length >= 2 && !hasEnoughServers && (
        <Alert
          severity="warning"
          icon={<WarningIcon />}
          sx={{ mb: 2 }}
          action={
            <Box display="flex" gap={1}>
              {onBatchAddServers && (
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={onBatchAddServers}
                >
                  Batch Add
                </Button>
              )}
              <Button
                color="inherit"
                size="small"
                startIcon={<AddIcon />}
                onClick={onAddServer || (() => (window.location.href = '/servers'))}
              >
                Add Server
              </Button>
            </Box>
          }
        >
          <Typography variant="body2">
            The first round will have <strong>{requiredServers}</strong> concurrent match
            {requiredServers !== 1 ? 'es' : ''}, but you only have <strong>{serverCount}</strong>{' '}
            enabled server{serverCount !== 1 ? 's' : ''}. Add more servers or matches will queue.
          </Typography>
        </Alert>
      )}

      {/* Rules and Guidelines based on Tournament Type and Format */}
      {type && format && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} gutterBottom>
            Requirements for {type.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())} -{' '}
            {format.toUpperCase()}:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {['bo1', 'bo3', 'bo5'].includes(format) && (
              <li>
                <Typography variant="body2">
                  <strong>Map Selection:</strong> You must select exactly <strong>7 maps</strong>{' '}
                  for the veto system. Teams will ban/pick maps from this pool during the match
                  setup.
                </Typography>
              </li>
            )}
            {!['bo1', 'bo3', 'bo5'].includes(format) && (
              <li>
                <Typography variant="body2">
                  <strong>Map Selection:</strong> Select at least <strong>1 map</strong>. Maps will
                  be used for rotation in {type === 'round_robin' ? 'Round Robin' : 'Swiss System'}{' '}
                  matches.
                </Typography>
              </li>
            )}
            {(type === 'single_elimination' || type === 'double_elimination') && (
              <li>
                <Typography variant="body2">
                  <strong>Team Count:</strong> Requires a power-of-2 number of teams (2, 4, 8, 16,
                  32, 64, or 128).
                </Typography>
              </li>
            )}
            {type === 'round_robin' && (
              <li>
                <Typography variant="body2">
                  <strong>Team Count:</strong> Supports 2-32 teams. Each team plays every other team
                  once.
                </Typography>
              </li>
            )}
            {type === 'swiss' && (
              <li>
                <Typography variant="body2">
                  <strong>Team Count:</strong> Supports 4-64 teams. Teams with similar records face
                  each other in each round.
                </Typography>
              </li>
            )}
            {format === 'bo1' && (
              <li>
                <Typography variant="body2">
                  <strong>Match Format:</strong> Best of 1 - First team to win 1 map wins the match.
                </Typography>
              </li>
            )}
            {format === 'bo3' && (
              <li>
                <Typography variant="body2">
                  <strong>Match Format:</strong> Best of 3 - First team to win 2 maps wins the
                  match.
                </Typography>
              </li>
            )}
            {format === 'bo5' && (
              <li>
                <Typography variant="body2">
                  <strong>Match Format:</strong> Best of 5 - First team to win 3 maps wins the
                  match.
                </Typography>
              </li>
            )}
          </Box>
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Tournament Type</InputLabel>
            <Select
              value={type}
              label="Tournament Type"
              onChange={(e) => onTypeChange(e.target.value)}
              disabled={!canEdit || saving}
            >
              {TOURNAMENT_TYPES.map((option) => (
                <MenuItem key={option.value} value={option.value} disabled={option.disabled}>
                  <Box>
                    <Typography variant="body1">{option.label}</Typography>
                    {option.description && (
                      <Typography variant="caption" color="text.secondary">
                        {option.description}
                      </Typography>
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Match Format</InputLabel>
            <Select
              value={format}
              label="Match Format"
              onChange={(e) => onFormatChange(e.target.value)}
              disabled={!canEdit || saving}
            >
              {MATCH_FORMATS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
      </Grid>
    </Box>
  );
}

