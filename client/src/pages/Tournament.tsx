import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
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
import { BulkShuffleMatchesModal } from '../components/modals/BulkShuffleMatchesModal';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { useTournament } from '../hooks/useTournament';
import { validateTeamCountForType } from '../utils/tournamentValidation';
import { api } from '../utils/api';
import { io } from 'socket.io-client';
import { MATCH_FORMATS } from '../constants/tournament';
import type { TournamentTemplate } from '../types/tournament.types';
import type { ShuffleTournamentSettings } from '../components/tournament/ShuffleTournamentConfigStep';
import type { EloCalculationTemplate } from '../types/elo.types';

/** Human label for a match format ("bo3" -> "Best of 3"), raw value if unknown. */
const formatLabel = (value: string): string =>
  MATCH_FORMATS.find((f) => f.value === value)?.label ?? value;

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
  const { t } = useTranslation();
  const {
    tournament,
    teams,
    loading,
    hasBracket,
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
    maxRounds: 24,
    eloTemplateId: 'pure-win-loss',
  });
  const [eloTemplates, setEloTemplates] = useState<EloCalculationTemplate[]>([]);
  // Global max rounds per map for non-shuffle tournaments (applies to all maps in the series).
  const [maxRounds, setMaxRounds] = useState<number>(24);
  // Global overtime policy for non-shuffle tournaments.
  const [overtimeMode, setOvertimeMode] = useState<'enabled' | 'disabled'>('enabled');
  const [overtimeSegments, setOvertimeSegments] = useState<number | null>(null);
  // Grand final behaviour for double elimination tournaments.
  const [grandFinalMode, setGrandFinalMode] = useState<'none' | 'simple' | 'double'>('simple');
  // Whether the user picked a grand final mode in this edit; if not, changing
  // the type applies that type's default instead of a leftover value.
  const [grandFinalModePicked, setGrandFinalModePicked] = useState(false);

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
  const [outdatedServers, setOutdatedServers] = useState<
    Array<{
      id: string;
      name: string;
      installedBuildId: number | null;
      requiredVersion: number | null;
      reason: string;
    }>
  >([]);
  const [showOutdatedDialog, setShowOutdatedDialog] = useState(false);
  const [disablingOutdated, setDisablingOutdated] = useState(false);
  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);

  // Set dynamic page title
  useEffect(() => {
    document.title = t('tournament.page.title');
  }, [t]);

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

  // Load player count when tournament changes (any shuffle status)
  useEffect(() => {
    if (tournament?.type === 'shuffle') {
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
  const [startWarningInfo, setStartWarningInfo] = useState<{
    requiredServers: number;
    availableServers: number;
  } | null>(null);
  const [showChangePreview, setShowChangePreview] = useState(false);
  const [changes, setChanges] = useState<
    Array<{
      field: string;
      label: string;
      oldValue: string | string[];
      newValue: string | string[];
    }>
  >([]);
  const [bulkShuffleModalOpen, setBulkShuffleModalOpen] = useState(false);

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

          // Apply saved global round / overtime / grand final settings when present
          if (typeof template.settings?.maxRounds === 'number') {
            setMaxRounds(template.settings.maxRounds);
          }
          if (template.settings?.overtimeMode) {
            setOvertimeMode(template.settings.overtimeMode);
          }
          if (typeof template.settings?.overtimeSegments === 'number') {
            setOvertimeSegments(template.settings.overtimeSegments);
          }
          if (template.settings?.grandFinalMode) {
            setGrandFinalMode(template.settings.grandFinalMode);
          }

          setIsEditing(true);
          // When loading a template via URL, jump the multi-step form to the
          // final "Review" step so the user can confirm and create immediately.
          try {
            sessionStorage.setItem(STEP_STORAGE_KEY, '5'); // 'Review' step index in TournamentFormSteps
          } catch (error) {
            console.error('Error saving step to sessionStorage when loading template:', error);
          }
          // Clear draft when loading template
          clearDraft();
          // Clear template param from URL
          window.history.replaceState({}, '', '/tournament');
        }
      } catch (error) {
        console.error('Error loading template:', error);
        showError(t('tournament.toasts.loadTemplateFailed'));
      }
    },
    [setName, setType, setFormat, setMaps, setSelectedTeams, setIsEditing, clearDraft, showError, t]
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

    // Apply saved global round / overtime / grand final settings when present
    if (typeof template.settings?.maxRounds === 'number') {
      setMaxRounds(template.settings.maxRounds);
    }
    if (template.settings?.overtimeMode) {
      setOvertimeMode(template.settings.overtimeMode);
    }
    if (typeof template.settings?.overtimeSegments === 'number') {
      setOvertimeSegments(template.settings.overtimeSegments);
    }
    if (template.settings?.grandFinalMode) {
      setGrandFinalMode(template.settings.grandFinalMode);
    }

    setShowWelcome(false);
    setShowForm(true);
    setIsEditing(true);
    // When loading a template from the welcome screen, also jump straight to
    // the final "Review" step of the tournament form wizard.
    try {
      sessionStorage.setItem(STEP_STORAGE_KEY, '5'); // 'Review' step index in TournamentFormSteps
    } catch (error) {
      console.error(
        'Error saving step to sessionStorage when loading template from welcome:',
        error
      );
    }
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
      showError(t('tournament.toasts.nameRequired'));
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
        showSuccess(t('tournament.toasts.nameUpdated'));
        await refreshData();
      } else {
        const errorMessage =
          typeof response === 'object' &&
          response !== null &&
          'error' in response &&
          typeof (response as { error?: string }).error === 'string'
            ? (response as { error?: string }).error
            : t('tournament.toasts.nameUpdateFailed');
        showError(errorMessage);
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || t('tournament.toasts.nameUpdateFailed'));
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
          maxRounds: tournament.maxRounds || 24,
          eloTemplateId: tournament.eloTemplateId || 'pure-win-loss',
          overtimeMode: tournament.overtimeMode ?? 'enabled',
          overtimeSegments:
            typeof tournament.overtimeSegments === 'number' ? tournament.overtimeSegments : null,
        });
      } else {
        // Non-shuffle tournaments use a global maxRounds for all maps
        setMaxRounds(tournament.maxRounds || 24);
        setOvertimeMode(tournament.overtimeMode ?? 'enabled');
        setOvertimeSegments(
          typeof tournament.overtimeSegments === 'number' ? tournament.overtimeSegments : null
        );
      }
      // Grand final configuration. Only double elimination exposes it, but we
      // still load whatever is stored so saving an untouched tournament (or
      // switching the type to double elimination) keeps the saved behaviour
      // instead of silently falling back to "none".
      const storedGrandFinalMode =
        (tournament.settings &&
          (tournament.settings as { grandFinalMode?: string }).grandFinalMode) ||
        'simple';
      setGrandFinalMode(
        storedGrandFinalMode === 'none' ||
          storedGrandFinalMode === 'simple' ||
          storedGrandFinalMode === 'double'
          ? storedGrandFinalMode
          : 'simple'
      );
      setGrandFinalModePicked(false);
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

      const currentMaxRounds = tournament.maxRounds || 24;
      if (shuffleSettings.maxRounds !== currentMaxRounds) return true;

      const currentEloTemplate = tournament.eloTemplateId || 'pure-win-loss';
      const selectedEloTemplate = shuffleSettings.eloTemplateId || 'pure-win-loss';
      if (selectedEloTemplate !== currentEloTemplate) return true;

      const currentOvertimeMode = tournament.overtimeMode ?? 'enabled';
      if ((shuffleSettings.overtimeMode ?? 'enabled') !== currentOvertimeMode) return true;
      const currentOvertimeSegments =
        typeof tournament.overtimeSegments === 'number' ? tournament.overtimeSegments : null;
      const localSegments =
        typeof shuffleSettings.overtimeSegments === 'number' ? shuffleSettings.overtimeSegments : null;
      if (localSegments !== currentOvertimeSegments) return true;
    } else {
      // Non-shuffle: compare global maxRounds
      const currentMaxRounds = tournament.maxRounds || 24;
      if (maxRounds !== currentMaxRounds) return true;
      const currentOvertimeMode = tournament.overtimeMode ?? 'enabled';
      if ((overtimeMode ?? 'enabled') !== currentOvertimeMode) return true;
      const currentOvertimeSegments =
        typeof tournament.overtimeSegments === 'number' ? tournament.overtimeSegments : null;
      const localSegments = typeof overtimeSegments === 'number' ? overtimeSegments : null;
      if (localSegments !== currentOvertimeSegments) return true;
      if (tournament.type === 'double_elimination') {
        const currentMode =
          (tournament.settings &&
            (tournament.settings as { grandFinalMode?: 'none' | 'simple' | 'double' })
              .grandFinalMode) ||
          'simple';
        if (grandFinalMode !== currentMode) return true;
      }
    }

    return false;
  };

  /** Grand final mode stored on the tournament being edited ('simple' when unset). */
  const savedGrandFinalModeOf = (): 'none' | 'simple' | 'double' => {
    const stored =
      tournament?.settings &&
      (tournament.settings as { grandFinalMode?: string }).grandFinalMode;
    return stored === 'none' || stored === 'double' ? stored : 'simple';
  };

  const handleTypeChange = (nextType: string) => {
    // Shuffle keeps max rounds and overtime in shuffleSettings, every other
    // type in maxRounds/overtimeMode. Carry the values across when the type
    // crosses that line, or the other form shows its own defaults (24, on) and
    // the values just entered look reset (#226).
    if (nextType === 'shuffle' && type !== 'shuffle') {
      setShuffleSettings((prev) => ({ ...prev, maxRounds, overtimeMode, overtimeSegments }));
    } else if (nextType !== 'shuffle' && type === 'shuffle') {
      setMaxRounds(shuffleSettings.maxRounds);
      setOvertimeMode(shuffleSettings.overtimeMode ?? 'enabled');
      setOvertimeSegments(
        typeof shuffleSettings.overtimeSegments === 'number' ? shuffleSettings.overtimeSegments : null
      );
    }
    setType(nextType);
    if (grandFinalModePicked || nextType !== 'double_elimination') return;
    // Back to the saved double-elimination type: keep its saved mode. Switching
    // to double elimination from another type: use the double-elim default
    // rather than whatever the old type had stored (was 'none').
    setGrandFinalMode(
      tournament?.type === 'double_elimination' ? savedGrandFinalModeOf() : 'simple'
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showError(t('tournament.toasts.nameRequired'));
      return;
    }

    if (maps.length === 0) {
      showError(t('tournament.toasts.selectAtLeastOneMap'));
      return;
    }

    // Validate global max rounds for non-shuffle tournaments
    if (type !== 'shuffle') {
      if (maxRounds < 1 || maxRounds > 30) {
        showError(t('tournament.toasts.maxRoundsRange'));
        return;
      }
    }

    // Shuffle tournaments don't use teams
    if (type === 'shuffle') {
      // Validate shuffle settings
      if (shuffleSettings.teamSize < 2 || shuffleSettings.teamSize > 10) {
        showError(t('tournament.toasts.teamSizeRange'));
        return;
      }
      if (shuffleSettings.maxRounds < 1 || shuffleSettings.maxRounds > 30) {
        showError(t('tournament.toasts.maxRoundsRange'));
        return;
      }
      // For shuffle tournaments, use the shuffle-specific endpoint
      await saveShuffleTournament();
      return;
    }

    // Validate team count for non-shuffle tournaments
    const validation = validateTeamCountForType(type, selectedTeams.length, t);
    if (!validation.isValid) {
      showError(validation.error || t('tournament.toasts.invalidTeamCount'));
      return;
    }

    if (selectedTeams.length === 0) {
      showError(t('tournament.toasts.selectAtLeastTwoTeams'));
      return;
    }

    // Check for changes if editing
    if (tournament) {
      const detectedChanges: TournamentChange[] = [];

      if (name !== tournament.name) {
        detectedChanges.push({
          field: 'name',
          label: t('tournament.review.summary.nameLabel'),
          oldValue: tournament.name,
          newValue: name,
        });
      }
      if (type !== tournament.type) {
        detectedChanges.push({
          field: 'type',
          label: t('tournament.review.summary.typeLabel'),
          oldValue: t(`tournament.typeSelector.types.${tournament.type}.label`, tournament.type),
          newValue: t(`tournament.typeSelector.types.${type}.label`, type),
        });
      }
      if (type === 'double_elimination') {
        // Not double elimination before: there was no grand final.
        const oldMode = tournament.type === 'double_elimination' ? savedGrandFinalModeOf() : 'none';
        if (grandFinalMode !== oldMode) {
          detectedChanges.push({
            field: 'grandFinalMode',
            label: t('tournament.grandFinal.label'),
            oldValue: t(`tournament.grandFinal.options.${oldMode}`),
            newValue: t(`tournament.grandFinal.options.${grandFinalMode}`),
          });
        }
      }
      if (format !== tournament.format) {
        detectedChanges.push({
          field: 'format',
          label: t('tournament.review.summary.formatLabel'),
          oldValue: formatLabel(tournament.format),
          newValue: formatLabel(format),
        });
      }
      if (JSON.stringify(selectedTeams.sort()) !== JSON.stringify(tournament.teamIds.sort())) {
        const oldTeams = teams.filter((t) => tournament.teamIds.includes(t.id)).map((t) => t.name);
        const newTeams = teams.filter((t) => selectedTeams.includes(t.id)).map((t) => t.name);
        detectedChanges.push({
          field: 'teamIds',
          label: t('tournament.labels.teams'),
          oldValue: oldTeams.length > 0 ? oldTeams : [],
          newValue: newTeams.length > 0 ? newTeams : [],
        });
      }
      if (JSON.stringify(maps.sort()) !== JSON.stringify(tournament.maps.sort())) {
        detectedChanges.push({
          field: 'maps',
          label: t('tournament.labels.mapPool'),
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
        maxRounds: shuffleSettings.maxRounds,
        overtimeMode: shuffleSettings.overtimeMode ?? 'enabled',
        overtimeSegments:
          typeof shuffleSettings.overtimeSegments === 'number'
            ? shuffleSettings.overtimeSegments
            : undefined,
        eloTemplateId: shuffleSettings.eloTemplateId,
      };

      const response = await api.post<{
        success: boolean;
        tournament: unknown;
        error?: string;
      }>('/api/tournament/shuffle', payload);

      if (response.success) {
        const minPlayers = (shuffleSettings.teamSize || 5) * 2;
        showSuccess(
          t('tournament.toasts.shuffleCreated', {
            name,
            minPlayers,
            teamSize: shuffleSettings.teamSize || 5,
          })
        );
        clearDraft();
        await refreshData();
      } else {
        showError(response.error || t('tournament.toasts.shuffleCreateFailed'));
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || t('tournament.toasts.shuffleCreateFailedRetry'));
    } finally {
      setSaving(false);
    }
  };

  const saveChanges = async () => {
    setSaving(true);
    setShowChangePreview(false);

    try {
      const baseSettings = tournament?.settings || {
        matchFormat: format,
        thirdPlaceMatch: false,
        autoAdvance: true,
        checkInRequired: false,
        seedingMethod: 'random',
      };

      // Keep every existing setting the wizard doesn't show (seeding, third
      // place, custom veto order, ...). grandFinalMode is only edited for
      // double elimination; overwriting it with 'none' for other types used to
      // silently change a saved 'simple' setting.
      const settings = {
        ...baseSettings,
        ...(type === 'double_elimination' ? { grandFinalMode } : {}),
      };

      const payload = {
        name,
        type,
        format,
        maps,
        teamIds: selectedTeams,
        settings,
        maxRounds,
        overtimeMode,
        // null, not undefined: the API leaves an absent field alone, so
        // sending undefined made "back to the MatchZy default" unsaveable.
        overtimeSegments: typeof overtimeSegments === 'number' ? overtimeSegments : null,
      };

      const response = await saveTournament(payload);

      if (response.success) {
        showSuccess(
          tournament ? t('tournament.toasts.updated') : t('tournament.toasts.created')
        );
        // Clear draft when tournament is successfully created
        if (!tournament) {
          clearDraft();
        }
        await refreshData();
      } else {
        showError(response.error || t('tournament.toasts.saveFailed'));
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || t('tournament.toasts.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setShowDeleteConfirm(false);

    try {
      await deleteTournament();
      showSuccess(t('tournament.toasts.deleted'));
      await refreshData();
    } catch (err) {
      const error = err as Error;
      showError(error.message || t('tournament.toasts.deleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setSaving(true);
    setShowRegenerateConfirm(false);

    try {
      await regenerateBracket(true);
      showSuccess(t('tournament.toasts.regenerated'));
    } catch (err) {
      const error = err as Error;
      showError(error.message || t('tournament.toasts.regenerateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setShowResetConfirm(false);

    try {
      await resetTournament();
      showSuccess(t('tournament.toasts.resetDone'));
    } catch (err) {
      const error = err as Error;
      showError(error.message || t('tournament.toasts.resetFailed'));
    } finally {
      setSaving(false);
    }
  };

  const getRequiredServersForTournament = () => {
    if (!tournament) return 0;
    if (tournament.type === 'shuffle') {
      // Shuffle tournaments reuse servers round-by-round; only one match per server at a time
      return 1;
    }
    const teamCount = tournament.teams?.length || 0;
    if (teamCount < 2) return 0;
    return Math.ceil(teamCount / 2);
  };

  const handleStart = async () => {
    // Always refresh the latest tournament state first. If the tournament
    // is already live/completed (e.g. started from another tab), just
    // return after the refresh instead of attempting to start again.
    await refreshData();
    if (tournament && (tournament.status === 'in_progress' || tournament.status === 'completed')) {
      return;
    }

    const requiredServers = getRequiredServersForTournament();

    // Check server availability first
    try {
      const availabilityResponse = await api.get<{
        success: boolean;
        availableServerCount: number;
      }>('/api/tournament/server-availability');

      if (availabilityResponse.success) {
        const available = availabilityResponse.availableServerCount;

        // If we don't have enough available servers to cover the first round's concurrent matches,
        // show a confirmation dialog so the admin explicitly accepts queued/paused matches.
        if (requiredServers > 0 && available < requiredServers) {
          setStartWarningInfo({ requiredServers, availableServers: available });
          setShowStartConfirm(true);
          return;
        }
      }
    } catch (err) {
      console.error('Error checking server availability:', err);
      // Continue anyway if check fails
    }

    // Servers are sufficient (or check failed) - start immediately
    await performTournamentStart();
  };

  const performTournamentStart = async () => {
    setStarting(true);
    setShowStartConfirm(false);
    setStartWarningInfo(null);

    try {
      const baseUrl = window.location.origin;
      const response = await startTournament(baseUrl);

      if (response.success) {
        const allocated = (response as { allocated?: number }).allocated || 0;
        if (allocated > 0) {
          showSuccess(t('tournament.toasts.started', { count: allocated }));
        } else {
          showSuccess(
            (response as { message?: string }).message || t('tournament.toasts.startRequested')
          );
        }
        // Refresh tournament data so the UI can transition into the live
        // management view once the backend flips status to "in_progress".
        await refreshData();
      } else {
        const message =
          (response as { message?: string }).message || t('tournament.toasts.startFailed');
        showError(message);
      }
    } catch (err) {
      const error = err as Error;
      try {
        const parsed = JSON.parse(error.message || '') as {
          errorCode?: string;
          servers?: Array<{
            id: string;
            name: string;
            installedBuildId: number | null;
            requiredVersion: number | null;
            reason: string;
          }>;
        };
        if (
          parsed?.errorCode === 'cs2_outdated_servers' &&
          Array.isArray(parsed.servers) &&
          parsed.servers.length > 0
        ) {
          setOutdatedServers(parsed.servers);
          setShowOutdatedDialog(true);
        } else {
          showError(error.message || t('tournament.toasts.startFailed'));
        }
      } catch {
        showError(error.message || t('tournament.toasts.startFailed'));
      }
    } finally {
      setStarting(false);
    }
  };

  // Keep the tournament setup view in sync with real-time status changes so
  // the Start button disappears as soon as the tournament actually moves into
  // the in_progress/completed phase (including when started from other tabs).
  useEffect(() => {
    const socket = io();

    const handleTournamentUpdate = (data?: { action?: string; status?: string }) => {
      if (!data) return;

      // For any status-bearing update, refresh tournament data so the wizard
      // can move into the correct step (setup vs live).
      if (data.status) {
        void refreshData();
      }
    };

    socket.on('tournament:update', handleTournamentUpdate);

    return () => {
      socket.off('tournament:update', handleTournamentUpdate);
      socket.close();
    };
  }, [refreshData]);

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
          maxRounds={maxRounds}
          onMaxRoundsChange={setMaxRounds}
          overtimeMode={overtimeMode}
          overtimeSegments={overtimeSegments}
          grandFinalMode={grandFinalMode}
          onOvertimeModeChange={setOvertimeMode}
          onOvertimeSegmentsChange={setOvertimeSegments}
          onGrandFinalModeChange={(mode) => {
            setGrandFinalMode(mode);
            setGrandFinalModePicked(true);
          }}
          onNameChange={setName}
          onTypeChange={handleTypeChange}
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
              // Restore the round / overtime / grand final settings too, so a
              // cancelled edit never leaves stale values behind.
              const savedSegments =
                typeof tournament.overtimeSegments === 'number' ? tournament.overtimeSegments : null;
              if (tournament.type === 'shuffle') {
                setShuffleSettings({
                  teamSize: tournament.teamSize || 5,
                  maxRounds: tournament.maxRounds || 24,
                  eloTemplateId: tournament.eloTemplateId || 'pure-win-loss',
                  overtimeMode: tournament.overtimeMode ?? 'enabled',
                  overtimeSegments: savedSegments,
                });
              } else {
                setMaxRounds(tournament.maxRounds || 24);
                setOvertimeMode(tournament.overtimeMode ?? 'enabled');
                setOvertimeSegments(savedSegments);
              }
              const savedGrandFinalMode =
                (tournament.settings &&
                  (tournament.settings as { grandFinalMode?: 'none' | 'simple' | 'double' })
                    .grandFinalMode) ||
                'simple';
              setGrandFinalMode(savedGrandFinalMode);
              setGrandFinalModePicked(false);
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
              hasBracket={hasBracket}
              onEdit={() => setIsEditing(true)}
              onStart={handleStart}
              onRegenerate={() => setShowRegenerateConfirm(true)}
              onDelete={() => setShowDeleteConfirm(true)}
              onBulkCreateShuffleMatches={
                tournament.type === 'shuffle' ? () => setBulkShuffleModalOpen(true) : undefined
              }
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
            maps: tournament.maps || [],
            mapSequence: tournament.mapSequence,
            teamSize: tournament.teamSize,
            maxRounds: tournament.maxRounds,
            overtimeMode: tournament.overtimeMode,
            overtimeSegments: tournament.overtimeSegments,
            eloTemplateId: tournament.eloTemplateId,
            winner: tournament.winner ?? null,
          }}
          tournamentId={tournament.id}
          onRename={handleRenameTournament}
          saving={saving}
          onViewBracket={() => navigate('/bracket')}
          onReset={() => setShowResetConfirm(true)}
          onDelete={() => setShowDeleteConfirm(true)}
          playerCount={tournament.type === 'shuffle' ? registeredPlayerCount : undefined}
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
        startWarning={startWarningInfo ?? undefined}
        onDeleteConfirm={handleDelete}
        onDeleteCancel={() => setShowDeleteConfirm(false)}
        onRegenerateConfirm={handleRegenerate}
        onRegenerateCancel={() => setShowRegenerateConfirm(false)}
        onResetConfirm={handleReset}
        onResetCancel={() => setShowResetConfirm(false)}
        onStartConfirm={performTournamentStart}
        onStartCancel={() => {
          setShowStartConfirm(false);
          setStartWarningInfo(null);
        }}
      />

      <ConfirmDialog
        open={showOutdatedDialog}
        title={t('tournament.outdatedServers.title')}
        message={
          <>
            <Box sx={{ mb: 1 }}>{t('tournament.outdatedServers.body')}</Box>
            <Box component="ul" sx={{ mt: 0, mb: 0, pl: 2 }}>
              {outdatedServers.map((s) => (
                <li key={s.id}>
                  {s.name} ({s.id})
                  {typeof s.installedBuildId === 'number' ? ` — installed=${s.installedBuildId}` : ''}
                  {typeof s.requiredVersion === 'number' ? `, required=${s.requiredVersion}` : ''}
                  {s.reason ? ` — ${s.reason}` : ''}
                </li>
              ))}
            </Box>
          </>
        }
        confirmLabel={
          disablingOutdated
            ? t('tournament.outdatedServers.disabling')
            : t('tournament.outdatedServers.confirm')
        }
        cancelLabel={t('common.cancel')}
        confirmColor="warning"
        loading={disablingOutdated}
        onCancel={() => setShowOutdatedDialog(false)}
        onConfirm={async () => {
          if (disablingOutdated) return;
          setDisablingOutdated(true);
          try {
            for (const s of outdatedServers) {
              await api.post(`/api/servers/${s.id}/disable`);
            }
            await refreshData();
            setShowOutdatedDialog(false);
            await performTournamentStart();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showError(t('tournament.toasts.disableServersFailed', { message: msg }));
          } finally {
            setDisablingOutdated(false);
          }
        }}
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
          showSuccess(t('tournament.toasts.templateSaved'));
        }}
        tournamentData={{
          name,
          type,
          format,
          maps,
          mapPoolId: currentMapPoolId,
          teamIds: selectedTeams,
          settings: tournament?.settings,
          maxRounds,
          overtimeMode,
          overtimeSegments,
          grandFinalMode,
        }}
      />

      {tournament && tournament.type === 'shuffle' && (
        <BulkShuffleMatchesModal
          open={bulkShuffleModalOpen}
          onClose={() => setBulkShuffleModalOpen(false)}
          tournamentId={tournament.id}
          teamSize={tournament.teamSize || 5}
          maps={tournament.maps || []}
          defaultMaxRounds={tournament.maxRounds || 24}
          onCreated={() => {
            void refreshData();
          }}
        />
      )}
    </Box>
  );
};

export default Tournament;
