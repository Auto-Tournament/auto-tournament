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

