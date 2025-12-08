import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useSnackbar } from '../contexts/SnackbarContext';
import { TournamentStepper } from '../components/tournament/TournamentStepper';
import { TournamentFormSteps } from '../components/tournament/TournamentFormSteps';
import { TournamentWelcomeScreen } from '../components/tournament/TournamentWelcomeScreen';
import { TournamentReview } from '../components/tournament/TournamentReview';
import { TournamentLive } from '../components/tournament/TournamentLive';
import { ShufflePlayerRegistration } from '../components/tournament/ShufflePlayerRegistration';
import { ShuffleTournamentStats } from '../components/tournament/ShuffleTournamentStats';
import { ShuffleMapsCard } from '../components/tournament/ShuffleMapsCard';
import { TournamentDialogs } from '../components/tournament/TournamentDialogs';
import TournamentChangePreviewModal from '../components/modals/TournamentChangePreviewModal';
import SaveTemplateModal from '../components/modals/SaveTemplateModal';
import { useTournament } from '../hooks/useTournament';
import { validateTeamCountForType } from '../utils/tournamentValidation';
import { api } from '../utils/api';
import type { TournamentTemplate } from '../types/tournament.types';
import type { ShuffleTournamentSettings } from '../components/tournament/ShuffleTournamentConfigStep';
import type { EloCalculationTemplate } from '../types/elo.types';

interface TournamentChange {
  field: string;
  label?: string;
  oldValue?: string | string[];
  newValue?: string | string[];
  from?: string | string[];
  to?: string | string[];
}

