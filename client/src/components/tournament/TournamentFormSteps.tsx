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

const STEPS = ['Name', 'Type', 'Format', 'Maps', 'Teams', 'Review'];
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

  // Initialize selectedMapPool based on mapPoolId prop or default map pool when mapPools load
  React.useEffect(() => {
    if (mapPools.length > 0 && !selectedMapPool) {
      // If mapPoolId is provided (e.g., from template), use it
      if (mapPoolId !== null && mapPoolId !== undefined) {
        const pool = mapPools.find((p) => p.id === mapPoolId);
        if (pool) {
          setSelectedMapPool(pool.id.toString());
          return;
        }
      }
      // Otherwise, use default pool or first pool if maps are empty
      if (maps.length === 0) {
        const defaultPool = mapPools.find((p) => p.isDefault);
        if (defaultPool) {
          setSelectedMapPool(defaultPool.id.toString());
        } else if (mapPools.length > 0) {
          setSelectedMapPool(mapPools[0].id.toString());
        }
      }
    }
  }, [mapPools, selectedMapPool, maps.length, mapPoolId]);

  const handleMapPoolChange = (poolId: string) => {
    setSelectedMapPool(poolId);
    if (poolId === 'custom') {
      // Custom map selection - don't change maps
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
      case 4:
        // Shuffle tournament configuration or team selection
        if (type === 'shuffle') {
          return (
            <Stack spacing={3}>
              <Alert severity="info">
                Shuffle tournaments don&apos;t use fixed teams. Players will be automatically
                balanced into teams for each match based on their ELO ratings.
              </Alert>
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
        return (
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
        );
      case 5:
        return (
          <Stack spacing={2}>
            <Alert severity="info">
              Review your tournament settings and click "Create Tournament" when ready.
            </Alert>
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Tournament Name
              </Typography>
              <Typography variant="body1" color="text.secondary" mb={2}>
                {name || 'Not set'}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Tournament Type
              </Typography>
              <Typography variant="body1" color="text.secondary" mb={2}>
                {type.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Match Format
              </Typography>
              <Typography variant="body1" color="text.secondary" mb={2}>
                {format.toUpperCase()}
              </Typography>
            </Box>
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
                  Round Limit:{' '}
                  {shuffleSettings.roundLimitType === 'first_to_13'
                    ? 'First to 13'
                    : `Max ${shuffleSettings.maxRounds} rounds`}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Overtime:{' '}
                  {shuffleSettings.overtimeMode === 'enabled'
                    ? 'Enabled'
                    : 'Disabled (No Overtime)'}
                </Typography>
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
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardContent>
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {STEPS.map((label, index) => (
            <Step key={label} completed={index < activeStep}>
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
                {label}
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
            {activeStep === 0 && onBackToWelcome ? 'Back to Welcome' : 'Back'}
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
              Next
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
      />
    </Card>
  );
}
