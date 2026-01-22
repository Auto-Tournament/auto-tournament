import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Box,
  Button,
  Stepper,
  Step,
  StepLabel,
  Stack,
  Alert,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Tooltip,
} from '@mui/material';
import { ArrowBack, ArrowForward } from '@mui/icons-material';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { TournamentNameStep } from './TournamentNameStep';
import { TournamentTypeSelector } from './TournamentTypeSelector';
import { TournamentFormatStep } from './TournamentFormatStep';
import { MapPoolStep } from './MapPoolStep';
import { TeamSelectionStep } from './TeamSelectionStep';
import {
  ShuffleTournamentConfigStep,
  type ShuffleTournamentSettings,
} from './ShuffleTournamentConfigStep';
import { TournamentFormActions } from './TournamentFormActions';
import { useTournamentFormData } from './useTournamentFormData';
import { useTranslation } from 'react-i18next';
import SaveMapPoolModal from '../modals/SaveMapPoolModal';
import TeamModal from '../modals/TeamModal';
import { TeamImportModal } from '../modals/TeamImportModal';
import ServerModal from '../modals/ServerModal';
import BatchServerModal from '../modals/BatchServerModal';
import { api } from '../../utils/api';
import type { Team, Server } from '../../types';
import type { MapPoolsResponse } from '../../types/api.types';
import type { EloCalculationTemplate } from '../../types/elo.types';
import { validateMapCount } from '../../utils/tournamentVerification';

interface TournamentFormStepsProps {
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
  mapPoolId?: number | null;
  shuffleSettings?: ShuffleTournamentSettings;
  eloTemplates?: EloCalculationTemplate[];
  maxRounds?: number;
  onMaxRoundsChange?: (value: number) => void;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number | null;
  grandFinalMode?: 'none' | 'simple' | 'double';
  onOvertimeModeChange?: (mode: 'enabled' | 'disabled') => void;
  onOvertimeSegmentsChange?: (segments: number | null) => void;
  onGrandFinalModeChange?: (mode: 'none' | 'simple' | 'double') => void;
  onNameChange: (name: string) => void;
  onTypeChange: (type: string) => void;
  onFormatChange: (format: string) => void;
  onTeamsChange: (teams: string[]) => void;
  onMapsChange: (maps: string[]) => void;
  onShuffleSettingsChange?: (settings: ShuffleTournamentSettings) => void;
  onSave: () => void;
  onCancel?: () => void;
  onDelete: () => void;
  onSaveTemplate?: (mapPoolId: number | null) => void;
  onRefreshTeams?: () => void;
  onBackToWelcome?: () => void;
}

const STEPS = ['name', 'type', 'format', 'maps', 'teams', 'review'] as const;
const STEP_STORAGE_KEY = 'tournament_form_step';

