import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Alert,
  Button,
  Stack,
  Autocomplete,
  Grid,
  Divider,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  DeleteForever as DeleteForeverIcon,
} from '@mui/icons-material';
import { TOURNAMENT_TYPES, MATCH_FORMATS, CS2_MAPS } from '../../constants/tournament';
import { isTournamentTypeValid } from '../../utils/tournamentValidation';
import { Team } from '../../types';

interface TournamentFormProps {
  name: string;
  type: string;
  format: string;
  selectedTeams: string[];
  maps: string[];
  teams: Team[];
  canEdit: boolean;
  saving: boolean;
  tournamentExists: boolean;
  hasChanges?: boolean;
  onNameChange: (name: string) => void;
  onTypeChange: (type: string) => void;
  onFormatChange: (format: string) => void;
  onTeamsChange: (teams: string[]) => void;
  onMapsChange: (maps: string[]) => void;
  onSave: () => void;
  onCancel?: () => void;
  onDelete: () => void;
}

export const TournamentForm: React.FC<TournamentFormProps> = ({
  name,
  type,
  format,
  selectedTeams,
  maps,
  teams,
  canEdit,
  saving,
  tournamentExists,
  hasChanges = true,
  onNameChange,
  onTypeChange,
  onFormatChange,
  onTeamsChange,
  onMapsChange,
  onSave,
  onCancel,
  onDelete,
}) => {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {tournamentExists ? 'Edit Tournament' : 'Create Tournament'}
        </Typography>

        <Stack spacing={3}>
          <TextField
            label="Tournament Name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            disabled={!canEdit || saving}
            fullWidth
            required
          />

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
                  {TOURNAMENT_TYPES.map((option) => {
                    const isValid = isTournamentTypeValid(option, selectedTeams.length);
                    return (
                      <MenuItem key={option.value} value={option.value} disabled={option.disabled}>
                        <Box display="flex" alignItems="center" gap={1} width="100%">
                          {isValid ? (
                            <CheckCircleIcon fontSize="small" sx={{ color: 'success.main' }} />
                          ) : (
                            <WarningIcon fontSize="small" sx={{ color: 'warning.main' }} />
                          )}
                          <Box flex={1}>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Typography variant="body1">{option.label}</Typography>
                              {!isValid && (
                                <Chip
                                  label="Not available"
                                  size="small"
                                  color="warning"
                                  sx={{ height: 20 }}
                                />
                              )}
                            </Box>
                            {option.description && (
                              <Typography variant="caption" color="text.secondary">
                                {option.description}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </MenuItem>
                    );
                  })}
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

          {/* Team Count Validation Alert */}
          {(() => {
            const tournamentType = TOURNAMENT_TYPES.find((t) => t.value === type);
            if (!tournamentType || selectedTeams.length === 0) return null;

            const teamCount = selectedTeams.length;
            const isValid = isTournamentTypeValid(tournamentType, teamCount);

            if (isValid) return null;

            return (
              <Alert severity="warning" icon={<WarningIcon />}>
                <Typography variant="body2">
                  <strong>{tournamentType.label}</strong> needs a team count that keeps
                  doubling—like 2, 4, 8, 16… You have <strong>{teamCount}</strong> team(s) selected.
                </Typography>
              </Alert>
            );
          })()}

          <Box>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <Typography variant="subtitle2" fontWeight={600}>
                Select Teams
              </Typography>
              <Chip
                label={`${selectedTeams.length} / ${teams.length}`}
                size="small"
                color="primary"
                variant="outlined"
              />
            </Box>
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

          <Box>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <Typography variant="subtitle2" fontWeight={600}>
                Map Pool
              </Typography>
              <Chip
                label={`${maps.length} / ${CS2_MAPS.length}`}
                size="small"
                color="primary"
                variant="outlined"
              />
            </Box>
            <Box display="flex" gap={1} alignItems="flex-start">
              <Autocomplete
                multiple
                options={CS2_MAPS}
                value={maps}
                onChange={(_, newValue) => onMapsChange(newValue)}
                disabled={!canEdit || saving}
                sx={{ flex: 1 }}
                renderInput={(params) => <TextField {...params} placeholder="Choose maps..." />}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip label={option} {...getTagProps({ index })} key={option} />
                  ))
                }
              />
              <Button
                variant="outlined"
                onClick={() => onMapsChange([...CS2_MAPS])}
                disabled={!canEdit || saving || CS2_MAPS.length === 0}
                sx={{ mt: 1 }}
              >
                Add All
              </Button>
            </Box>
          </Box>

          {canEdit && (
            <>
              <Divider />
              <Box display="flex" gap={2} flexWrap="wrap">
                {
                  <Button
                    variant="contained"
                    onClick={onSave}
                    disabled={saving || !hasChanges}
                    size="large"
                    sx={{ flex: 1, minWidth: 200 }}
                  >
                    {saving ? (
                      <CircularProgress size={24} />
                    ) : tournamentExists ? (
                      'Save & Generate Brackets'
                    ) : (
                      'Create Tournament'
                    )}
                  </Button>
                }
                {tournamentExists && onCancel && (
                  <Button variant="outlined" onClick={onCancel} disabled={saving}>
                    Cancel
                  </Button>
                )}
                {tournamentExists && (
                  <Tooltip title="Permanently delete this tournament and all its data">
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteForeverIcon />}
                      onClick={onDelete}
                      disabled={saving}
                    >
                      Delete
                    </Button>
                  </Tooltip>
                )}
              </Box>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};
