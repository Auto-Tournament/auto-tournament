import React from 'react';
import { Box, Typography, Chip, Alert, Button, Autocomplete, TextField } from '@mui/material';
import { Warning as WarningIcon, Add as AddIcon } from '@mui/icons-material';
import { Team } from '../../types';
import { validateTeamCountForType } from '../../utils/tournamentValidation';

interface TeamSelectionStepProps {
  teams: Team[];
  selectedTeams: string[];
  type: string;
  serverCount: number;
  requiredServers: number;
  hasEnoughServers: boolean;
  loadingServers: boolean;
  canEdit: boolean;
  saving: boolean;
  onTeamsChange: (teams: string[]) => void;
  onCreateTeam?: () => void;
  onImportTeams?: () => void;
  onAddServer?: () => void;
  onBatchAddServers?: () => void;
}

export function TeamSelectionStep({
  teams,
  selectedTeams,
  type,
  serverCount,
  requiredServers,
  hasEnoughServers,
  loadingServers,
  canEdit,
  saving,
  onTeamsChange,
  onCreateTeam,
  onImportTeams,
  onAddServer,
  onBatchAddServers,
}: TeamSelectionStepProps) {
  // Team count validation
  const teamCountValidation = selectedTeams.length > 0 ? validateTeamCountForType(type, selectedTeams.length) : null;

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <Chip
          label={`${selectedTeams.length} / ${teams.length}`}
          size="small"
          color={selectedTeams.length >= 2 ? 'success' : 'default'}
          variant="outlined"
        />
      </Box>

      {/* Team Count Validation Alert */}
      {teamCountValidation && !teamCountValidation.isValid && (
        <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
          <Typography variant="body2">{teamCountValidation.error}</Typography>
        </Alert>
      )}

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

      {/* Not Enough Teams Alert */}
      {teams.length < 2 && (
        <Alert
          severity="error"
          icon={<WarningIcon />}
          sx={{ mb: 2 }}
          action={
            <Box display="flex" gap={1}>
              {onImportTeams && (
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={onImportTeams}
                >
                  Import Teams
                </Button>
              )}
              <Button
                color="inherit"
                size="small"
                startIcon={<AddIcon />}
                onClick={onCreateTeam || (() => (window.location.href = '/teams'))}
              >
                Create Team
              </Button>
            </Box>
          }
        >
          <Typography variant="body2">
            You need at least <strong>2 teams</strong> to create a tournament. You currently have{' '}
            <strong>{teams.length}</strong> team(s).
          </Typography>
        </Alert>
      )}

      <Box display="flex" gap={1} alignItems="flex-start">
        <Autocomplete
          multiple
          options={teams}
          getOptionLabel={(option) => option.name}
          value={teams.filter((team) => selectedTeams.includes(team.id))}
          onChange={(_, newValue) => onTeamsChange(newValue.map((t) => t.id))}
          disabled={!canEdit || saving}
          sx={{ flex: 1 }}
          renderInput={(params) => <TextField {...params} placeholder="Choose teams..." />}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip label={option.name} {...getTagProps({ index })} key={option.id} />
            ))
          }
        />
        <Button
          variant="outlined"
          onClick={() => onTeamsChange(teams.map((t) => t.id))}
          disabled={!canEdit || saving || teams.length === 0}
          sx={{ mt: 1 }}
        >
          Add All
        </Button>
      </Box>
    </Box>
  );
}
