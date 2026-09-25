import { pageTitle } from '../utils/pageTitle';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../contexts/SnackbarContext';
import { TournamentLive } from '../components/tournament/TournamentLive';
import { PageHead } from '../components/common/ui';
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
import {
  gameSettingsChanges,
  gameSettingsError,
  gameSettingsFor,
  gameSettingsOnTypeChange,
  moduleKeysOf,
} from '../components/tournament/setup/gameSettings';
import type { TournamentSetupContext } from '../integrations/types';
import { getIntegration, useIntegration } from '../integrations/registry';
import { useModuleState } from '../module-loader/useModuleState';
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
  organizer: '',
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
  // The game module's settings (CS2: the map pool and round rules): its steps
  // treat an empty object as its defaults.
  gameSettings: {},
  type: 'single_elimination',
  format: 'bo3',
  selectedTeams: [],
  grandFinalMode: 'simple',
  shuffleSettings: { teamSize: 5 },
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
    tournament.teamSize,
    tournament.eloTemplateId,
    grandFinalModeOf(tournament),
    tournament.game ?? null,
    // The game module's own settings (CS2: map pool and round rules).
    moduleKeysOf(tournament.settings),
  ]);

/** Form values for a saved tournament. */
const formFromTournament = (tournament: TournamentRecord): SetupFormValues => {
  const teamCount = tournament.teamIds?.length ?? 0;
  const game = tournament.game || DEFAULT_SETUP_GAME.id;
  return {
    ...DEFAULT_FORM,
    name: tournament.name,
    game,
    // The game module's settings as saved, completed by the module.
    gameSettings: gameSettingsFor(
      { game, type: tournament.type, format: tournament.format },
      tournament.settings
    ),
    type: tournament.type,
    format: tournament.format,
    selectedTeams: tournament.teamIds || [],
    eloTemplateId: tournament.eloTemplateId || DEFAULT_ELO_TEMPLATE_ID,
    // Stored even when the type isn't double elimination, so switching to it
    // (or saving untouched) keeps the saved behaviour.
    grandFinalMode: grandFinalModeOf(tournament),
    plannedTeams:
      teamCount >= 2 ? teamCount : nearestTeamCount(tournament.type, DEFAULT_FORM.plannedTeams),
    shuffleSettings: { teamSize: tournament.type === 'shuffle' ? tournament.teamSize || 5 : 5 },
  };
};

