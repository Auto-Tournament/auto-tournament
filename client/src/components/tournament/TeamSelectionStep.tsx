import { Box, Typography, Chip, Alert, Button, Autocomplete, TextField } from '@mui/material';
import { Warning as WarningIcon, Add as AddIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { Team } from '../../types';
import { validateTeamCountForType } from '../../utils/tournamentValidation';
import { paths } from '../../paths';

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
  const { t } = useTranslation();
  // Hide shuffle-generated temporary teams from selection (IDs prefixed with "shuffle-")
  const selectableTeams = teams.filter((team) => !team.id.startsWith('shuffle-'));

  // Team count validation
  const teamCountValidation =
    selectedTeams.length > 0 ? validateTeamCountForType(type, selectedTeams.length, t) : null;

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <Chip
          label={`${selectedTeams.length} / ${selectableTeams.length}`}
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
                  {t('tournament.teamSelection.batchAddServers')}
                </Button>
              )}
              <Button
                color="inherit"
                size="small"
                startIcon={<AddIcon />}
                onClick={onAddServer || (() => (window.location.href = paths.servers))}
              >
                {t('tournament.teamSelection.addServer')}
              </Button>
            </Box>
          }
        >
          <Typography variant="body2">
            {t('tournament.teamSelection.notEnoughServers', {
              matches: t('tournament.counts.concurrentMatches', { count: requiredServers }),
              servers: t('tournament.counts.enabledServers', { count: serverCount }),
            })}
          </Typography>
        </Alert>
      )}

      {/* Not Enough Teams Alert */}
      {selectableTeams.length < 2 && (
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
                  {t('tournament.teamSelection.importTeams')}
                </Button>
              )}
              <Button
                color="inherit"
                size="small"
                startIcon={<AddIcon />}
                onClick={onCreateTeam || (() => (window.location.href = '/teams'))}
              >
                {t('tournament.teamSelection.createTeam')}
              </Button>
            </Box>
          }
        >
          <Typography variant="body2">
            {t('tournament.teamSelection.notEnoughTeams', {
              teams: t('tournament.counts.teams', { count: selectableTeams.length }),
            })}
          </Typography>
        </Alert>
      )}

      <Box display="flex" gap={1} alignItems="flex-start">
        <Autocomplete
          multiple
          options={selectableTeams}
          getOptionLabel={(option) => option.name}
          value={selectableTeams.filter((team) => selectedTeams.includes(team.id))}
          onChange={(_, newValue) => onTeamsChange(newValue.map((t) => t.id))}
          disabled={!canEdit || saving}
          sx={{ flex: 1 }}
          renderInput={(params) => <TextField {...params} placeholder={t('tournament.teamSelection.chooseTeamsPlaceholder')} />}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip label={option.name} {...getTagProps({ index })} key={option.id} />
            ))
          }
        />
        <Button
          variant="outlined"
          onClick={() => onTeamsChange(selectableTeams.map((t) => t.id))}
          disabled={!canEdit || saving || selectableTeams.length === 0}
          sx={{ mt: 1 }}
        >
          {t('tournament.teamSelection.addAll')}
        </Button>
      </Box>
    </Box>
  );
}