export function TournamentFormSteps({
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
  mapPoolId,
  shuffleSettings,
  eloTemplates,
  maxRounds,
  onMaxRoundsChange,
  overtimeMode,
  overtimeSegments,
  grandFinalMode,
  onOvertimeModeChange,
  onOvertimeSegmentsChange,
  onGrandFinalModeChange,
  onNameChange,
  onTypeChange,
  onFormatChange,
  onTeamsChange,
  onMapsChange,
  onShuffleSettingsChange,
  onSave,
  onCancel,
  onDelete,
  onSaveTemplate,
  onRefreshTeams,
  onBackToWelcome,
}: TournamentFormStepsProps) {
  const { t } = useTranslation();
  // Load saved step from sessionStorage on mount
  const [activeStep, setActiveStep] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STEP_STORAGE_KEY);
      if (saved !== null) {
        const step = parseInt(saved, 10);
        if (step >= 0 && step < STEPS.length) {
          return step;
        }
      }
    } catch (error) {
      console.error('Error loading step from sessionStorage:', error);
    }
    return 0;
  });
  const [selectedMapPool, setSelectedMapPool] = useState<string>('');
  const [saveMapPoolModalOpen, setSaveMapPoolModalOpen] = useState(false);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamImportModalOpen, setTeamImportModalOpen] = useState(false);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [batchServerModalOpen, setBatchServerModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [servers, setServers] = useState<Server[]>([]);

  const {
    serverCount,
    loadingServers,
    mapPools,
    availableMaps,
    loadingMaps,
    setMapPools,
    refreshServers,
  } = useTournamentFormData({
    maps,
    selectedMapPool,
    onMapsChange,
  });

  // Track previous tournament type so we can detect transitions into shuffle.
  const prevTypeRef = React.useRef<string | null>(null);

  // Load servers for the modals
  React.useEffect(() => {
    const loadServers = async () => {
      try {
        const response = await api.get<{ servers: Server[] }>('/api/servers');
        setServers(response.servers || []);
      } catch (err) {
        console.error('Failed to load servers:', err);
      }
    };
    loadServers();
  }, []);

  // Initialize selectedMapPool based on tournament type + mapPoolId prop or default map pool
  // when mapPools load. For standard brackets (single/double elimination), prefer the
  // "Active Duty" pool when available so tournament creation always starts from that
  // familiar baseline, regardless of which pool is marked as default elsewhere.
  React.useEffect(() => {
    if (mapPools.length > 0 && !selectedMapPool) {
      // For shuffle tournaments, default to "Custom" so organizers are nudged
      // to pick an explicit sequence of maps instead of a static pool.
      if (type === 'shuffle') {
        setSelectedMapPool('custom');
        return;
      }

      // If mapPoolId is provided (e.g., from template), use it
      if (mapPoolId !== null && mapPoolId !== undefined) {
        const pool = mapPools.find((p) => p.id === mapPoolId);
        if (pool) {
          setSelectedMapPool(pool.id.toString());
          return;
        }
      }

      // For classic brackets (single/double elimination) with no maps selected yet,
      // try to default to the "Active Duty" pool if it exists and is enabled.
      if (maps.length === 0) {
        if (type === 'single_elimination' || type === 'double_elimination') {
          const activeDutyPool = mapPools.find(
            (p) => p.enabled && p.name.toLowerCase() === 'active duty'
          );
          if (activeDutyPool) {
            setSelectedMapPool(activeDutyPool.id.toString());
            return;
          }
        }

        // Fallback: use whatever pool is marked as default, or the first enabled pool.
        const defaultPool = mapPools.find((p) => p.isDefault);
        if (defaultPool) {
          setSelectedMapPool(defaultPool.id.toString());
        } else {
          const firstEnabled = mapPools.find((p) => p.enabled) ?? mapPools[0];
          if (firstEnabled) {
            setSelectedMapPool(firstEnabled.id.toString());
          }
        }
      }
    }
  }, [mapPools, selectedMapPool, maps.length, mapPoolId, type]);

  // When switching from a non-shuffle type to shuffle in the wizard, default
  // to a clean "Custom" pool with zero maps instead of inheriting the previous
  // static pool (e.g., Active Duty).
  React.useEffect(() => {
    const prevType = prevTypeRef.current;
    if (type === 'shuffle' && prevType && prevType !== 'shuffle') {
      setSelectedMapPool('custom');
      if (maps.length > 0) {
        onMapsChange([]);
      }
    }
    prevTypeRef.current = type;
  }, [type, maps.length, onMapsChange]);

  const handleMapPoolChange = (poolId: string) => {
    setSelectedMapPool(poolId);
    if (poolId === 'custom') {
      // Clear maps when switching to custom so user can start fresh
      onMapsChange([]);
      return;
    }
    const pool = mapPools.find((p) => p.id.toString() === poolId);
    if (pool) {
      onMapsChange(pool.mapIds);
    }
  };

  const handleMapRemove = (mapId: string) => {
    // If a map pool is selected (not custom), switch to custom mode
    if (selectedMapPool && selectedMapPool !== 'custom') {
      setSelectedMapPool('custom');
    }
    // Remove the map from the list
    const newMaps = maps.filter((id) => id !== mapId);
    onMapsChange(newMaps);
  };

  // Save step to sessionStorage whenever it changes
  React.useEffect(() => {
    try {
      sessionStorage.setItem(STEP_STORAGE_KEY, activeStep.toString());
    } catch (error) {
      console.error('Error saving step to sessionStorage:', error);
    }
  }, [activeStep]);

  const handleNext = () => {
    // Show warnings for missing requirements but allow proceeding
    const validationMessage = getValidationMessage();

    if (validationMessage) {
      showWarning(validationMessage);
      // Still allow proceeding - don't block
    }

    if (activeStep < STEPS.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    } else if (activeStep === 0 && onBackToWelcome) {
      // If on first step and callback provided, go back to welcome screen
      onBackToWelcome();
    }
  };

  const { showWarning } = useSnackbar();

  // Use verification rules system
  const mapValidation = validateMapCount(maps, type, format);
  const isValidMaps = mapValidation.valid;
  const canProceedFromStep0 = name.trim().length > 0; // Just name required
  const canProceedFromStep1 = !!type; // Type required
  const canProceedFromStep2 = !!format || type === 'shuffle'; // Format required (or shuffle which auto-sets format)
  const canProceedFromStep3 = isValidMaps;

  // Step 4 validation - no player validation needed (players registered after creation)
  const canProceedFromStep4 = true; // Always allow proceeding from step 4

  const canProceed = () => {
    switch (activeStep) {
      case 0:
        return canProceedFromStep0;
      case 1:
        return canProceedFromStep1;
      case 2:
        return canProceedFromStep2;
      case 3:
        return canProceedFromStep3;
      case 4:
        return canProceedFromStep4;
      default:
        return true;
    }
  };

  const getValidationMessage = () => {
    switch (activeStep) {
      case 0:
        return canProceedFromStep0 ? null : 'Tournament name is required';
      case 1:
        return canProceedFromStep1 ? null : 'Please select a tournament type';
      case 2:
        return canProceedFromStep2 ? null : 'Please select a match format';
      case 3:
        return isValidMaps ? null : mapValidation.message || 'Invalid map selection';
      case 4:
        // No validation needed for step 4 (players registered after creation)
        return null;
      default:
        return null;
    }
  };

  const getMatchVolumeEstimate = () => {
    const teamCount = selectedTeams.length;
    const mapsPerMatch = format === 'bo3' ? 3 : format === 'bo5' ? 5 : 1;

    if (type === 'shuffle') {
      return {
        totalRounds: maps.length,
        totalMatches: undefined as number | undefined,
        mapsPerMatch: 1,
        totalMaps: maps.length,
      };
    }

    if (teamCount < 2) {
      return null;
    }

    switch (type) {
      case 'single_elimination': {
        const totalMatches = Math.max(0, teamCount - 1);
        const totalRounds = Math.ceil(Math.log2(teamCount));
        return {
          totalRounds,
          totalMatches,
          mapsPerMatch,
          totalMaps: totalMatches * mapsPerMatch,
        };
      }
      case 'round_robin': {
        const totalMatches = (teamCount * (teamCount - 1)) / 2;
        const totalRounds = Math.max(0, teamCount - 1);
        return {
          totalRounds,
          totalMatches,
          mapsPerMatch,
          totalMaps: totalMatches * mapsPerMatch,
        };
      }
      case 'swiss': {
        const totalRounds = Math.ceil(Math.log2(teamCount));
        const totalMatches = Math.floor(teamCount / 2) * totalRounds;
        return {
          totalRounds,
          totalMatches,
          mapsPerMatch,
          totalMaps: totalMatches * mapsPerMatch,
        };
      }
      default:
        return null;
    }
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <TournamentNameStep
            name={name}
            canEdit={canEdit}
            saving={saving}
            onNameChange={onNameChange}
          />
        );
      case 1:
        return (
          <TournamentTypeSelector
            selectedType={type}
            onTypeChange={onTypeChange}
            disabled={!canEdit || saving}
          />
        );
      case 2:
        return (
          <TournamentFormatStep
            type={type}
            format={format}
            canEdit={canEdit}
            saving={saving}
            onFormatChange={onFormatChange}
          />
        );
      case 3:
        return (
          <MapPoolStep
            format={format}
            type={type}
            maps={maps}
            mapPools={mapPools}
            availableMaps={availableMaps}
            selectedMapPool={selectedMapPool}
            loadingMaps={loadingMaps}
            canEdit={canEdit}
            saving={saving}
            onMapPoolChange={handleMapPoolChange}
            onMapsChange={onMapsChange}
            onMapRemove={handleMapRemove}
            onSaveMapPool={() => setSaveMapPoolModalOpen(true)}
          />
        );
      case 4: {
        // Shuffle tournament configuration or team selection
        if (type === 'shuffle') {
          const volume = getMatchVolumeEstimate();
          return (
            <Stack spacing={3}>
              <Alert severity="info">
                Shuffle tournaments don&apos;t use fixed teams. Players will be automatically
                balanced into teams for each match based on their Skill Ratings.
              </Alert>
              {volume && (
                <Alert severity="info">
                  This shuffle tournament will have approximately{' '}
                  <strong>{volume.totalRounds}</strong> round{volume.totalRounds === 1 ? '' : 's'}{' '}
                  (one per selected map).
                </Alert>
              )}
              {shuffleSettings && onShuffleSettingsChange && (
                <ShuffleTournamentConfigStep
                  settings={shuffleSettings}
                  canEdit={canEdit}
                  saving={saving}
                  onSettingsChange={onShuffleSettingsChange}
                  eloTemplates={eloTemplates}
                />
              )}
            </Stack>
          );
        }
        const volume = getMatchVolumeEstimate();
        return (
          <Stack spacing={2}>
            {volume && (
              <Alert severity="info">
                With <strong>{selectedTeams.length}</strong> team
                {selectedTeams.length === 1 ? '' : 's'} in a{' '}
                <strong>{type.replace('_', ' ')}</strong> {format.toUpperCase()} tournament, this
                bracket will have approximately <strong>{volume.totalMatches}</strong> match
                {volume.totalMatches === 1 ? '' : 'es'} across <strong>{volume.totalRounds}</strong>{' '}
                round
                {volume.totalRounds === 1 ? '' : 's'} (up to <strong>{volume.totalMaps}</strong> map
                {volume.totalMaps === 1 ? '' : 's'} total).
              </Alert>
            )}
            {typeof maxRounds === 'number' && onMaxRoundsChange && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Match Rules
                </Typography>
                <TextField
                  label="Max Rounds per Map"
                  type="number"
                  value={maxRounds}
                  onChange={(event) => {
                    const value = parseInt(event.target.value, 10);
                    onMaxRoundsChange(Number.isNaN(value) ? 0 : value);
                  }}
                  disabled={!canEdit || saving}
                  slotProps={{
                    htmlInput: {
                      min: 1,
                      max: 30,
                      'data-testid': 'tournament-max-rounds-field',
                    },
                  }}
                  helperText={
                    maxRounds > 0
                      ? `Each map plays up to ${maxRounds} rounds; winner is first to ${
                          Math.floor(maxRounds / 2) + 1
                        } rounds.`
                      : 'Maximum number of rounds per map (default: 24, max: 30).'
                  }
                  error={maxRounds <= 0 || maxRounds > 30}
                  fullWidth
                />

                <Box mt={3}>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Overtime Settings
                  </Typography>
                  <Tooltip
                    title={
                      'Control overtime behaviour and how ties at max rounds are handled. ' +
                      'These settings are passed through to MatchZy as overtimeMode/overtimeSegments ' +
                      'and share the same semantics as shuffle tournaments and manual matches.'
                    }
                    arrow
                    placement="top"
                    enterDelay={500}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: { xs: 'column', sm: 'row' },
                        gap: 2,
                      }}
                    >
                      <FormControl sx={{ flex: 1, minWidth: 160 }}>
                        <InputLabel id="tournament-overtime-mode-label">Overtime</InputLabel>
                        <Select
                          labelId="tournament-overtime-mode-label"
                          value={overtimeMode ?? 'enabled'}
                          label="Overtime"
                          onChange={(event) =>
                            onOvertimeModeChange?.(event.target.value as 'enabled' | 'disabled')
                          }
                          disabled={!canEdit || saving}
                        >
                          <MenuItem value="enabled">Enabled (standard overtime)</MenuItem>
                          <MenuItem value="disabled">Disabled (no overtime)</MenuItem>
                        </Select>
                      </FormControl>

                      <TextField
                        sx={{ flex: 1, minWidth: 200 }}
                        label="Overtime segments (optional)"
                        type="number"
                        value={typeof overtimeSegments === 'number' ? overtimeSegments : ''}
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          if (!onOvertimeSegmentsChange) return;
                          if (raw === '') {
                            onOvertimeSegmentsChange(null);
                            return;
                          }
                          const parsed = Number(raw);
                          if (!Number.isFinite(parsed) || parsed < 0) {
                            onOvertimeSegmentsChange(null);
                            return;
                          }
                          onOvertimeSegmentsChange(parsed);
                        }}
                        disabled={!canEdit || saving || overtimeMode === 'disabled'}
                        slotProps={{
                          htmlInput: { min: 0, max: 10 },
                        }}
                        helperText="Optional: limit the number of overtime segments. Leave empty for MatchZy default."
                        fullWidth
                      />
                    </Box>
                  </Tooltip>
                </Box>
                {type === 'double_elimination' && onGrandFinalModeChange && (
                  <Box mt={3}>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      Grand Final Mode (Double Elimination)
                    </Typography>
                    <FormControl fullWidth sx={{ mb: 1 }}>
                      <InputLabel id="tournament-grand-final-mode-label">Grand Final</InputLabel>
                      <Select
                        labelId="tournament-grand-final-mode-label"
                        value={grandFinalMode ?? 'simple'}
                        label="Grand Final"
                        onChange={(event) =>
                          onGrandFinalModeChange(
                            event.target.value as 'none' | 'simple' | 'double'
                          )
                        }
                        disabled={!canEdit || saving}
                      >
                        <MenuItem value="simple">
                          Simple – single Grand Final between winners and losers bracket champions
                        </MenuItem>
                        <MenuItem value="none">
                          None – winners bracket final decides the tournament (no Grand Final)
                        </MenuItem>
                        <MenuItem value="double">
                          Double – bracket‑reset style (currently behaves like Simple; full reset
                          support is planned)
                        </MenuItem>
                      </Select>
                      <FormHelperText>
                        Controls how the champions of the winners and losers brackets meet at the end
                        of the tournament.
                      </FormHelperText>
                    </FormControl>
                  </Box>
                )}
              </Box>
            )}
            <TeamSelectionStep
              teams={teams}
              selectedTeams={selectedTeams}
              type={type}
              serverCount={serverCount}
              requiredServers={Math.ceil(selectedTeams.length / 2)}
              hasEnoughServers={serverCount >= Math.ceil(selectedTeams.length / 2)}
              loadingServers={loadingServers}
              canEdit={canEdit}
              saving={saving}
              onTeamsChange={onTeamsChange}
              onCreateTeam={() => setTeamModalOpen(true)}
              onImportTeams={() => setTeamImportModalOpen(true)}
              onAddServer={() => {
                setEditingServer(null);
                setServerModalOpen(true);
              }}
              onBatchAddServers={() => setBatchServerModalOpen(true)}
            />
          </Stack>
        );
      }
      case 5: {
        const volumeReview = getMatchVolumeEstimate();
        const requiredServers = Math.max(1, Math.ceil(selectedTeams.length / 2));
        const hasEnoughServers = serverCount >= requiredServers;
        return (
          <Stack spacing={2}>
            <Alert severity="info">
              {t('tournament.review.summary.info')}
            </Alert>
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                {t('tournament.review.summary.nameLabel')}
              </Typography>
              <Typography variant="body1" color="text.secondary" mb={2}>
                {name || t('tournament.review.summary.notSet')}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                {t('tournament.review.summary.typeLabel')}
              </Typography>
              <Typography variant="body1" color="text.secondary" mb={2}>
                {type.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                {t('tournament.review.summary.formatLabel')}
              </Typography>
              <Typography variant="body1" color="text.secondary" mb={2}>
                {format.toUpperCase()}
              </Typography>
            </Box>
            {type !== 'shuffle' && typeof maxRounds === 'number' && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Match Rules
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Max {maxRounds} rounds per map; winner is first to{' '}
                  {Math.floor(maxRounds / 2) + 1} rounds.
                </Typography>
              </Box>
            )}
            {type !== 'shuffle' && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Servers
                </Typography>
                <Typography
                  variant="body2"
                  color={hasEnoughServers ? 'text.secondary' : 'error.main'}
                >
                  {serverCount} server{serverCount === 1 ? '' : 's'} configured;&nbsp;
                  <strong>{requiredServers}</strong> required to run all matches in this bracket.
                </Typography>
              </Box>
            )}
            {volumeReview && type !== 'shuffle' && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Estimated Volume
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('tournament.review.summary.estimatedVolume', {
                    matches: volumeReview.totalMatches,
                    rounds: volumeReview.totalRounds,
                    mapsPerMatch: volumeReview.mapsPerMatch,
                    totalMaps: volumeReview.totalMaps,
                  })}
                </Typography>
              </Box>
            )}
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Maps ({maps.length})
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {maps.join(', ') || 'No maps selected'}
              </Typography>
            </Box>
            {type === 'shuffle' && shuffleSettings && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Match Configuration
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  Team Size: {shuffleSettings.teamSize}v{shuffleSettings.teamSize}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  Round Limit: Max {shuffleSettings.maxRounds} rounds
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Overtime:{' '}
                  {shuffleSettings.overtimeMode === 'enabled'
                    ? 'Enabled'
                    : 'Disabled (No Overtime)'}
                </Typography>
                {shuffleSettings.overtimeMode === 'enabled' && (
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Overtime Segments:{' '}
                    {shuffleSettings.overtimeSegments && shuffleSettings.overtimeSegments > 0
                      ? `${shuffleSettings.overtimeSegments} ${
                          shuffleSettings.overtimeSegments === 1 ? 'segment' : 'segments'
                        }`
                      : 'MatchZy default (usually unlimited)'}
                  </Typography>
                )}
              </Box>
            )}
            {type !== 'shuffle' && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Teams ({selectedTeams.length})
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedTeams.length > 0
                    ? teams
                        .filter((t) => selectedTeams.includes(t.id))
                        .map((t) => t.name)
                        .join(', ')
                    : 'No teams selected (optional)'}
                </Typography>
              </Box>
            )}
            {type === 'shuffle' && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Player Registration
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Players will be registered after tournament creation. Each map selected represents
                  one round of matches ({maps.length} rounds total).
                </Typography>
              </Box>
            )}
          </Stack>
        );
      }
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardContent>
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {STEPS.map((stepKey, index) => (
            <Step key={stepKey} completed={index < activeStep}>
              <StepLabel
                onClick={() => {
                  if (index <= activeStep || canProceed()) {
                    setActiveStep(index);
                    sessionStorage.setItem(STEP_STORAGE_KEY, index.toString());
                  }
                }}
                sx={{
                  cursor: index <= activeStep || canProceed() ? 'pointer' : 'default',
                }}
              >
                {t(`tournament.formSteps.steps.${stepKey}`)}
              </StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box minHeight="400px" mb={3}>
          {renderStepContent()}
        </Box>

        <Box display="flex" justifyContent="space-between">
          <Button
            disabled={saving}
            onClick={handleBack}
            startIcon={<ArrowBack />}
            data-testid="tournament-back-button"
          >
            {activeStep === 0 && onBackToWelcome
              ? t('tournament.formSteps.backToWelcome')
              : t('tournament.formSteps.back')}
          </Button>

          {activeStep < STEPS.length - 1 ? (
            <Button
              data-testid="tournament-next-button"
              variant="contained"
              onClick={handleNext}
              disabled={saving}
              endIcon={<ArrowForward />}
              sx={{
                ...(!canProceed() && {
                  bgcolor: 'action.disabledBackground',
                  color: 'action.disabled',
                  '&:hover': {
                    bgcolor: 'action.disabledBackground',
                  },
                }),
              }}
            >
              {t('tournament.formSteps.next')}
            </Button>
          ) : (
            <TournamentFormActions
              tournamentExists={tournamentExists}
              saving={saving}
              hasChanges={hasChanges}
              type={type}
              format={format}
              mapsCount={maps.length}
              canEdit={canEdit}
              onSave={() => {
                // Clear step when tournament is saved
                try {
                  sessionStorage.removeItem(STEP_STORAGE_KEY);
                } catch (error) {
                  console.error('Error clearing step from sessionStorage:', error);
                }
                onSave();
              }}
              onCancel={onCancel}
              onDelete={onDelete}
              onSaveTemplate={() => {
                const mapPoolId =
                  selectedMapPool && selectedMapPool !== 'custom' && mapPools.length > 0
                    ? parseInt(selectedMapPool, 10)
                    : null;
                onSaveTemplate?.(mapPoolId);
              }}
            />
          )}
        </Box>
      </CardContent>

      <SaveMapPoolModal
        open={saveMapPoolModalOpen}
        mapIds={maps}
        onClose={() => setSaveMapPoolModalOpen(false)}
        onSave={async () => {
          // Reload map pools after saving
          try {
            const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools');
            setMapPools(poolsResponse.mapPools || []);
          } catch (err) {
            console.error('Failed to reload map pools:', err);
          }
        }}
      />

      <TeamModal
        open={teamModalOpen}
        team={null}
        onClose={() => setTeamModalOpen(false)}
        onSave={(newTeamId) => {
          setTeamModalOpen(false);
          // Refresh teams list
          onRefreshTeams?.();
          // Auto-add the newly created team to selected teams
          if (newTeamId && !selectedTeams.includes(newTeamId)) {
            onTeamsChange([...selectedTeams, newTeamId]);
          }
        }}
      />

      <TeamImportModal
        open={teamImportModalOpen}
        onClose={() => setTeamImportModalOpen(false)}
        onImport={async () => {
          // The modal handles the import, just refresh teams
          if (onRefreshTeams) {
            await onRefreshTeams();
          }
          setTeamImportModalOpen(false);
        }}
      />

      <ServerModal
        open={serverModalOpen}
        server={editingServer}
        servers={servers}
        onClose={() => {
          setServerModalOpen(false);
          setEditingServer(null);
        }}
        onSave={async () => {
          // Reload servers after saving
          try {
            const response = await api.get<{ servers: Server[] }>('/api/servers');
            setServers(response.servers || []);
            // Refresh server count in the form data hook
            await refreshServers();
          } catch (err) {
            console.error('Failed to reload servers:', err);
          }
          setServerModalOpen(false);
          setEditingServer(null);
        }}
      />

      <BatchServerModal
        open={batchServerModalOpen}
        onClose={() => setBatchServerModalOpen(false)}
        onSave={async () => {
          // Reload servers after saving
          try {
            const response = await api.get<{ servers: Server[] }>('/api/servers');
            setServers(response.servers || []);
            // Refresh server count in the form data hook
            await refreshServers();
          } catch (err) {
            console.error('Failed to reload servers:', err);
          }
          setBatchServerModalOpen(false);
        }}
        existingServers={servers}
      />
    </Card>
  );
}