const Tournament: React.FC = () => {
  const navigate = useNavigate();
  // Start checks and setup steps come from the game's module: re-render when a code module arrives.
  useModuleState();
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
  const { name, type, format, selectedTeams, shuffleSettings, grandFinalMode, eloTemplateId } =
    form;
  // Whether the user picked a grand final mode in this edit; if not, changing
  // the type applies that type's default instead of a leftover value.
  const [grandFinalModePicked, setGrandFinalModePicked] = useState(false);
  const [eloTemplates, setEloTemplates] = useState<EloCalculationTemplate[]>([]);

  // Setup step navigation. The steps a game has differ (3.0 phase D, PR D9),
  // so "the last one" is not a constant.
  const setupGame = tournament?.game || form.game || DEFAULT_SETUP_GAME.id;
  // What the game module's setup model is asked about (item 8b).
  const settingsCtx: TournamentSetupContext = { game: setupGame, type, format };
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
    document.title = pageTitle(t('tournament.page.title'));
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
        // The game module's settings saved with the template (CS2: its pool,
        // maps and round rules), read by the module.
        gameSettings: gameSettingsFor(
          { game: DEFAULT_SETUP_GAME.id, type: template.type, format: template.format },
          settings
        ),
        selectedTeams: options.withTeams ? template.teamIds || [] : [],
        plannedTeams:
          options.withTeams && (template.teamIds?.length ?? 0) >= 2
            ? template.teamIds!.length
            : nearestTeamCount(template.type, DEFAULT_FORM.plannedTeams),
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

  // A template carries the game module's settings (CS2: pool, maps, rounds),
  // which only the module can read. Code modules load after first paint, so
  // a template opened by link waits until the setup game's module is here —
  // or known to be absent — rather than being read by the placeholder.
  const setupModulePending = Boolean(useIntegration(DEFAULT_SETUP_GAME.id).modulePending);
  useEffect(() => {
    const templateId = searchParams.get('template');
    if (templateId && !tournament && !setupModulePending) {
      void loadTemplate(parseInt(templateId, 10));
    }
  }, [searchParams, tournament, loadTemplate, setupModulePending]);

  const handleLoadTemplate = (template: TournamentTemplate) => {
    applyTemplate(template, { withTeams: true });
  };

  const handleSaveTemplate = () => {
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
      const { step, furthestStep: savedFurthest, ...draftValues } = data;
      // Only the fields the form still has: a draft from before 3.0 held the
      // game's settings as fields of its own, which its steps start over.
      const values = Object.fromEntries(
        Object.entries(draftValues).filter(([key]) => key in DEFAULT_FORM)
      ) as Partial<SetupFormValues>;
      setForm({
        ...DEFAULT_FORM,
        ...values,
        shuffleSettings: {
          teamSize: values.shuffleSettings?.teamSize ?? DEFAULT_FORM.shuffleSettings.teamSize,
        },
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
    if (eloTemplateId !== savedForm.eloTemplateId) return true;
    // The game module's settings (CS2: the map pool, in order for shuffle,
    // and the round rules), as the module compares them.
    if (
      gameSettingsChanges(
        savedForm.gameSettings,
        form.gameSettings,
        { ...settingsCtx, type: tournament.type },
        t
      ).length > 0
    ) {
      return true;
    }

    if (tournament.type === 'shuffle') {
      if (shuffleSettings.teamSize !== savedForm.shuffleSettings.teamSize) return true;
    } else if (
      tournament.type === 'double_elimination' &&
      grandFinalMode !== savedForm.grandFinalMode
    ) {
      return true;
    }

    return false;
  };

  const handleTypeChange = (nextType: string) => {
    setForm((prev) => {
      const next: SetupFormValues = {
        ...prev,
        type: nextType,
        // The game's settings follow the type as the module says (CS2: a new
        // shuffle starts from an empty map sequence). One object for every
        // type, so the round rules just entered carry across (#226).
        gameSettings: {
          ...prev.gameSettings,
          ...gameSettingsOnTypeChange(
            tournament?.game || prev.game || DEFAULT_SETUP_GAME.id,
            prev.gameSettings,
            prev.type,
            nextType
          ),
        },
      };
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

  const handlers: SetupFormHandlers = useMemo(
    () => ({
      onNameChange: (value) => patchForm({ name: value }),
      // Switching game drops the previous module's settings: they are keyed by
      // module, and a Rocket League tournament carrying CS2's object would
      // save a setting nothing reads and nothing can clear. The new game's
      // module starts its own.
      onGameChange: (value) =>
        setForm((prev) => ({
          ...prev,
          game: value,
          gameSettings: gameSettingsFor({ game: value, type: prev.type, format: prev.format }),
        })),
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
    [patchForm, grandFinalModePicked, tournament]
  );

  const eloTemplateName = (id: string) => eloTemplates.find((tpl) => tpl.id === id)?.name ?? id;

  const setupSteps = getIntegration(setupGame).tournamentSetupSteps;

  /**
   * The game module's settings as they are saved: the form's, completed by the
   * module (CS2: every field of `settings.cs2`, so the API gets the whole
   * object whatever steps were visited).
   */
  const savedGameSettings = () => gameSettingsFor(settingsCtx, form.gameSettings);

  const handleSave = async () => {
    if (!name.trim()) {
      showError(t('tournament.toasts.nameRequired'));
      return;
    }

    // The game's own settings, checked by its module, for the steps it has:
    // a manually reported tournament has no map pool to be empty (3.0 phase
    // D, PR D9).
    for (const step of ['content', 'rules'] as const) {
      if (!(step === 'content' ? setupSteps.content : setupSteps.rules)) continue;
      const error = gameSettingsError(step, form.gameSettings, settingsCtx, t);
      if (error) {
        showError(error);
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
      // The game module's changes that ask for a confirmation (CS2: the map
      // pool; its round rules have never asked).
      for (const change of gameSettingsChanges(
        savedForm?.gameSettings ?? {},
        form.gameSettings,
        settingsCtx,
        t
      )) {
        if (change.confirm === false) continue;
        detectedChanges.push({
          field: change.field,
          label: change.label,
          oldValue: change.oldValue,
          newValue: change.newValue,
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
      // Shuffle tournament configuration. The map sequence and round rules
      // are the game module's settings (CS2: settings.cs2).
      const payload = {
        name,
        teamSize: shuffleSettings.teamSize || 5,
        eloTemplateId,
        settings: savedGameSettings(),
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
        // The game module's own object (CS2: the map pool and round rules),
        // which the core stores without reading.
        ...savedGameSettings(),
      };

      const payload = {
        name,
        type,
        format,
        // Only on create: the API's update route does not take a game, and a
        // tournament's matches were built by the module that owns it.
        ...(tournament ? {} : { game: form.game }),
        teamIds: selectedTeams,
        settings,
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

      {/* Live tournament. (Setup has no page head: each question is its H1.) */}
      {tournament && isLive && <PageHead title={t('layout.pageTitle.tournament')} />}
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
          teamIds: selectedTeams,
          settings: tournament?.settings,
          // The game module's settings (CS2: pool, maps, round rules) are
          // saved with the template as they are.
          gameSettings: savedGameSettings(),
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
