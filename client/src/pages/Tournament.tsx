import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../contexts/SnackbarContext';
import { TournamentLive } from '../components/tournament/TournamentLive';
import { TournamentDialogs } from '../components/tournament/TournamentDialogs';
import {
  EventPageSettingsCard,
  type EventPageFields,
} from '../components/tournament/EventPageSettingsCard';
import {
  TournamentSetup,
  type SetupFormHandlers,
  type SetupFormValues,
} from '../components/tournament/setup/TournamentSetup';
import {
  nearestTeamCount,
  reviewStepIndexFor,
  setupStepsFor,
} from '../components/tournament/setup/setupSteps';
import { DEFAULT_SETUP_GAME } from '../components/tournament/setup/games';
import { getIntegration } from '../integrations/registry';
import { DEFAULT_ELO_TEMPLATE_ID } from '../components/tournament/setup/EloTemplateSelect';
import TournamentChangePreviewModal from '../components/modals/TournamentChangePreviewModal';
import SaveTemplateModal from '../components/modals/SaveTemplateModal';
import { BulkShuffleMatchesModal } from '../components/modals/BulkShuffleMatchesModal';
import { useTournament } from '../hooks/useTournament';
import { validateTeamCountForType } from '../utils/tournamentValidation';
import { api } from '../utils/api';
import { io } from 'socket.io-client';
import { onSocketReconnect } from '../utils/socketResync';
import { MATCH_FORMATS } from '../constants/tournament';
import type { Tournament as TournamentRecord, TournamentTemplate } from '../types/tournament.types';
import type { ShuffleTournamentSettings } from '../components/tournament/ShuffleTournamentConfigStep';
import type { EloCalculationTemplate } from '../types/elo.types';

/** Human label for a match format ("bo3" -> "Best of 3"), raw value if unknown. */
const formatLabel = (value: string): string =>
  MATCH_FORMATS.find((f) => f.value === value)?.label ?? value;

type GrandFinalMode = 'none' | 'simple' | 'double';

interface TournamentChange {
  field: string;
  label?: string;
  oldValue?: string | string[];
  newValue?: string | string[];
}

/** sessionStorage key for a new tournament's form (drafts are per browser tab). */
const STORAGE_KEY = 'tournament_form_draft';
/** Step key the old wizard used; cleared with the draft. */
const LEGACY_STEP_STORAGE_KEY = 'tournament_form_step';

const EMPTY_EVENT_PAGE: EventPageFields = {
  description: '',
  location: '',
  rulebookUrl: '',
  rules: [],
  prizes: [],
  schedule: [],
};

const DEFAULT_FORM: SetupFormValues = {
  name: '',
  // Counter-Strike 2 until the organizer picks otherwise: what every
  // tournament created before 3.0 phase D was, and the `game` column default.
  game: DEFAULT_SETUP_GAME.id,
  gameSettings: {},
  type: 'single_elimination',
  format: 'bo3',
  selectedTeams: [],
  maps: [],
  maxRounds: 24,
  overtimeMode: 'enabled',
  overtimeSegments: null,
  grandFinalMode: 'simple',
  shuffleSettings: { teamSize: 5, maxRounds: 24, overtimeMode: 'enabled', overtimeSegments: null },
  eloTemplateId: DEFAULT_ELO_TEMPLATE_ID,
  plannedTeams: 8,
  eventPage: EMPTY_EVENT_PAGE,
};

const isEventPageEmpty = (fields: EventPageFields) =>
  JSON.stringify(fields) === JSON.stringify(EMPTY_EVENT_PAGE);

/** Grand final mode stored in a tournament's settings ('simple' when unset). */
const grandFinalModeOf = (
  tournament: Pick<TournamentRecord, 'settings'> | null
): GrandFinalMode => {
  const stored = (tournament?.settings as { grandFinalMode?: string } | undefined)?.grandFinalMode;
  return stored === 'none' || stored === 'double' ? stored : 'simple';
};

