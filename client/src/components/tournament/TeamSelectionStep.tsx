import React from 'react';
import { Box, Typography, Chip, Alert, Button, Autocomplete, TextField } from '@mui/material';
import { Warning as WarningIcon, Add as AddIcon } from '@mui/icons-material';
import { Team } from '../../types';

interface TeamSelectionStepProps {
  teams: Team[];
  selectedTeams: string[];
  canEdit: boolean;
  saving: boolean;
  onTeamsChange: (teams: string[]) => void;
  onCreateTeam?: () => void;
}

export function TeamSelectionStep({
  teams,
  selectedTeams,
  canEdit,
  saving,
  onTeamsChange,
  onCreateTeam,
}: TeamSelectionStepProps) {
  return (
    <Box>
      <Typography variant="overline" color="primary" fontWeight={600}>
        Step 2
      </Typography>
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <Typography variant="subtitle2" fontWeight={600}>
          Select Teams
        </Typography>
        <Chip
          label={`${selectedTeams.length} / ${teams.length}`}
          size="small"
          color={selectedTeams.length >= 2 ? 'success' : 'default'}
          variant="outlined"
        />
      </Box>

      {/* Not Enough Teams Alert */}
      {teams.length < 2 && (
        <Alert
          severity="error"
          icon={<WarningIcon />}
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<AddIcon />}
              onClick={onCreateTeam || (() => (window.location.href = '/teams'))}
            >
              Create Team
            </Button>
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