const Tournament: React.FC = () => {
  const navigate = useNavigate();
  const {
    tournament,
    teams,
    loading,
    saveTournament,
    deleteTournament,
    regenerateBracket,
    resetTournament,
    startTournament,
    refreshData,
  } = useTournament();

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState('single_elimination');
  const [format, setFormat] = useState('bo3');
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [maps, setMaps] = useState<string[]>([]);
  const [shuffleSettings, setShuffleSettings] = useState<ShuffleTournamentSettings>({
    teamSize: 5,
    roundLimitType: 'first_to_13',
    maxRounds: 24,
    overtimeMode: 'enabled',
    eloTemplateId: 'pure-win-loss',
  });
  const [eloTemplates, setEloTemplates] = useState<EloCalculationTemplate[]>([]);

  // Auto-set format to bo1 when shuffle is selected
  useEffect(() => {
    if (type === 'shuffle' && format !== 'bo1') {
      setFormat('bo1');
    }
  }, [type, format]);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Action state
  const { showSuccess, showError } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Tournament Setup';
  }, []);

  // Load ELO templates
  useEffect(() => {
    const loadEloTemplates = async () => {
      try {
        const response = await api.get<{
          success: boolean;
          templates: EloCalculationTemplate[];
        }>('/api/elo-templates');
        if (response.success) {
          setEloTemplates(response.templates);
        }
      } catch (err) {
        console.error('Failed to load ELO templates:', err);
      }
    };
    loadEloTemplates();
  }, []);

  // Load registered player count for shuffle tournaments
  const loadRegisteredPlayerCount = async () => {
    if (tournament?.type === 'shuffle') {
      try {
        const response = await api.get<{ success: boolean; count: number; players: unknown[] }>(
          `/api/tournament/${tournament.id}/players`
        );
        if (response.success) {
          setRegisteredPlayerCount(response.count);
        }
      } catch (err) {
        console.error('Failed to load registered player count:', err);
      }
    }
  };

  // Load player count when tournament changes
  useEffect(() => {
    if (tournament?.type === 'shuffle' && tournament.status === 'setup') {
      loadRegisteredPlayerCount();
    } else {
      setRegisteredPlayerCount(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament?.id, tournament?.type, tournament?.status]);
  const [registeredPlayerCount, setRegisteredPlayerCount] = useState<number | undefined>(undefined);

  // Dialog state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [showChangePreview, setShowChangePreview] = useState(false);
  const [changes, setChanges] = useState<
    Array<{
      field: string;
      label: string;
      oldValue: string | string[];
      newValue: string | string[];
    }>
  >([]);

  const [searchParams] = useSearchParams();

  // Session storage keys for tournament form data
  const STORAGE_KEY = 'tournament_form_draft';
  const STEP_STORAGE_KEY = 'tournament_form_step';

  // Form data loading from sessionStorage is now handled in the tournament sync effect
  // This ensures we also set showWelcome/showForm appropriately based on whether data exists

  // Save form data to sessionStorage (only when creating new tournament, not editing existing)
  useEffect(() => {
    if (!tournament && showForm) {
      try {
        const data = {
          name,
          type,
          format,
          maps,
          selectedTeams,
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (error) {
        console.error('Error saving form data to sessionStorage:', error);
      }
    }
  }, [name, type, format, maps, selectedTeams, tournament, showForm]);

  // Clear sessionStorage when tournament is successfully created
  const clearDraft = React.useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STEP_STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing draft from sessionStorage:', error);
    }
  }, []);

  // Load template if specified in URL
  const loadTemplate = React.useCallback(
    async (templateId: number) => {
      try {
        const response = await api.get<{ success: boolean; template: TournamentTemplate }>(
          `/api/templates/${templateId}`
        );
        if (response.success && response.template) {
          const template = response.template;
          setName(template.name);
          setType(template.type);
          setFormat(template.format);
          setMaps(template.maps || []);
          setSelectedTeams([]); // Templates don't include teams
          setIsEditing(true);
          // Clear draft when loading template
          clearDraft();
          // Clear template param from URL
          window.history.replaceState({}, '', '/tournament');
        }
      } catch (error) {
        console.error('Error loading template:', error);
        showError('Failed to load template');
      }
    },
    [setName, setType, setFormat, setMaps, setSelectedTeams, setIsEditing, clearDraft, showError]
  );

  useEffect(() => {
    const templateId = searchParams.get('template');
    if (templateId && !tournament) {
      loadTemplate(parseInt(templateId, 10));
      setShowWelcome(false);
      setShowForm(true);
      // Clear draft when loading template from URL
      clearDraft();
    }
  }, [searchParams, tournament, loadTemplate, clearDraft]);

  const handleCreateNew = () => {
    // Clear session storage first to start fresh
    clearDraft();
    try {
      sessionStorage.removeItem('tournament_form_step');
    } catch (error) {
      console.error('Error clearing step from sessionStorage:', error);
    }

    setName('');
    setType('single_elimination');
    setFormat('bo3');
    setSelectedTeams([]);
    setMaps([]);
    setShowWelcome(false);
    setShowForm(true);
    setIsEditing(true);
    window.history.replaceState({}, '', '/tournament');
  };

  const handleLoadTemplate = (template: TournamentTemplate) => {
    setName(template.name);
    setType(template.type);
    setFormat(template.format);
    setMaps(template.maps || []);
    setSelectedTeams(template.teamIds || []); // Load teams from template
    setCurrentMapPoolId(template.mapPoolId || null); // Set map pool ID
    setShowWelcome(false);
    setShowForm(true);
    setIsEditing(true);
    // Clear draft when loading template
    clearDraft();
    window.history.replaceState({}, '', '/tournament');
  };

  const [currentMapPoolId, setCurrentMapPoolId] = useState<number | null>(null);

  const handleSaveTemplate = (mapPoolId: number | null) => {
    setCurrentMapPoolId(mapPoolId);
    setSaveTemplateModalOpen(true);
  };

  const handleRenameTournament = async (newName: string) => {
    const trimmedName = newName.trim();

    if (!trimmedName) {
      showError('Tournament name is required');
      return;
    }

    setSaving(true);

    try {
      const response = await api.put<{
        success: boolean;
        tournament: unknown;
        error?: string;
      }>('/api/tournament', { name: trimmedName });

      if ('success' in response && response.success) {
        showSuccess('Tournament name updated');
        await refreshData();
      } else {
        const errorMessage =
          typeof response === 'object' &&
          response !== null &&
          'error' in response &&
          typeof (response as { error?: string }).error === 'string'
            ? (response as { error?: string }).error
            : 'Failed to update tournament name';
        showError(errorMessage);
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to update tournament name');
    } finally {
      setSaving(false);
    }
  };

  // Sync tournament data to form when loaded
  React.useEffect(() => {
    if (tournament) {
      setName(tournament.name);
      setType(tournament.type);
      setFormat(tournament.format);
      setSelectedTeams(tournament.teamIds || []);
      setMaps(tournament.maps || []);
      // Load shuffle settings if tournament is shuffle type
      if (tournament.type === 'shuffle' && tournament.teamSize) {
        setShuffleSettings({
          teamSize: tournament.teamSize,
          roundLimitType: tournament.roundLimitType || 'first_to_13',
          maxRounds: tournament.maxRounds || 24,
          overtimeMode: tournament.overtimeMode || 'enabled',
          eloTemplateId: tournament.eloTemplateId || 'pure-win-loss',
        });
      }
      setIsEditing(false);
      setShowWelcome(false);
      setShowForm(false);
      // Clear draft when tournament exists (we're viewing/editing existing tournament)
      clearDraft();
    } else {
      // No tournament exists - check if we have session storage data
      if (!searchParams.get('template')) {
        try {
          const saved = sessionStorage.getItem(STORAGE_KEY);
          if (saved) {
            // We have saved form data - restore it and show form directly
            const data = JSON.parse(saved);
            if (data.name) setName(data.name);
            if (data.type) setType(data.type);
            if (data.format) setFormat(data.format);
            if (data.maps) setMaps(data.maps);
            if (data.selectedTeams) setSelectedTeams(data.selectedTeams);
            // Show form directly, not welcome screen
            setShowWelcome(false);
            setShowForm(true);
            setIsEditing(true);
          } else {
            // No saved data - show welcome screen
            setShowWelcome(true);
            setShowForm(false);
            setIsEditing(false);
          }
        } catch (error) {
          console.error('Error loading draft:', error);
          // On error, show welcome screen
          setShowWelcome(true);
          setShowForm(false);
          setIsEditing(false);
        }
      }
    }
  }, [tournament, searchParams, clearDraft]);

  // Determine current step
  const getCurrentStep = (): number => {
    if (!tournament) return 0;
    if (tournament.status === 'setup') return 1;
    if (tournament.status === 'in_progress' || tournament.status === 'completed') return 2;
    return 1;
  };

  const canEdit = !tournament || tournament.status === 'setup';

  // Check if form has changes compared to tournament
  const hasChanges = (): boolean => {
    if (!tournament) return true; // Creating new tournament
    // Basic tournament fields
    if (name !== tournament.name) return true;
    if (type !== tournament.type) return true;
    if (format !== tournament.format) return true;
    if (JSON.stringify(selectedTeams.sort()) !== JSON.stringify(tournament.teamIds.sort()))
      return true;
    if (JSON.stringify(maps.sort()) !== JSON.stringify(tournament.maps.sort())) return true;

    // Shuffle tournament specific fields
    if (tournament.type === 'shuffle') {
      const currentTeamSize = tournament.teamSize || 5;
      if (shuffleSettings.teamSize !== currentTeamSize) return true;

      const currentRoundLimitType = tournament.roundLimitType || 'first_to_13';
      if (shuffleSettings.roundLimitType !== currentRoundLimitType) return true;

      const currentMaxRounds = tournament.maxRounds || 24;
      if (
        shuffleSettings.roundLimitType === 'max_rounds' &&
        shuffleSettings.maxRounds !== currentMaxRounds
      ) {
        return true;
      }

      const currentOvertimeMode = tournament.overtimeMode || 'enabled';
      if (shuffleSettings.overtimeMode !== currentOvertimeMode) return true;

      const currentEloTemplate = tournament.eloTemplateId || 'pure-win-loss';
      const selectedEloTemplate = shuffleSettings.eloTemplateId || 'pure-win-loss';
      if (selectedEloTemplate !== currentEloTemplate) return true;
    }

    return false;
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showError('Tournament name is required');
      return;
    }

    if (maps.length === 0) {
      showError('Please select at least 1 map');
      return;
    }

    // Shuffle tournaments don't use teams
    if (type === 'shuffle') {
      // Validate shuffle settings
      if (shuffleSettings.teamSize < 2 || shuffleSettings.teamSize > 10) {
        showError('Team size must be between 2 and 10 players');
        return;
      }
      if (
        shuffleSettings.roundLimitType === 'max_rounds' &&
        (shuffleSettings.maxRounds < 1 || shuffleSettings.maxRounds > 30)
      ) {
        showError('Max rounds must be between 1 and 30');
        return;
      }
      // For shuffle tournaments, use the shuffle-specific endpoint
      await saveShuffleTournament();
      return;
    }

    // Validate team count for non-shuffle tournaments
    const validation = validateTeamCountForType(type, selectedTeams.length);
    if (!validation.isValid) {
      showError(validation.error || 'Invalid team count');
      return;
    }

    if (selectedTeams.length === 0) {
      showError('Please select at least 2 teams');
      return;
    }

    // Check for changes if editing
    if (tournament) {
      const detectedChanges: TournamentChange[] = [];

      if (name !== tournament.name) {
        detectedChanges.push({
          field: 'name',
          label: 'Tournament Name',
          oldValue: tournament.name,
          newValue: name,
        });
      }
      if (type !== tournament.type) {
        detectedChanges.push({
          field: 'type',
          label: 'Tournament Type',
          oldValue: tournament.type,
          newValue: type,
        });
      }
      if (format !== tournament.format) {
        detectedChanges.push({
          field: 'format',
          label: 'Match Format',
          oldValue: tournament.format,
          newValue: format,
        });
      }
      if (JSON.stringify(selectedTeams.sort()) !== JSON.stringify(tournament.teamIds.sort())) {
        const oldTeams = teams.filter((t) => tournament.teamIds.includes(t.id)).map((t) => t.name);
        const newTeams = teams.filter((t) => selectedTeams.includes(t.id)).map((t) => t.name);
        detectedChanges.push({
          field: 'teamIds',
          label: 'Teams',
          oldValue: oldTeams.length > 0 ? oldTeams : [],
          newValue: newTeams.length > 0 ? newTeams : [],
        });
      }
      if (JSON.stringify(maps.sort()) !== JSON.stringify(tournament.maps.sort())) {
        detectedChanges.push({
          field: 'maps',
          label: 'Map Pool',
          oldValue: tournament.maps.length > 0 ? tournament.maps : [],
          newValue: maps.length > 0 ? maps : [],
        });
      }

      if (detectedChanges.length > 0) {
        // Convert TournamentChange[] to ChangeItem[] format
        const validChanges = detectedChanges
          .filter(
            (change) =>
              change.oldValue !== undefined && change.newValue !== undefined && change.label
          )
          .map((change) => ({
            field: change.field,
            label: change.label!,
            oldValue: change.oldValue!,
            newValue: change.newValue!,
          }));
        setChanges(validChanges);
        setShowChangePreview(true);
        return;
      }
    }

    // No changes or creating new tournament
    await saveChanges();
  };

  const saveShuffleTournament = async () => {
    setSaving(true);

    try {
      // Shuffle tournament configuration
      const payload = {
        name,
        mapSequence: maps, // Maps in order = rounds
        teamSize: shuffleSettings.teamSize || 5,
        roundLimitType: shuffleSettings.roundLimitType,
        maxRounds: shuffleSettings.maxRounds,
        overtimeMode: shuffleSettings.overtimeMode,
        eloTemplateId: shuffleSettings.eloTemplateId,
      };

      const response = await api.post<{ success: boolean; tournament: any; error?: string }>(
        '/api/tournament/shuffle',
        payload
      );

      if (response.success) {
        const minPlayers = (shuffleSettings.teamSize || 5) * 2;
        showSuccess(
          `Shuffle tournament "${name}" created successfully! ` +
            `Next step: Register at least ${minPlayers} players to start the tournament (${
              shuffleSettings.teamSize || 5
            }v${shuffleSettings.teamSize || 5} matches).`
        );
        clearDraft();
        await refreshData();
      } else {
        showError(response.error || 'Failed to create shuffle tournament');
      }
    } catch (err) {
      const error = err as Error;
      showError(
        error.message ||
          'Failed to create shuffle tournament. ' + 'Please check your settings and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const saveChanges = async () => {
    setSaving(true);
    setShowChangePreview(false);

    try {
      const payload = {
        name,
        type,
        format,
        maps,
        teamIds: selectedTeams,
        settings: tournament?.settings || { seedingMethod: 'random' },
      };

      const response = await saveTournament(payload);

      if (response.success) {
        showSuccess(
          tournament ? 'Tournament updated & brackets regenerated!' : 'Tournament created!'
        );
        // Clear draft when tournament is successfully created
        if (!tournament) {
          clearDraft();
        }
        await refreshData();
      } else {
        showError(response.error || 'Failed to save tournament');
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to save tournament');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setShowDeleteConfirm(false);

    try {
      await deleteTournament();
      showSuccess('Tournament deleted successfully');
      await refreshData();
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to delete tournament');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setSaving(true);
    setShowRegenerateConfirm(false);

    try {
      await regenerateBracket(true);
      showSuccess('Brackets regenerated successfully');
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to regenerate brackets');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setShowResetConfirm(false);

    try {
      await resetTournament();
      showSuccess('Tournament reset to setup mode');
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to reset tournament');
    } finally {
      setSaving(false);
    }
  };

  const handleStart = async () => {
    // Check server availability first
    try {
      const availabilityResponse = await api.get<{
        success: boolean;
        availableServerCount: number;
      }>('/api/tournament/server-availability');

      if (availabilityResponse.success && availabilityResponse.availableServerCount === 0) {
        // No servers available - show warning modal
        setShowStartConfirm(true);
        return;
      }
    } catch (err) {
      console.error('Error checking server availability:', err);
      // Continue anyway if check fails
    }

    // Servers available or check failed - start immediately
    await performTournamentStart();
  };

  const performTournamentStart = async () => {
    setStarting(true);
    setShowStartConfirm(false);

    try {
      const baseUrl = window.location.origin;
      const response = await startTournament(baseUrl);

      if (response.success) {
        const allocated = (response as { allocated?: number }).allocated || 0;
        showSuccess(`Tournament started! ${allocated} matches allocated to servers`);
        // Stay on current view; users can navigate to the bracket from dashboard or bracket link
      } else {
        const message = (response as { message?: string }).message || 'Failed to start tournament';
        showError(message);
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to start tournament');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box data-testid="tournament-page" sx={{ width: '100%', height: '100%' }}>
      {/* Stepper */}
      <TournamentStepper currentStep={getCurrentStep()} />

      {/* Welcome Screen - Show when no tournament exists */}
      {!tournament && showWelcome && (
        <TournamentWelcomeScreen
          onCreateNew={handleCreateNew}
          onLoadTemplate={handleLoadTemplate}
        />
      )}

      {/* Step-based Form - Show when creating new or editing */}
      {((!tournament && showForm) ||
        (tournament && tournament.status === 'setup' && isEditing)) && (
        <TournamentFormSteps
          name={name}
          type={type}
          format={format}
          selectedTeams={selectedTeams}
          maps={maps}
          teams={teams}
          canEdit={canEdit}
          saving={saving}
          tournamentExists={!!tournament}
          hasChanges={hasChanges()}
          mapPoolId={currentMapPoolId}
          shuffleSettings={shuffleSettings}
          eloTemplates={eloTemplates}
          onNameChange={setName}
          onTypeChange={setType}
          onFormatChange={setFormat}
          onTeamsChange={setSelectedTeams}
          onMapsChange={setMaps}
          onShuffleSettingsChange={setShuffleSettings}
          onSave={handleSave}
          onRefreshTeams={refreshData}
          onBackToWelcome={() => {
            clearDraft(); // Clear all session storage
            setShowWelcome(true);
            setShowForm(false);
            setIsEditing(false);
            // Clear session storage step
            try {
              sessionStorage.removeItem(STEP_STORAGE_KEY);
            } catch (error) {
              console.error('Error clearing step from sessionStorage:', error);
            }
          }}
          onCancel={() => {
            // Reset form to tournament values or go back to welcome
            if (tournament) {
              setName(tournament.name);
              setType(tournament.type);
              setFormat(tournament.format);
              setSelectedTeams(tournament.teamIds || []);
              setMaps(tournament.maps || []);
              setIsEditing(false);
            } else {
              setShowForm(false);
              setShowWelcome(true);
              // Clear step when canceling new tournament creation
              try {
                sessionStorage.removeItem(STEP_STORAGE_KEY);
              } catch (error) {
                console.error('Error clearing step from sessionStorage:', error);
              }
            }
          }}
          onDelete={() => setShowDeleteConfirm(true)}
          onSaveTemplate={handleSaveTemplate}
        />
      )}

      {/* Step 2: Review & Start (tournament is in 'setup' mode after creation) */}
      {tournament && tournament.status === 'setup' && !isEditing && (
        <>
          {tournament.type === 'shuffle' && (
            <Box display="flex" gap={3} alignItems="stretch">
              <ShufflePlayerRegistration
                tournamentId={tournament.id}
                teamSize={tournament.teamSize || 5}
                onPlayersUpdated={() => {
                  refreshData();
                  // Load player count after registration
                  loadRegisteredPlayerCount();
                }}
              />
              <ShuffleTournamentStats
                playerCount={registeredPlayerCount || 0}
                teamSize={tournament.teamSize || 5}
              />
              <ShuffleMapsCard maps={tournament.maps || []} />
            </Box>
          )}
          <Box sx={{ mt: tournament.type === 'shuffle' ? 3 : 0 }}>
            <TournamentReview
              tournament={{
                name: tournament.name,
                type: tournament.type,
                format: tournament.format,
                teams: tournament.teams || [],
                maps: tournament.maps,
                teamSize: tournament.teamSize,
              }}
              starting={starting}
              saving={saving}
              registeredPlayerCount={
                tournament.type === 'shuffle' ? registeredPlayerCount : undefined
              }
              onEdit={() => setIsEditing(true)}
              onStart={handleStart}
              onRegenerate={() => setShowRegenerateConfirm(true)}
              onDelete={() => setShowDeleteConfirm(true)}
            />
          </Box>
        </>
      )}

      {/* Step 3: Live Tournament */}
      {tournament && (tournament.status === 'in_progress' || tournament.status === 'completed') && (
        <TournamentLive
          tournament={{
            name: tournament.name,
            type: tournament.type,
            format: tournament.format,
            status: tournament.status,
            teams: tournament.teams || [],
          }}
          tournamentId={tournament.id}
          onRename={handleRenameTournament}
          saving={saving}
          onViewBracket={() => navigate('/bracket')}
          onReset={() => setShowResetConfirm(true)}
          onDelete={() => setShowDeleteConfirm(true)}
        />
      )}

      {/* Dialogs */}
      <TournamentDialogs
        deleteOpen={showDeleteConfirm}
        regenerateOpen={showRegenerateConfirm}
        resetOpen={showResetConfirm}
        startOpen={showStartConfirm}
        tournamentName={tournament?.name}
        tournamentStatus={tournament?.status}
        onDeleteConfirm={handleDelete}
        onDeleteCancel={() => setShowDeleteConfirm(false)}
        onRegenerateConfirm={handleRegenerate}
        onRegenerateCancel={() => setShowRegenerateConfirm(false)}
        onResetConfirm={handleReset}
        onResetCancel={() => setShowResetConfirm(false)}
        onStartConfirm={performTournamentStart}
        onStartCancel={() => setShowStartConfirm(false)}
      />

      <TournamentChangePreviewModal
        open={showChangePreview}
        changes={changes}
        isLive={tournament?.status === 'in_progress' || tournament?.status === 'completed'}
        onConfirm={saveChanges}
        onCancel={() => setShowChangePreview(false)}
      />

      <SaveTemplateModal
        open={saveTemplateModalOpen}
        onClose={() => setSaveTemplateModalOpen(false)}
        onSave={() => {
          showSuccess('Template saved successfully!');
        }}
        tournamentData={{
          name,
          type,
          format,
          maps,
          mapPoolId: currentMapPoolId,
          teamIds: selectedTeams,
          settings: tournament?.settings,
        }}
      />
    </Box>
  );
};

export default Tournament;