/** The fields of a saved tournament the setup form edits, for "did the server copy change?". */
const formKeyOf = (tournament: TournamentRecord) =>
  JSON.stringify([
    tournament.id,
    tournament.status,
    tournament.name,
    tournament.type,
    tournament.format,
    tournament.teamIds,
    tournament.maps,
    tournament.teamSize,
    tournament.maxRounds,
    tournament.overtimeMode,
    tournament.overtimeSegments,
    tournament.eloTemplateId,
    grandFinalModeOf(tournament),
    tournament.game ?? null,
    gameSettingsOf(tournament),
  ]);

/**
 * A game module's own settings inside `tournament.settings`: everything the
 * core does not name. The core stores and forwards them without reading them,
 * so "not one of ours" is the only test there can be (3.0 phase D, PR D9).
 */
const CORE_SETTING_KEYS = new Set([
  'matchFormat',
  'thirdPlaceMatch',
  'autoAdvance',
  'checkInRequired',
  'seedingMethod',
  'grandFinalMode',
  'maxRounds',
  'overtimeMode',
  'overtimeSegments',
  'customVetoOrder',
  'description',
  'location',
  'rules',
  'rulebookUrl',
  'prizes',
  'schedule',
]);

const gameSettingsOf = (tournament: Pick<TournamentRecord, 'settings'>): Record<string, unknown> => {
  const settings = (tournament.settings ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!CORE_SETTING_KEYS.has(key)) out[key] = value;
  }
  return out;
};

/** Form values for a saved tournament. */
const formFromTournament = (tournament: TournamentRecord): SetupFormValues => {
  const segments =
    typeof tournament.overtimeSegments === 'number' ? tournament.overtimeSegments : null;
  const teamCount = tournament.teamIds?.length ?? 0;
  const base: SetupFormValues = {
    ...DEFAULT_FORM,
    name: tournament.name,
    game: tournament.game || DEFAULT_SETUP_GAME.id,
    gameSettings: gameSettingsOf(tournament),
    type: tournament.type,
    format: tournament.format,
    selectedTeams: tournament.teamIds || [],
    maps: tournament.maps || [],
    eloTemplateId: tournament.eloTemplateId || DEFAULT_ELO_TEMPLATE_ID,
    // Stored even when the type isn't double elimination, so switching to it
    // (or saving untouched) keeps the saved behaviour.
    grandFinalMode: grandFinalModeOf(tournament),
    plannedTeams:
      teamCount >= 2 ? teamCount : nearestTeamCount(tournament.type, DEFAULT_FORM.plannedTeams),
  };
  if (tournament.type === 'shuffle') {
    return {
      ...base,
      shuffleSettings: {
        teamSize: tournament.teamSize || 5,
        maxRounds: tournament.maxRounds || 24,
        overtimeMode: tournament.overtimeMode ?? 'enabled',
        overtimeSegments: segments,
      },
    };
  }
  // Bracket tournaments keep one round limit / overtime policy for every map.
  return {
    ...base,
    maxRounds: tournament.maxRounds || 24,
    overtimeMode: tournament.overtimeMode ?? 'enabled',
    overtimeSegments: segments,
  };
};

