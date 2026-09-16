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
  deriveOvertimeOption,
  type OvertimeOption,
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

  // Overtime is configured through three meaningful options; the API keeps the
  // (overtimeMode, overtimeSegments) pair, see deriveOvertimeOption.
  const overtimeOption = deriveOvertimeOption(overtimeMode, overtimeSegments);
  const shuffleOvertimeOption = deriveOvertimeOption(
    shuffleSettings?.overtimeMode,
    shuffleSettings?.overtimeSegments
  );

  const handleOvertimeOptionChange = (option: OvertimeOption) => {
    if (option === 'enabled') {
      onOvertimeModeChange?.('enabled');
      // 0 segments only means something together with "disabled".
      if (overtimeSegments === 0) {
        onOvertimeSegmentsChange?.(null);
      }
      return;
    }
    onOvertimeModeChange?.('disabled');
    onOvertimeSegmentsChange?.(option === 'disabledNoDraws' ? 0 : null);
  };

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
        return canProceedFromStep0 ? null : t('tournament.toasts.nameRequired');
      case 1:
        return canProceedFromStep1 ? null : t('tournament.wizard.validation.selectType');
      case 2:
        return canProceedFromStep2 ? null : t('tournament.wizard.validation.selectFormat');
      case 3:
        return isValidMaps
          ? null
          : mapValidation.message || t('tournament.toasts.invalidMapSelection');
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
              <Alert severity="info">{t('tournament.wizard.shuffleInfo')}</Alert>
              {volume && (
                <Alert severity="info">
                  {t('tournament.wizard.shuffleRounds', {
                    rounds: t('tournament.counts.rounds', { count: volume.totalRounds }),
                  })}
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
                {t('tournament.wizard.volumeAlert', {
                  teams: t('tournament.counts.teams', { count: selectedTeams.length }),
                  type: t(`tournament.typeSelector.types.${type}.label`),
                  format: format.toUpperCase(),
                  matches: t('tournament.counts.matches', { count: volume.totalMatches ?? 0 }),
                  rounds: t('tournament.counts.rounds', { count: volume.totalRounds }),
                  maps: t('tournament.counts.maps', { count: volume.totalMaps }),
                })}
              </Alert>
            )}
            {typeof maxRounds === 'number' && onMaxRoundsChange && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  {t('tournament.labels.matchRules')}
                </Typography>
                <TextField
                  label={t('tournament.wizard.maxRoundsLabel')}
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
                      ? t('tournament.wizard.maxRoundsHelper', {
                          maxRounds,
                          winRounds: Math.floor(maxRounds / 2) + 1,
                        })
                      : t('tournament.wizard.maxRoundsHelperEmpty')
                  }
                  error={maxRounds <= 0 || maxRounds > 30}
                  fullWidth
                />

                <Box mt={3}>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {t('tournament.labels.overtimeSettings')}
                  </Typography>
                  <Tooltip
                    title={t('tournament.overtime.tooltip')}
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
                        <InputLabel id="tournament-overtime-mode-label">
                          {t('tournament.overtime.selectLabel')}
                        </InputLabel>
                        <Select
                          labelId="tournament-overtime-mode-label"
                          value={overtimeOption}
                          label={t('tournament.overtime.selectLabel')}
                          onChange={(event) =>
                            handleOvertimeOptionChange(event.target.value as OvertimeOption)
                          }
                          disabled={!canEdit || saving}
                        >
                          <MenuItem value="enabled">
                            {t('tournament.overtime.options.enabled')}
                          </MenuItem>
                          <MenuItem value="disabledDraws">
                            {t('tournament.overtime.options.disabledDraws')}
                          </MenuItem>
                          <MenuItem value="disabledNoDraws">
                            {t('tournament.overtime.options.disabledNoDraws')}
                          </MenuItem>
                        </Select>
                        <FormHelperText>{t('tournament.overtime.modeHelper')}</FormHelperText>
                      </FormControl>

                      {overtimeOption === 'enabled' && (
                        <TextField
                          sx={{ flex: 1, minWidth: 200 }}
                          label={t('tournament.overtime.segmentsLabel')}
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
                          disabled={!canEdit || saving}
                          slotProps={{
                            htmlInput: { min: 0, max: 10 },
                          }}
                          helperText={
                            typeof overtimeSegments === 'number' && overtimeSegments > 0
                              ? t('tournament.overtime.segmentsHelperValue', {
                                  count: overtimeSegments,
                                })
                              : t('tournament.overtime.segmentsHelper')
                          }
                          fullWidth
                        />
                      )}
                    </Box>
                  </Tooltip>
                </Box>
                {type === 'double_elimination' && onGrandFinalModeChange && (
                  <Box mt={3}>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      {t('tournament.grandFinal.sectionTitle')}
                    </Typography>
                    <FormControl fullWidth sx={{ mb: 1 }}>
                      <InputLabel id="tournament-grand-final-mode-label">
                        {t('tournament.grandFinal.label')}
                      </InputLabel>
                      <Select
                        labelId="tournament-grand-final-mode-label"
                        value={grandFinalMode ?? 'simple'}
                        label={t('tournament.grandFinal.label')}
                        onChange={(event) =>
                          onGrandFinalModeChange(
                            event.target.value as 'none' | 'simple' | 'double'
                          )
                        }
                        disabled={!canEdit || saving}
                      >
                        <MenuItem value="simple">
                          {t('tournament.grandFinal.options.simple')}
                        </MenuItem>
                        <MenuItem value="none">{t('tournament.grandFinal.options.none')}</MenuItem>
                        <MenuItem value="double">
                          {t('tournament.grandFinal.options.double')}
                        </MenuItem>
                      </Select>
                      <FormHelperText>{t('tournament.grandFinal.helper')}</FormHelperText>
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
              {t('tournament.review.summary.info', {
                button: tournamentExists
                  ? t('tournament.formActions.saveAndGenerate')
                  : t('tournament.common.createTournament'),
              })}
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
                {type
                  ? t(`tournament.typeSelector.types.${type}.label`)
                  : t('tournament.review.summary.notSet')}
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
                  {t('tournament.labels.matchRules')}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  {t('tournament.matchRules.value', {
                    maxRounds,
                    winRounds: Math.floor(maxRounds / 2) + 1,
                  })}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  {overtimeOption === 'enabled'
                    ? t('tournament.matchRules.overtimeEnabled')
                    : overtimeOption === 'disabledNoDraws'
                    ? t('tournament.matchRules.overtimeDisabledNoDraws')
                    : t('tournament.matchRules.overtimeDisabled')}
                </Typography>
                {overtimeOption === 'enabled' && (
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {typeof overtimeSegments === 'number' && overtimeSegments > 0
                      ? t('tournament.matchRules.overtimeSegments', { count: overtimeSegments })
                      : t('tournament.matchRules.overtimeSegmentsDefault')}
                  </Typography>
                )}
              </Box>
            )}
            {type !== 'shuffle' && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  {t('tournament.labels.servers')}
                </Typography>
                <Typography
                  variant="body2"
                  color={hasEnoughServers ? 'text.secondary' : 'warning.main'}
                >
                  {t(
                    hasEnoughServers
                      ? 'tournament.wizard.serversSummary'
                      : 'tournament.wizard.serversSummaryQueued',
                    {
                      servers: t('tournament.counts.servers', { count: serverCount }),
                      matches: t('tournament.counts.concurrentMatches', { count: requiredServers }),
                    }
                  )}
                </Typography>
              </Box>
            )}
            {volumeReview && type !== 'shuffle' && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  {t('tournament.wizard.estimatedVolumeLabel')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('tournament.review.summary.estimatedVolumeText', {
                    matches: t('tournament.counts.matches', {
                      count: volumeReview.totalMatches ?? 0,
                    }),
                    rounds: t('tournament.counts.rounds', { count: volumeReview.totalRounds }),
                    mapsPerMatch: volumeReview.mapsPerMatch,
                    maps: t('tournament.counts.maps', { count: volumeReview.totalMaps }),
                  })}
                </Typography>
              </Box>
            )}
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                {t('tournament.wizard.mapsHeading', { total: maps.length })}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {maps.join(', ') || t('tournament.wizard.noMapsSelected')}
              </Typography>
            </Box>
            {type === 'shuffle' && shuffleSettings && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  {t('tournament.wizard.matchConfiguration')}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  {t('tournament.matchRules.teamSizeValue', { size: shuffleSettings.teamSize })}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  {t('tournament.wizard.roundLimitValue', { count: shuffleSettings.maxRounds })}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  {shuffleOvertimeOption === 'enabled'
                    ? t('tournament.matchRules.overtimeEnabled')
                    : shuffleOvertimeOption === 'disabledNoDraws'
                    ? t('tournament.matchRules.overtimeDisabledNoDraws')
                    : t('tournament.matchRules.overtimeDisabled')}
                </Typography>
                {shuffleOvertimeOption === 'enabled' && (
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {shuffleSettings.overtimeSegments && shuffleSettings.overtimeSegments > 0
                      ? t('tournament.matchRules.overtimeSegments', {
                          count: shuffleSettings.overtimeSegments,
                        })
                      : t('tournament.matchRules.overtimeSegmentsDefaultUnlimited')}
                  </Typography>
                )}
              </Box>
            )}
            {type !== 'shuffle' && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  {t('tournament.wizard.teamsHeading', { total: selectedTeams.length })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedTeams.length > 0
                    ? teams
                        .filter((team) => selectedTeams.includes(team.id))
                        .map((team) => team.name)
                        .join(', ')
                    : t('tournament.wizard.noTeamsSelected')}
                </Typography>
              </Box>
            )}
            {type === 'shuffle' && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  {t('tournament.wizard.playerRegistration')}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  {t('tournament.wizard.playerRegistrationInfo', { count: maps.length })}
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
