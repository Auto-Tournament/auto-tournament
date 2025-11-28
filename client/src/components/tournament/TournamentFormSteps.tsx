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
import { TournamentNameStep } from './TournamentNameStep';
import { TournamentTypeFormatStep } from './TournamentTypeFormatStep';
import { MapPoolStep } from './MapPoolStep';
import { TeamSelectionStep } from './TeamSelectionStep';
import { TournamentFormActions } from './TournamentFormActions';
import { useTournamentFormData } from './useTournamentFormData';
import SaveMapPoolModal from '../modals/SaveMapPoolModal';
import TeamModal from '../modals/TeamModal';
import { api } from '../../utils/api';
import type { Team } from '../../types';
import type { MapPoolsResponse } from '../../types/api.types';

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
  onNameChange: (name: string) => void;
  onTypeChange: (type: string) => void;
  onFormatChange: (format: string) => void;
  onTeamsChange: (teams: string[]) => void;
  onMapsChange: (maps: string[]) => void;
  onSave: () => void;
  onCancel?: () => void;
  onDelete: () => void;
  onSaveTemplate?: (mapPoolId: number | null) => void;
  onRefreshTeams?: () => void;
}

const STEPS = ['Name & Type', 'Maps', 'Teams', 'Review'];
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
  onNameChange,
  onTypeChange,
  onFormatChange,
  onTeamsChange,
  onMapsChange,
  onSave,
  onCancel,
  onDelete,
  onSaveTemplate,
  onRefreshTeams,
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

  const { serverCount, loadingServers, mapPools, availableMaps, loadingMaps, setMapPools } =
    useTournamentFormData({
      maps,
      selectedMapPool,
      onMapsChange,
    });

  // Initialize selectedMapPool based on default map pool when mapPools load
  React.useEffect(() => {
    if (mapPools.length > 0 && !selectedMapPool && maps.length === 0) {
      const defaultPool = mapPools.find((p) => p.isDefault);
      if (defaultPool) {
        setSelectedMapPool(defaultPool.id.toString());
      } else if (mapPools.length > 0) {
        setSelectedMapPool(mapPools[0].id.toString());
      }
    }
  }, [mapPools, selectedMapPool, maps.length]);

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

  // Save step to sessionStorage whenever it changes
  React.useEffect(() => {
    try {
      sessionStorage.setItem(STEP_STORAGE_KEY, activeStep.toString());
    } catch (error) {
      console.error('Error saving step to sessionStorage:', error);
    }
  }, [activeStep]);

  const handleNext = () => {
    if (activeStep < STEPS.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  const isVetoFormat = ['bo1', 'bo3', 'bo5'].includes(format);
  const isValidMaps = isVetoFormat ? maps.length === 7 : maps.length > 0;
  const canProceedFromStep0 = name.trim().length > 0 && type && format;
  const canProceedFromStep1 = isValidMaps;
  const canProceedFromStep2 = true; // Teams are optional now

  const canProceed = () => {
    switch (activeStep) {
      case 0:
        return canProceedFromStep0;
      case 1:
        return canProceedFromStep1;
      case 2:
        return canProceedFromStep2;
      default:
        return true;
    }
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <Stack spacing={3}>
            <TournamentNameStep
              name={name}
              canEdit={canEdit}
              saving={saving}
              onNameChange={onNameChange}
            />
            <TournamentTypeFormatStep
              type={type}
              format={format}
              selectedTeams={selectedTeams}
              maps={maps}
              serverCount={serverCount}
              requiredServers={1}
              hasEnoughServers={serverCount > 0}
              loadingServers={loadingServers}
              canEdit={canEdit}
              saving={saving}
              onTypeChange={onTypeChange}
              onFormatChange={onFormatChange}
            />
          </Stack>
        );
      case 1:
        return (
          <MapPoolStep
            type={type}
            format={format}
            maps={maps}
            mapPools={mapPools}
            availableMaps={availableMaps}
            selectedMapPool={selectedMapPool}
            loadingMaps={loadingMaps}
            canEdit={canEdit}
            saving={saving}
            onMapPoolChange={handleMapPoolChange}
            onMapsChange={onMapsChange}
            onSaveMapPool={() => setSaveMapPoolModalOpen(true)}
          />
        );
      case 2:
        return (
          <TeamSelectionStep
            teams={teams}
            selectedTeams={selectedTeams}
            canEdit={canEdit}
            saving={saving}
            onTeamsChange={onTeamsChange}
            onCreateTeam={() => setTeamModalOpen(true)}
          />
        );
      case 3:
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
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box minHeight="400px" mb={3}>
          {renderStepContent()}
        </Box>

        <Box display="flex" justifyContent="space-between">
          <Button
            disabled={activeStep === 0 || saving}
            onClick={handleBack}
            startIcon={<ArrowBack />}
          >
            Back
          </Button>

          {activeStep < STEPS.length - 1 ? (
            <Button
              variant="contained"
              onClick={handleNext}
              disabled={!canProceed() || saving}
              endIcon={<ArrowForward />}
            >
              Next
            </Button>
          ) : (
            <TournamentFormActions
              tournamentExists={tournamentExists}
              saving={saving}
              hasChanges={hasChanges}
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
    </Card>
  );
}