const Tournament: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    tournament,
    teams,
    loading,
    hasBracket,
    saveTournament,
    updateSettings,
    deleteTournament,
    regenerateBracket,
    resetTournament,
    startTournament,
    refreshData,
  } = useTournament();

  // Form state
  const [form, setForm] = useState<SetupFormValues>(DEFAULT_FORM);
  const patchForm = React.useCallback(
    (patch: Partial<SetupFormValues>) => setForm((prev) => ({ ...prev, ...patch })),
    []
  );
  const {
    name,
    type,
    format,
    selectedTeams,
    maps,
    shuffleSettings,
    maxRounds,
    overtimeMode,
    overtimeSegments,
    grandFinalMode,
    eloTemplateId,
  } = form;
  // Whether the user picked a grand final mode in this edit; if not, changing
  // the type applies that type's default instead of a leftover value.
  const [grandFinalModePicked, setGrandFinalModePicked] = useState(false);
  const [eloTemplates, setEloTemplates] = useState<EloCalculationTemplate[]>([]);

  // Setup step navigation. The steps a game has differ (3.0 phase D, PR D9),
  // so "the last one" is not a constant.
  const setupGame = tournament?.game || form.game || DEFAULT_SETUP_GAME.id;
  const [activeStep, setActiveStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const goToStep = React.useCallback((index: number) => {
    setActiveStep(index);
    setFurthestStep((prev) => Math.max(prev, index));
  }, []);

  // Shuffle always plays Bo1.
  useEffect(() => {
    if (type === 'shuffle' && format !== 'bo1') {
      patchForm({ format: 'bo1' });
    }
  }, [type, format, patchForm]);

  // Action state
  const { showSuccess, showError } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  // A refusal the game's own module offered a way out of, instead of the error
  // snackbar (CS2: servers Steam says are out of date). 3.0 phase E.
  const [startFailure, setStartFailure] = useState<string | null>(null);
  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);
  const [currentMapPoolId, setCurrentMapPoolId] = useState<number | null>(null);
  const [registeredPlayerCount, setRegisteredPlayerCount] = useState<number | undefined>(undefined);
  const [draftPersisted, setDraftPersisted] = useState(false);

  // Dialog state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // True from the moment "start" is clicked until the module's own check has
  // either asked the admin something or let the start through.
  const [startPreflightOpen, setStartPreflightOpen] = useState(false);

  // Everything starting says in the game's words: the check that runs first,
  // and the way out of a refusal the module recognises. A module that fills
  // neither starts without asking and reports a refusal the ordinary way.
  const startIntegration = getIntegration(setupGame);
  const startSlot = startIntegration.tournamentStart;
  const StartPreflight = startSlot?.preflight?.view;
  const StartFailureView = startSlot?.failureView;
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

  // ---- Draft (new tournament only), kept in sessionStorage -----------------
  const draftRestoredRef = useRef(false);
  const clearDraft = React.useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_STEP_STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing draft from sessionStorage:', error);
    }
    setDraftPersisted(false);
  }, []);

  const resetForm = React.useCallback(() => {
    setForm(DEFAULT_FORM);
    setGrandFinalModePicked(false);
    setCurrentMapPoolId(null);
    setActiveStep(0);
    setFurthestStep(0);
  }, []);

  useEffect(() => {
    // Not before the saved draft has been read back (below), or this would
    // overwrite it with the empty form.
    if (tournament || loading || !draftRestoredRef.current) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...form, step: activeStep, furthestStep })
      );
      setDraftPersisted(true);
    } catch (error) {
      console.error('Error saving form data to sessionStorage:', error);
      setDraftPersisted(false);
    }
  }, [form, activeStep, furthestStep, tournament, loading]);

  // ---- Templates -----------------------------------------------------------
  const applyTemplate = React.useCallback(
    (template: TournamentTemplate, options: { withTeams: boolean }) => {
      const settings = template.settings;
      setForm({
        ...DEFAULT_FORM,
        name: template.name,
        type: template.type,
        format: template.format,
        maps: template.maps || [],
        selectedTeams: options.withTeams ? template.teamIds || [] : [],
        plannedTeams:
          options.withTeams && (template.teamIds?.length ?? 0) >= 2
            ? template.teamIds!.length
            : nearestTeamCount(template.type, DEFAULT_FORM.plannedTeams),
        // Saved global round / overtime / grand final settings, when present.
        maxRounds:
          typeof settings?.maxRounds === 'number' ? settings.maxRounds : DEFAULT_FORM.maxRounds,
        overtimeMode: settings?.overtimeMode ?? DEFAULT_FORM.overtimeMode,
        overtimeSegments:
          typeof settings?.overtimeSegments === 'number' ? settings.overtimeSegments : null,
        grandFinalMode: settings?.grandFinalMode ?? DEFAULT_FORM.grandFinalMode,
      });
      setGrandFinalModePicked(false);
      // A loaded template is complete: go straight to Review to confirm and
      // create. Templates are saved from a CS2 tournament and carry no game.
      const last = reviewStepIndexFor(DEFAULT_SETUP_GAME.id);
      setActiveStep(last);
      setFurthestStep(last);
      window.history.replaceState({}, '', '/tournament');
    },
    []
  );

  // Load template if specified in URL (?template=<id>)
  const loadTemplate = React.useCallback(
    async (templateId: number) => {
      try {
        const response = await api.get<{ success: boolean; template: TournamentTemplate }>(
          `/api/templates/${templateId}`
        );
        if (response.success && response.template) {
          // Templates opened by link don't bring their teams.
          applyTemplate(response.template, { withTeams: false });
        }
      } catch (error) {
        console.error('Error loading template:', error);
        showError(t('tournament.toasts.loadTemplateFailed'));
      }
    },
    [applyTemplate, showError, t]
  );

  useEffect(() => {
    const templateId = searchParams.get('template');
    if (templateId && !tournament) {
      void loadTemplate(parseInt(templateId, 10));
    }
  }, [searchParams, tournament, loadTemplate]);

  const handleLoadTemplate = (template: TournamentTemplate) => {
    applyTemplate(template, { withTeams: true });
    setCurrentMapPoolId(template.mapPoolId || null);
  };

  const handleSaveTemplate = (mapPoolId: number | null) => {
    setCurrentMapPoolId(mapPoolId);
    setSaveTemplateModalOpen(true);
  };

  // ---- Keep the form in step with the saved tournament ---------------------
  // Reload the form only when a field it edits changed on the server (our own
  // save, another tab, a status change). Saving the event page changes only
  // settings the form doesn't hold, so unsaved edits elsewhere survive it.
  const syncedKeyRef = useRef<string | null>(null);
  const syncedIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (loading) return;
    if (tournament) {
      const key = formKeyOf(tournament);
      if (key === syncedKeyRef.current) return;
      const isNewTournament = syncedIdRef.current !== tournament.id;
      syncedKeyRef.current = key;
      syncedIdRef.current = tournament.id;
      setForm(formFromTournament(tournament));
      setGrandFinalModePicked(false);
      if (isNewTournament) {
        // Just created, or opened with one in setup: land on Review (Start).
        const last = reviewStepIndexFor(tournament.game);
        setActiveStep(last);
        setFurthestStep(last);
      }
      clearDraft();
      return;
    }

    if (syncedIdRef.current !== null) {
      // The tournament was deleted: start a fresh form.
      syncedIdRef.current = null;
      syncedKeyRef.current = null;
      clearDraft();
      resetForm();
      return;
    }

    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    // A template link fills the form itself.
    if (searchParams.get('template')) return;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved) as Partial<SetupFormValues> & {
        step?: number;
        furthestStep?: number;
      };
      const { step, furthestStep: savedFurthest, ...values } = data;
      setForm({
        ...DEFAULT_FORM,
        ...values,
        shuffleSettings: { ...DEFAULT_FORM.shuffleSettings, ...(values.shuffleSettings ?? {}) },
        eventPage: { ...EMPTY_EVENT_PAGE, ...(values.eventPage ?? {}) },
      });
      // A draft saved for one game can hold a step the next game does not
      // have, so the bound is that game's own list.
      const stepCount = setupStepsFor(values.game ?? DEFAULT_FORM.game).length;
      const validStep = (n: unknown) =>
        typeof n === 'number' && n >= 0 && n < stepCount ? n : 0;
      setActiveStep(validStep(step));
      setFurthestStep(Math.max(validStep(step), validStep(savedFurthest)));
    } catch (error) {
      console.error('Error loading draft:', error);
    }
  }, [tournament, loading, searchParams, clearDraft, resetForm]);

  const handleDiscardDraft = () => {
    clearDraft();
    resetForm();
    window.history.replaceState({}, '', '/tournament');
  };

  const canEdit = !tournament || tournament.status === 'setup';

  /** The form as it was saved, to compare against. */
  const savedForm = useMemo(
    () => (tournament ? formFromTournament(tournament) : null),
    [tournament]
  );

  // Check if form has changes compared to tournament
  const hasChanges = (): boolean => {
    if (!tournament || !savedForm) return true; // Creating new tournament
    const sameSet = (a: string[], b: string[]) =>
      JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    if (name !== savedForm.name) return true;
    if (type !== savedForm.type) return true;
    if (format !== savedForm.format) return true;
    if (!sameSet(selectedTeams, savedForm.selectedTeams)) return true;
    // Shuffle plays the maps in order, so the order is part of the change.
    if (
      tournament.type === 'shuffle'
        ? JSON.stringify(maps) !== JSON.stringify(savedForm.maps)
        : !sameSet(maps, savedForm.maps)
    )
      return true;
    if (eloTemplateId !== savedForm.eloTemplateId) return true;

    if (tournament.type === 'shuffle') {
      const saved = savedForm.shuffleSettings;
      if (shuffleSettings.teamSize !== saved.teamSize) return true;
      if (shuffleSettings.maxRounds !== saved.maxRounds) return true;
      if ((shuffleSettings.overtimeMode ?? 'enabled') !== saved.overtimeMode) return true;
      const localSegments =
        typeof shuffleSettings.overtimeSegments === 'number'
          ? shuffleSettings.overtimeSegments
          : null;
      if (localSegments !== saved.overtimeSegments) return true;
    } else {
      if (maxRounds !== savedForm.maxRounds) return true;
      if ((overtimeMode ?? 'enabled') !== savedForm.overtimeMode) return true;
      const localSegments = typeof overtimeSegments === 'number' ? overtimeSegments : null;
      if (localSegments !== savedForm.overtimeSegments) return true;
      if (tournament.type === 'double_elimination' && grandFinalMode !== savedForm.grandFinalMode) {
        return true;
      }
    }

    return false;
  };

  const handleTypeChange = (nextType: string) => {
    setForm((prev) => {
      const next: SetupFormValues = { ...prev, type: nextType };
      // Shuffle keeps max rounds and overtime in shuffleSettings, every other
      // type in maxRounds/overtimeMode. Carry the values across when the type
      // crosses that line, or the other form shows its own defaults (24, on) and
      // the values just entered look reset (#226).
      if (nextType === 'shuffle' && prev.type !== 'shuffle') {
        next.shuffleSettings = {
          ...prev.shuffleSettings,
          maxRounds: prev.maxRounds,
          overtimeMode: prev.overtimeMode,
          overtimeSegments: prev.overtimeSegments,
        };
      } else if (nextType !== 'shuffle' && prev.type === 'shuffle') {
        next.maxRounds = prev.shuffleSettings.maxRounds;
        next.overtimeMode = prev.shuffleSettings.overtimeMode ?? 'enabled';
        next.overtimeSegments =
          typeof prev.shuffleSettings.overtimeSegments === 'number'
            ? prev.shuffleSettings.overtimeSegments
            : null;
      }
      // Keep the planned team count on a value the new type allows.
      if (nextType !== 'shuffle' && prev.selectedTeams.length === 0) {
        next.plannedTeams = nearestTeamCount(nextType, prev.plannedTeams);
      }
      if (!grandFinalModePicked && nextType === 'double_elimination') {
        // Back to the saved double-elimination type: keep its saved mode.
        // Switching to double elimination from another type: use the
        // double-elim default rather than whatever the old type had stored.
        next.grandFinalMode =
          tournament?.type === 'double_elimination' ? grandFinalModeOf(tournament) : 'simple';
      }
      return next;
    });
  };

  // Stable, so the setup's map loading doesn't re-run on every render.
  const onMapsChange = React.useCallback(
    (value: string[]) => patchForm({ maps: value }),
    [patchForm]
  );
  const handlers: SetupFormHandlers = useMemo(
    () => ({
      onNameChange: (value) => patchForm({ name: value }),
      // Switching game drops the previous module's settings: they are keyed by
      // module, and a Rocket League tournament carrying CS2's object would
      // save a setting nothing reads and nothing can clear.
      onGameChange: (value) => patchForm({ game: value, gameSettings: {} }),
      onGameSettingsChange: (patch) =>
        setForm((prev) => ({ ...prev, gameSettings: { ...prev.gameSettings, ...patch } })),
      onTypeChange: handleTypeChange,
      onFormatChange: (value) => patchForm({ format: value }),
      onTeamsChange: (teamIds) =>
        setForm((prev) => ({
          ...prev,
          selectedTeams: teamIds,
          plannedTeams: teamIds.length >= 2 ? teamIds.length : prev.plannedTeams,
        })),
      onMapsChange,
      onCs2SettingsChange: (patch) =>
        setForm((prev) => {
          if (prev.type === 'shuffle') {
            return { ...prev, shuffleSettings: { ...prev.shuffleSettings, ...patch } };
          }
          return {
            ...prev,
            ...(patch.maxRounds !== undefined ? { maxRounds: patch.maxRounds } : {}),
            ...(patch.overtimeMode !== undefined ? { overtimeMode: patch.overtimeMode } : {}),
            ...('overtimeSegments' in patch
              ? { overtimeSegments: patch.overtimeSegments ?? null }
              : {}),
          };
        }),
      onGrandFinalModeChange: (mode) => {
        patchForm({ grandFinalMode: mode });
        setGrandFinalModePicked(true);
      },
      onShuffleSettingsChange: (settings: ShuffleTournamentSettings) =>
        patchForm({ shuffleSettings: settings }),
      onEloTemplateChange: (templateId) => patchForm({ eloTemplateId: templateId }),
      onPlannedTeamsChange: (count) => patchForm({ plannedTeams: count }),
      onEventPageChange: (fields) => patchForm({ eventPage: fields }),
    }),
    // handleTypeChange reads grandFinalModePicked and the saved tournament.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patchForm, onMapsChange, grandFinalModePicked, tournament]
  );

  const eloTemplateName = (id: string) => eloTemplates.find((tpl) => tpl.id === id)?.name ?? id;

  const gameHasMaps = Boolean(getIntegration(setupGame).tournamentSetupSteps.content);

  const handleSave = async () => {
    if (!name.trim()) {
      showError(t('tournament.toasts.nameRequired'));
      return;
    }

    // Only for a game played on maps this instance picks: a manually reported
    // tournament has no map pool to be empty (3.0 phase D, PR D9).
    if (gameHasMaps && maps.length === 0) {
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
        const oldMode =
          tournament.type === 'double_elimination' ? grandFinalModeOf(tournament) : 'none';
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
      if (
        JSON.stringify([...selectedTeams].sort()) !== JSON.stringify([...tournament.teamIds].sort())
      ) {
        const oldTeams = teams
          .filter((tm) => tournament.teamIds.includes(tm.id))
          .map((tm) => tm.name);
        const newTeams = teams.filter((tm) => selectedTeams.includes(tm.id)).map((tm) => tm.name);
        detectedChanges.push({
          field: 'teamIds',
          label: t('tournament.labels.teams'),
          oldValue: oldTeams.length > 0 ? oldTeams : [],
          newValue: newTeams.length > 0 ? newTeams : [],
        });
      }
      if (JSON.stringify([...maps].sort()) !== JSON.stringify([...tournament.maps].sort())) {
        detectedChanges.push({
          field: 'maps',
          label: t('tournament.labels.mapPool'),
          oldValue: tournament.maps.length > 0 ? tournament.maps : [],
          newValue: maps.length > 0 ? maps : [],
        });
      }
      const savedElo = tournament.eloTemplateId || DEFAULT_ELO_TEMPLATE_ID;
      if (eloTemplateId !== savedElo) {
        detectedChanges.push({
          field: 'eloTemplateId',
          label: t('tournament.shuffleConfig.eloTemplateLabel'),
          oldValue: eloTemplateName(savedElo),
          newValue: eloTemplateName(eloTemplateId),
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
        eloTemplateId,
      };

      const response = await api.post<{
        success: boolean;
        tournament: unknown;
        error?: string;
      }>('/api/tournament/shuffle', payload);

      if (response.success) {
        // The shuffle endpoint takes no settings: send the event page drafted
        // before creation as a settings update.
        if (!tournament && !isEventPageEmpty(form.eventPage)) {
          try {
            await updateSettings({ ...form.eventPage });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            showError(t('tournament.eventPage.saveError', { message }));
          }
        }
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
        // Event page fields filled in before the tournament existed.
        ...(isEventPageEmpty(form.eventPage) ? {} : form.eventPage),
      };

      // Keep every existing setting the setup doesn't show (seeding, third
      // place, custom veto order, ...). grandFinalMode is only edited for
      // double elimination; overwriting it with 'none' for other types used to
      // silently change a saved 'simple' setting.
      const settings = {
        ...baseSettings,
        ...(type === 'double_elimination' ? { grandFinalMode } : {}),
        // The game module's own object, which the core stores without reading.
        ...form.gameSettings,
      };

      const payload = {
        name,
        type,
        format,
        // A game with no map pool sends none, whatever a draft carried over
        // from a game that has one.
        maps: gameHasMaps ? maps : [],
        // Only on create: the API's update route does not take a game, and a
        // tournament's matches were built by the module that owns it.
        ...(tournament ? {} : { game: form.game }),
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
        // The rating template has its own endpoint.
        const savedElo = tournament?.eloTemplateId || DEFAULT_ELO_TEMPLATE_ID;
        const tournamentId = response.tournament?.id ?? tournament?.id;
        if (eloTemplateId !== savedElo && tournamentId !== undefined) {
          try {
            await api.put(`/api/tournament/${tournamentId}/elo-template`, {
              templateId: eloTemplateId,
            });
          } catch (err) {
            const error = err as Error;
            showError(error.message || t('tournament.toasts.saveFailed'));
          }
        }
        showSuccess(tournament ? t('tournament.toasts.updated') : t('tournament.toasts.created'));
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

  /** Throw away unsaved edits to a saved tournament. */
  const handleDiscardChanges = () => {
    if (!tournament) return;
    setForm(formFromTournament(tournament));
    setGrandFinalModePicked(false);
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

  /**
   * How many of the first round's matches can be played at the same time.
   *
   * This is the bracket's shape, not the game's: a shuffle tournament plays
   * one match at a time by design, and everything else opens half its teams'
   * worth at once. The game's module is what turns it into "that many
   * servers" (3.0 phase E).
   */
  const getConcurrentFirstRoundMatches = () => {
    if (!tournament) return 0;
    if (tournament.type === 'shuffle') {
      // Shuffle tournaments play round-by-round; only one match at a time
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

    // Whether there is anything to check before starting is the module's
    // answer, and so is what to ask. A module that fills no preflight slot is
    // saying there is nothing in the way (3.0 phase E).
    if (StartPreflight) {
      setStartPreflightOpen(true);
      return;
    }

    await performTournamentStart();
  };

  const performTournamentStart = async () => {
    setStarting(true);
    setStartPreflightOpen(false);

    try {
      const baseUrl = window.location.origin;
      const response = await startTournament(baseUrl);

      if (response.success) {
        const allocated = (response as { allocated?: number }).allocated || 0;
        if (!startIntegration.capabilities.servers) {
          // "0 matches allocated to servers" reads as a failure on a game
          // where every match is in fact open (3.0 phase E).
          showSuccess(t('tournament.startConfirm.started'));
        } else if (allocated > 0) {
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
      const message = error.message || t('tournament.toasts.startFailed');
      // A refusal the module recognises gets the module's way out; everything
      // else, for every game, is the error snackbar it has always been.
      if (StartFailureView && startSlot?.ownsFailure?.(message)) {
        setStartFailure(message);
      } else {
        showError(message);
      }
    } finally {
      setStarting(false);
    }
  };

  // Keep the page in sync with real-time status changes so the Start button
  // disappears as soon as the tournament actually moves into the
  // in_progress/completed phase (including when started from other tabs).
  // refreshData is a new function every render; read it through a ref so the
  // socket isn't reconnected on every keystroke in the form.
  const refreshDataRef = useRef(refreshData);
  refreshDataRef.current = refreshData;
  useEffect(() => {
    const socket = io();

    const handleTournamentUpdate = (data?: { action?: string; status?: string }) => {
      if (!data) return;

      // For any status-bearing update, refresh tournament data so the page
      // can move into the correct view (setup vs live).
      if (data.status) {
        void refreshDataRef.current();
      }
    };

    socket.on('tournament:update', handleTournamentUpdate);
    const offReconnect = onSocketReconnect(socket, () => void refreshDataRef.current());

    return () => {
      offReconnect();
      socket.off('tournament:update', handleTournamentUpdate);
      socket.close();
    };
  }, []);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  const isLive =
    !!tournament && (tournament.status === 'in_progress' || tournament.status === 'completed');
  const draftDirty =
    name.trim().length > 0 || selectedTeams.length > 0 || furthestStep > 0 || activeStep > 0;

  return (
    <Box data-testid="tournament-page" sx={{ width: '100%', height: '100%' }}>
      {!isLive && (
        <TournamentSetup
          tournament={
            tournament
              ? {
                  id: tournament.id,
                  name: tournament.name,
                  type: tournament.type,
                  format: tournament.format,
                  status: tournament.status,
                  teams: tournament.teams || [],
                  maps: tournament.maps || [],
                  teamSize: tournament.teamSize,
                  settings: tournament.settings,
                }
              : null
          }
          form={form}
          handlers={handlers}
          teams={teams}
          eloTemplates={eloTemplates}
          canEdit={canEdit}
          saving={saving}
          starting={starting}
          hasChanges={hasChanges()}
          hasBracket={hasBracket}
          registeredPlayerCount={tournament?.type === 'shuffle' ? registeredPlayerCount : undefined}
          mapPoolId={currentMapPoolId}
          activeStep={activeStep}
          furthestStep={furthestStep}
          onStepChange={goToStep}
          draftSaved={!tournament && draftPersisted && draftDirty}
          onLoadTemplate={handleLoadTemplate}
          onDiscardDraft={handleDiscardDraft}
          onSave={handleSave}
          onDiscardChanges={handleDiscardChanges}
          onDelete={() => setShowDeleteConfirm(true)}
          onSaveTemplate={handleSaveTemplate}
          onRefreshTeams={refreshData}
          onStart={handleStart}
          onRegenerate={() => setShowRegenerateConfirm(true)}
          onBulkCreateShuffleMatches={() => setBulkShuffleModalOpen(true)}
          onPlayersUpdated={() => {
            void refreshData();
            void loadRegisteredPlayerCount();
          }}
          onSaveEventPage={updateSettings}
        />
      )}

      {/* Live tournament */}
      {tournament && isLive && (
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

      {/* Event page: still editable once the tournament is running. Before
          that it is a step of the setup. */}
      {tournament && isLive && (
        <EventPageSettingsCard
          settings={tournament.settings}
          saving={saving}
          onSave={updateSettings}
        />
      )}

      {/* Dialogs */}
      <TournamentDialogs
        deleteOpen={showDeleteConfirm}
        regenerateOpen={showRegenerateConfirm}
        resetOpen={showResetConfirm}
        tournamentName={tournament?.name}
        tournamentStatus={tournament?.status}
        onDeleteConfirm={handleDelete}
        onDeleteCancel={() => setShowDeleteConfirm(false)}
        onRegenerateConfirm={handleRegenerate}
        onRegenerateCancel={() => setShowRegenerateConfirm(false)}
        onResetConfirm={handleReset}
        onResetCancel={() => setShowResetConfirm(false)}
      />

      {/* What the game wants checked before its tournament starts (CS2: that
          the fleet can take the first round). It asks only when there is
          something to ask, and otherwise starts. */}
      {StartPreflight && startPreflightOpen && (
        <StartPreflight
          open={startPreflightOpen}
          concurrentMatches={getConcurrentFirstRoundMatches()}
          onProceed={() => {
            void performTournamentStart();
          }}
          onCancel={() => setStartPreflightOpen(false)}
        />
      )}

      {/* A refusal the module knows how to undo (CS2: servers Steam says are
          out of date, which it can disable before retrying). */}
      {StartFailureView && startFailure !== null && (
        <StartFailureView
          error={startFailure}
          onClose={() => setStartFailure(null)}
          onRetry={async () => {
            await refreshData();
            await performTournamentStart();
          }}
          onError={(message) => showError(message)}
        />
      )}

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
