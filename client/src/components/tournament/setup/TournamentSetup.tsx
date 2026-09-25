import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Alert,
  Box,
  Button,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowLeftIcon, ArrowRightIcon, FileTextIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { estimateMatchCount, type GrandFinalMode } from '../../../utils/tournamentMatchCount';
import { requiresVeto } from '../../../utils/tournamentVerification';
import { validateTeamCountForType } from '../../../utils/tournamentValidation';
import type { Team } from '../../../types';
import type { EloCalculationTemplate } from '../../../types/elo.types';
import type { TournamentSettings, TournamentTemplate } from '../../../types/tournament.types';
import TeamModal from '../../modals/TeamModal';
import { TeamImportModal } from '../../modals/TeamImportModal';
import { TeamSelectionStep } from '../TeamSelectionStep';
import { ShufflePlayerRegistration } from '../ShufflePlayerRegistration';
import { ShuffleTournamentStats } from '../ShuffleTournamentStats';
import {
  ShuffleTournamentConfigStep,
  type ShuffleTournamentSettings,
} from '../ShuffleTournamentConfigStep';
import { EventPageSettingsCard, type EventPageFields } from '../EventPageSettingsCard';
import { useTournamentFormData } from '../useTournamentFormData';
import { SetupColumn } from './SetupColumn';
import { SetupSummary, type ChecklistItem, type SummaryRow } from './SetupSummary';
import { FormatCards } from './FormatCards';
import { SegmentedControl } from './SegmentedControl';
import { TeamCountStepper } from './TeamCountStepper';
import { getIntegration } from '../../../integrations/registry';
import { BELOW_NAV_STICKY_TOP } from '../../../constants/navBar';
import { useModuleState } from '../../../module-loader/useModuleState';
import type { TournamentSetupContext } from '../../../integrations/types';
import { gameSettingsError, gameSettingsRoundCount, gameSettingsSummary } from './gameSettings';
import { EloTemplateSelect } from './EloTemplateSelect';
import { ReviewStep, type ReviewTournament } from './ReviewStep';
import { GamePicker } from './GamePicker';
import { DEFAULT_SETUP_GAME, gameMark, useSetupGames, type SetupGame } from './games';
import { MEDIUM } from './layout';
import { useShellColumn } from '../../../contexts/ShellColumnContext';
import { setupStepsFor, stepError, teamCountChoices, type SetupStepId } from './setupSteps';

export interface SetupFormValues {
  name: string;
  /**
   * The game to run, as `tournament.game` stores it: an installed module's id
   * ('cs2') or a catalogue slug ('rocket-league'). It decides which steps the
   * wizard asks and which module runs the tournament (3.0 phase D, PR D9).
   */
  game: string;
  /**
   * The game module's own object(s) inside `tournament.settings`: CS2's
   * `cs2` (map pool, round rules), manual reporting's `manualReport`. The
   * core never reads them; the module's steps and setup model
   * (`tournamentSetup`) are the only things that know the shape (item 8b).
   */
  gameSettings: Record<string, unknown>;
  type: string;
  format: string;
  selectedTeams: string[];
  grandFinalMode: GrandFinalMode;
  shuffleSettings: ShuffleTournamentSettings;
  eloTemplateId: string;
  /** Team count planned on the Format step, used until teams are picked. */
  plannedTeams: number;
  /** Event page fields held until the tournament is created. */
  eventPage: EventPageFields;
}

export interface SetupFormHandlers {
  onNameChange: (name: string) => void;
  onGameChange: (game: string) => void;
  onGameSettingsChange: (patch: Record<string, unknown>) => void;
  onTypeChange: (type: string) => void;
  onFormatChange: (format: string) => void;
  onTeamsChange: (teamIds: string[]) => void;
  onGrandFinalModeChange: (mode: GrandFinalMode) => void;
  onShuffleSettingsChange: (settings: ShuffleTournamentSettings) => void;
  onEloTemplateChange: (templateId: string) => void;
  onPlannedTeamsChange: (count: number) => void;
  onEventPageChange: (fields: EventPageFields) => void;
}

export interface SetupTournament extends ReviewTournament {
  status: string;
  /** Game integration (API `game`); new tournaments use the setup's game. */
  game?: string;
  settings?: TournamentSettings;
}

interface TournamentSetupProps {
  tournament: SetupTournament | null;
  form: SetupFormValues;
  handlers: SetupFormHandlers;
  teams: Team[];
  eloTemplates: EloCalculationTemplate[];
  canEdit: boolean;
  saving: boolean;
  starting: boolean;
  hasChanges: boolean;
  hasBracket: boolean;
  registeredPlayerCount?: number;
  activeStep: number;
  /** Furthest step reached; steps up to it that validate show as done. */
  furthestStep: number;
  onStepChange: (index: number) => void;
  /** A new tournament's form is kept in sessionStorage. */
  draftSaved: boolean;
  onLoadTemplate: (template: TournamentTemplate) => void;
  onDiscardDraft: () => void;
  onSave: () => void;
  onDiscardChanges: () => void;
  onDelete: () => void;
  onSaveTemplate: () => void;
  onRefreshTeams: () => void | Promise<void>;
  onStart: () => void;
  onRegenerate: () => void;
  onBulkCreateShuffleMatches: () => void;
  onPlayersUpdated: () => void;
  onSaveEventPage: (patch: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Create / edit a tournament: steps on the left, one question at a time in the
 * middle, and a live summary on the right. Used both before the tournament
 * exists and while it is in setup; the last step creates or starts it.
 *
 * The setup takes the page over (layout "C"): the steps, under a "← Manage"
 * link, go in the admin shell's left column in place of the Manage rail, and
 * the form gets the width the rail's page would have had.
 */
export function TournamentSetup(props: TournamentSetupProps) {
  const { t } = useTranslation();
  // The steps come from the game's module: re-render when a code module arrives.
  useModuleState();
  const { tournament, form, handlers, canEdit, saving } = props;
  const shellColumn = useShellColumn();
  const isShuffle = form.type === 'shuffle';
  const locked = !canEdit || saving;

  // ---- The game, and the steps it brings ------------------------------------
  // A saved tournament's own `game` wins: its matches were built for it, so
  // the wizard shows that game's steps whatever the draft form still holds.
  const game = tournament?.game || form.game || DEFAULT_SETUP_GAME.id;
  const { games: setupGames, loading: loadingGames } = useSetupGames();
  const steps = setupStepsFor(game);
  const reviewStepIndex = steps.length - 1;
  const stepId = steps[props.activeStep] ?? 'game';
  // A saved tournament can name a game the playable list does not — one found
  // through game search, which manual reporting runs too. It is named by its
  // catalogue id and gets a text mark, never another game's icon.
  const pickedGame: SetupGame = setupGames.find((entry) => entry.id === game) ?? {
    id: game,
    name: game,
    mark: gameMark(game.replace(/-/g, ' ')),
    integrationId: getIntegration(game).id,
  };

  // ---- Data the steps need (servers) ---------------------------------------
  // The game's own data (CS2: map pools and maps) is its steps' to load.
  const { serverCount, loadingServers, refreshServers } = useTournamentFormData();

  // Game-specific steps and dialogs (CS2: rounds/overtime, map pool, servers).
  const integration = getIntegration(game);
  const RulesStep = integration.tournamentSetupSteps.rules;
  const ContentStep = integration.tournamentSetupSteps.content;
  const GameSettingsStep = integration.tournamentSetupSteps.settings;
  const GameReview = integration.tournamentSetupSteps.review;
  // A module with its own settings step asks for the series length there, so
  // the core does not ask a second time (see TournamentGameSettingsStepProps).
  const coreOwnsSeriesLength = !GameSettingsStep;
  const needsServers = integration.capabilities.servers;
  // What every one of the module's steps and its setup model get: the game's
  // settings object, which only the module reads (item 8b).
  const settingsCtx: TournamentSetupContext = { game, type: form.type, format: form.format };
  const settingsStepProps = {
    settings: form.gameSettings,
    onChange: handlers.onGameSettingsChange,
    game,
    type: form.type,
    format: form.format,
    disabled: locked,
  };
  const gameSummary = gameSettingsSummary(form.gameSettings, settingsCtx, t);
  const AddResourceDialog = integration.resourceDialogs.add;
  const BatchResourceDialog = integration.resourceDialogs.batchAdd;

  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamImportModalOpen, setTeamImportModalOpen] = useState(false);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [batchServerModalOpen, setBatchServerModalOpen] = useState(false);


  // ---- Templates ("Start from a template") ---------------------------------
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [templateMenu, setTemplateMenu] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (tournament) return;
    let cancelled = false;
    api
      .get<{ success: boolean; templates: TournamentTemplate[] }>('/api/templates')
      .then((response) => {
        if (!cancelled && response.success) setTemplates(response.templates);
      })
      .catch((error) => console.error('Error loading templates:', error));
    return () => {
      cancelled = true;
    };
  }, [tournament]);

  // ---- Validation and navigation ------------------------------------------
  const validationInput = {
    name: form.name,
    type: form.type,
    format: form.format,
    teamCount: form.selectedTeams.length,
    teamSize: form.shuffleSettings.teamSize,
    // Only a step the game has: a game without match rules has nothing to check.
    moduleError: (step: 'rules' | 'content') =>
      (step === 'rules' ? RulesStep : ContentStep)
        ? gameSettingsError(step, form.gameSettings, settingsCtx, t)
        : null,
  };
  const errorFor = (step: SetupStepId) => stepError(step, validationInput, t);
  const currentError = errorFor(stepId);
  // The step where Continue was refused; its message shows until the step changes.
  const [refusedStep, setRefusedStep] = useState<number | null>(null);
  const showError = refusedStep === props.activeStep;

  const headingRef = useRef<HTMLElement | null>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    // Move focus to the new question so keyboard and screen reader users land on it.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [props.activeStep]);

  const goTo = (index: number) => {
    if (index < 0 || index >= steps.length) return;
    setRefusedStep(null);
    props.onStepChange(index);
  };

  const handleContinue = () => {
    if (currentError) {
      setRefusedStep(props.activeStep);
      return;
    }
    goTo(props.activeStep + 1);
  };

  const isDone = (step: SetupStepId, index: number) =>
    index <= props.furthestStep && step !== 'review' && errorFor(step) === null;

  const stepColumn = (
    <SetupColumn steps={steps} activeStep={props.activeStep} isDone={isDone} onSelect={goTo} />
  );

  // ---- Summary ---------------------------------------------------------------
  const selectedCount = form.selectedTeams.length;
  const teamCountForMath = selectedCount > 0 ? selectedCount : form.plannedTeams;
  const estimate = estimateMatchCount({
    type: form.type,
    teamCount: teamCountForMath,
    grandFinalMode: form.grandFinalMode,
    // Shuffle: one round per unit of the game's content (CS2: per map).
    mapCount: gameSettingsRoundCount(form.gameSettings, settingsCtx) ?? 0,
    playerCount: tournament ? props.registeredPlayerCount : undefined,
    teamSize: form.shuffleSettings.teamSize,
  });
  const seriesLabel = form.format.replace(/^bo/, 'Bo');

  const summaryRows: SummaryRow[] = [
    {
      key: 'format',
      label: t('tournament.setup.summary.format'),
      value: t(`tournament.setup.format.names.${form.type}`),
    },
    {
      key: 'series',
      label: t('tournament.setup.summary.series'),
      value: isShuffle
        ? t('tournament.setup.summary.seriesShuffle')
        : form.type === 'double_elimination'
          ? t(`tournament.setup.summary.seriesFinal.${form.grandFinalMode}`, {
              format: seriesLabel,
            })
          : seriesLabel,
    },
    isShuffle
      ? {
          key: 'teams',
          label: t('tournament.setup.summary.teams'),
          value: t('tournament.setup.summary.teamSize', { size: form.shuffleSettings.teamSize }),
        }
      : selectedCount > 0
        ? {
            key: 'teams',
            label: t('tournament.setup.summary.teams'),
            value: String(selectedCount),
          }
        : {
            key: 'teams',
            label: t('tournament.setup.summary.teams'),
            value: t('tournament.setup.summary.teamsPlanned', { count: form.plannedTeams }),
            pending: true,
          },
    {
      key: 'matches',
      label: t('tournament.setup.summary.matches'),
      value:
        estimate.matches !== null
          ? String(estimate.matches)
          : isShuffle && estimate.rounds !== null
            ? t('tournament.setup.summary.matchesAfterSignUp')
            : t('tournament.setup.summary.notSet'),
      pending: estimate.matches === null,
    },
    isShuffle
      ? tournament
        ? {
            key: 'signup',
            label: t('tournament.setup.summary.signUp'),
            value: t('tournament.setup.summary.players', {
              count: props.registeredPlayerCount ?? 0,
            }),
          }
        : {
            key: 'signup',
            label: t('tournament.setup.summary.signUp'),
            value: t('tournament.setup.summary.signUpAfterCreate'),
            pending: true,
          }
      : {
          key: 'signup',
          label: t('tournament.setup.summary.signUp'),
          value: t('tournament.setup.summary.signUpOrganizer'),
        },
    // The game's own rows (CS2: the map pool).
    ...gameSummary.rows,
  ];

  // Only real preconditions for Start.
  const minPlayers = form.shuffleSettings.teamSize * 2;
  const teamRule = validateTeamCountForType(form.type, selectedCount, t);
  const checklist: ChecklistItem[] = [
    { key: 'name', label: t('tournament.setup.checklist.name'), met: form.name.trim().length > 0 },
    {
      key: 'format',
      label: t('tournament.setup.checklist.format'),
      met: errorFor('format') === null,
    },
    isShuffle
      ? {
          key: 'players',
          label: t('tournament.setup.checklist.players', { count: minPlayers }),
          met: !!tournament && (props.registeredPlayerCount ?? 0) >= minPlayers,
        }
      : {
          key: 'teams',
          label: t('tournament.setup.checklist.teams'),
          met: selectedCount >= 2 && teamRule.isValid,
        },
    // The game's own conditions (CS2: a valid map pool).
    ...gameSummary.checklist,
    { key: 'created', label: t('tournament.setup.checklist.created'), met: !!tournament },
  ];
  if (tournament && canEdit) {
    checklist.push({
      key: 'saved',
      label: t('tournament.setup.checklist.saved'),
      met: !props.hasChanges,
    });
  }

  // ---- Step content ----------------------------------------------------------
  const nextStepId = steps[props.activeStep + 1];
  const lede = (() => {
    if (stepId === 'teams' && isShuffle) return t('tournament.setup.questions.teams.ledeShuffle');
    if (stepId === 'maps' && isShuffle) return t('tournament.setup.questions.maps.ledeShuffle');
    if (stepId === 'review' && tournament)
      return t('tournament.setup.questions.review.ledeExisting');
    return t(`tournament.setup.questions.${stepId}.lede`);
  })();

  const renderStep = () => {
    switch (stepId) {
      case 'game':
        return (
          <Field
            label={t('tournament.setup.game.label')}
            help={
              tournament
                ? t('tournament.setup.game.lockedHelp')
                : loadingGames
                  ? t('tournament.setup.game.loading')
                  : undefined
            }
          >
            <GamePicker
              games={setupGames}
              value={game}
              onChange={handlers.onGameChange}
              // The game is fixed once the tournament exists: its matches were
              // built by that module, and nothing moves them to another one.
              disabled={locked || !!tournament}
              label={t('tournament.setup.game.label')}
            />
          </Field>
        );

      case 'basics':
        return (
          <>
            <TextField
              label={t('tournament.nameLabel', 'Tournament Name')}
              value={form.name}
              onChange={(e) => handlers.onNameChange(e.target.value)}
              disabled={locked}
              fullWidth
              required
              placeholder={t('tournament.namePlaceholder', 'Auto Tournament 2025 Spring Tournament')}
              slotProps={{ htmlInput: { 'data-testid': 'tournament-name-input' } }}
            />
            <Field
              label={t('tournament.setup.basics.ratingLabel')}
              help={t('tournament.setup.basics.ratingHelp')}
            >
              <EloTemplateSelect
                value={form.eloTemplateId}
                templates={props.eloTemplates}
                onChange={handlers.onEloTemplateChange}
                disabled={locked}
              />
            </Field>
          </>
        );

      case 'format': {
        const choices = teamCountChoices(form.type);
        const rule =
          choices.length > 0 && choices[choices.length - 1] - choices[0] + 1 !== choices.length;
        return (
          <>
            <Field label={t('tournament.setup.format.label')}>
              <FormatCards value={form.type} onChange={handlers.onTypeChange} disabled={locked} />
            </Field>

            {isShuffle ? (
              <>
                <Alert severity="info">{t('tournament.formatStep.shuffleInfo')}</Alert>
                <Field label={t('tournament.setup.format.shuffleTitle')}>
                  <ShuffleTournamentConfigStep
                    settings={form.shuffleSettings}
                    canEdit={canEdit}
                    saving={saving}
                    onSettingsChange={handlers.onShuffleSettingsChange}
                  />
                </Field>
              </>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                  gap: 3,
                }}
              >
                {coreOwnsSeriesLength && (
                  <Field label={t('tournament.setup.format.seriesLength')}>
                    <SegmentedControl
                      label={t('tournament.setup.format.seriesLength')}
                      value={form.format}
                      onChange={handlers.onFormatChange}
                      disabled={locked}
                      testId="tournament-format-selector"
                      options={['bo1', 'bo3', 'bo5'].map((value) => ({
                        value,
                        label: value.replace(/^bo/, 'Bo'),
                        testId: `tournament-format-option-${value}`,
                      }))}
                    />
                  </Field>
                )}
                {form.type === 'double_elimination' && (
                  <Field
                    label={t('tournament.setup.format.grandFinal')}
                    help={t(`tournament.setup.format.grandFinalHelp.${form.grandFinalMode}`)}
                  >
                    <SegmentedControl<GrandFinalMode>
                      label={t('tournament.setup.format.grandFinal')}
                      value={form.grandFinalMode}
                      onChange={handlers.onGrandFinalModeChange}
                      disabled={locked}
                      testId="tournament-grand-final-selector"
                      options={(['simple', 'double', 'none'] as const).map((value) => ({
                        value,
                        label: t(`tournament.setup.format.grandFinalOptions.${value}`),
                        testId: `tournament-grand-final-option-${value}`,
                      }))}
                    />
                  </Field>
                )}
                <Field
                  label={t('tournament.setup.format.teams')}
                  labelId="tournament-team-count-label"
                  help={
                    rule
                      ? t('tournament.setup.format.teamsHelpPowerOfTwo', {
                          counts: choices.join(', '),
                        })
                      : t('tournament.setup.format.teamsHelpRange', {
                          min: choices[0],
                          max: choices[choices.length - 1],
                        })
                  }
                >
                  <TeamCountStepper
                    value={form.plannedTeams}
                    choices={choices}
                    onChange={handlers.onPlannedTeamsChange}
                    disabled={locked}
                    labelledBy="tournament-team-count-label"
                  />
                </Field>
              </Box>
            )}

            {RulesStep && <RulesStep {...settingsStepProps} />}

            {GameSettingsStep && (
              <GameSettingsStep
                {...settingsStepProps}
                gameName={pickedGame.name}
                onFormatChange={handlers.onFormatChange}
              />
            )}
          </>
        );
      }

      case 'teams':
        if (isShuffle) {
          if (!tournament) {
            return (
              <Alert severity="info" data-testid="shuffle-signup-after-create">
                {t('tournament.setup.teams.shuffleBeforeCreate')}
              </Alert>
            );
          }
          return (
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
              }}
            >
              <ShufflePlayerRegistration
                tournamentId={tournament.id}
                teamSize={tournament.teamSize || 5}
                onPlayersUpdated={props.onPlayersUpdated}
              />
              <ShuffleTournamentStats
                playerCount={props.registeredPlayerCount || 0}
                teamSize={tournament.teamSize || 5}
              />
            </Box>
          );
        }
        return (
          <TeamSelectionStep
            teams={props.teams}
            selectedTeams={form.selectedTeams}
            type={form.type}
            serverCount={serverCount}
            requiredServers={Math.ceil(selectedCount / 2)}
            // A game with no servers has nothing to run short of, so the
            // "not enough servers" warning and its two buttons never show.
            hasEnoughServers={
              !needsServers || serverCount >= Math.ceil(selectedCount / 2)
            }
            loadingServers={needsServers && loadingServers}
            canEdit={canEdit}
            saving={saving}
            onTeamsChange={handlers.onTeamsChange}
            onCreateTeam={() => setTeamModalOpen(true)}
            onImportTeams={() => setTeamImportModalOpen(true)}
            onAddServer={() => setServerModalOpen(true)}
            onBatchAddServers={() => setBatchServerModalOpen(true)}
          />
        );

      case 'maps': {
        const customVeto = (
          tournament?.settings?.customVetoOrder as Record<string, unknown> | undefined
        )?.[form.format];
        return (
          <>
            {ContentStep && <ContentStep {...settingsStepProps} />}
            <Field label={t('tournament.setup.maps.vetoTitle')}>
              <Typography
                variant="body2"
                color="text.secondary"
                data-testid="tournament-veto-summary"
              >
                {isShuffle
                  ? t('tournament.setup.maps.vetoShuffle')
                  : customVeto
                    ? t('tournament.setup.maps.vetoCustom', { format: seriesLabel })
                    : requiresVeto(form.type, form.format)
                      ? t('tournament.setup.maps.vetoStandard', { format: seriesLabel })
                      : t('tournament.setup.maps.vetoNone')}
              </Typography>
            </Field>
          </>
        );
      }

      case 'eventPage':
        return tournament ? (
          <EventPageSettingsCard
            key={`event-page-${tournament.id}`}
            variant="embedded"
            settings={tournament.settings}
            saving={saving}
            onSave={props.onSaveEventPage}
          />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {t('tournament.setup.eventPage.draftNote')}
            </Typography>
            <EventPageSettingsCard
              variant="embedded"
              settings={form.eventPage}
              saving={saving}
              onDraftChange={handlers.onEventPageChange}
            />
          </>
        );

      case 'review':
        return (
          <ReviewStep
            tournament={tournament}
            game={game}
            canEdit={canEdit}
            saving={saving}
            starting={props.starting}
            hasChanges={props.hasChanges}
            hasBracket={props.hasBracket}
            registeredPlayerCount={props.registeredPlayerCount}
            form={{
              name: form.name,
              type: form.type,
              format: form.format,
              selectedTeams: form.selectedTeams,
              teamSize: form.shuffleSettings.teamSize,
            }}
            gameReviewRows={gameSummary.review}
            gameReview={GameReview ? <GameReview {...settingsStepProps} /> : null}
            gameSettingsError={
              ContentStep ? gameSettingsError('content', form.gameSettings, settingsCtx, t) : null
            }
            roundCount={gameSettingsRoundCount(form.gameSettings, settingsCtx)}
            teams={props.teams}
            serverCount={serverCount}
            onSave={props.onSave}
            onDiscardChanges={props.onDiscardChanges}
            onDelete={props.onDelete}
            onSaveTemplate={props.onSaveTemplate}
            onEdit={() => goTo(steps.indexOf('basics'))}
            onStart={props.onStart}
            onRegenerate={props.onRegenerate}
            onBulkCreateShuffleMatches={props.onBulkCreateShuffleMatches}
            onPlayersUpdated={props.onPlayersUpdated}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Box data-testid="tournament-setup" sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
          mb: 3,
        }}
      >
        <Typography variant="body2" color="text.secondary" data-testid="tournament-setup-status">
          {tournament
            ? t('tournament.setup.editing')
            : props.draftSaved
              ? `${t('tournament.setup.newTournament')} · ${t('tournament.setup.draftSaved')}`
              : t('tournament.setup.newTournament')}
        </Typography>
        {!tournament && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {props.draftSaved && (
              <Button
                size="small"
                onClick={props.onDiscardDraft}
                data-testid="tournament-discard-draft"
              >
                {t('tournament.setup.discardDraft')}
              </Button>
            )}
            {templates.length > 0 && (
              <>
                <Button
                  size="small"
                  startIcon={<FileTextIcon />}
                  onClick={(e) => setTemplateMenu(e.currentTarget)}
                  aria-haspopup="menu"
                  aria-expanded={templateMenu ? 'true' : undefined}
                  data-testid="tournament-start-from-template"
                >
                  {t('tournament.setup.startFromTemplate')}
                </Button>
                <Menu
                  anchorEl={templateMenu}
                  open={!!templateMenu}
                  onClose={() => setTemplateMenu(null)}
                >
                  {templates.map((template) => (
                    <MenuItem
                      key={template.id}
                      onClick={() => {
                        setTemplateMenu(null);
                        props.onLoadTemplate(template);
                      }}
                      data-testid="tournament-template-option"
                    >
                      {template.name}
                      {template.description && ` - ${template.description}`}
                    </MenuItem>
                  ))}
                </Menu>
              </>
            )}
          </Box>
        )}
      </Box>

      {/* The steps: in the shell's column where the rail was, or inline
          above the form outside the admin shell. */}
      {shellColumn.inShell ? (
        // In a fragment: MUI's prop-types don't count a bare portal as a node.
        <>{shellColumn.column && createPortal(stepColumn, shellColumn.column)}</>
      ) : (
        <Box sx={{ mb: 3 }}>{stepColumn}</Box>
      )}

      <Box
        sx={{
          display: 'grid',
          // The form takes what the rail left; the summary about a quarter.
          gridTemplateColumns: 'minmax(0, 1fr) minmax(17rem, 26%)',
          gap: 4,
          alignItems: 'start',
          [MEDIUM]: { gridTemplateColumns: 'minmax(0, 1fr)', gap: 4 },
        }}
      >

        <Box
          component="form"
          noValidate
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            // Submits from forms inside dialogs bubble here through the portal.
            if (e.target !== e.currentTarget) return;
            if (stepId !== 'review') handleContinue();
          }}
          sx={{ display: 'grid', gap: 4, minWidth: 0 }}
          data-testid={`tournament-setup-question-${stepId}`}
        >
          <div>
            <Typography
              variant="h4"
              component="h1"
              ref={(el: HTMLElement | null) => {
                headingRef.current = el;
              }}
              tabIndex={-1}
              sx={{ outline: 'none' }}
            >
              {t(`tournament.setup.questions.${stepId}.title`)}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {lede}
            </Typography>
          </div>

          {renderStep()}

          {showError && currentError && (
            <Alert severity="error" role="alert" data-testid="tournament-step-error">
              {currentError}
            </Alert>
          )}

          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 1.5,
              flexWrap: 'wrap',
              pt: 3,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Button
              type="button"
              onClick={() => goTo(props.activeStep - 1)}
              disabled={props.activeStep === 0 || saving}
              startIcon={<ArrowLeftIcon />}
              data-testid="tournament-back-button"
            >
              {t('tournament.formSteps.back')}
            </Button>
            {props.activeStep < reviewStepIndex && nextStepId && (
              <Button
                type="submit"
                variant="contained"
                disabled={saving}
                endIcon={<ArrowRightIcon />}
                data-testid="tournament-next-button"
              >
                {t('tournament.setup.continueTo', {
                  step: t(`tournament.setup.steps.${nextStepId}`),
                })}
              </Button>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            position: 'sticky',
            top: BELOW_NAV_STICKY_TOP,
            [MEDIUM]: { position: 'static' },
          }}
        >
          <SetupSummary
            gameName={pickedGame.name}
            gameMark={pickedGame.mark}
            gameIcon={pickedGame.icon}
            name={form.name.trim()}
            rows={summaryRows}
            checklist={checklist}
          />
        </Box>
      </Box>

      <TeamModal
        open={teamModalOpen}
        team={null}
        onClose={() => setTeamModalOpen(false)}
        onSave={(newTeamId) => {
          setTeamModalOpen(false);
          void props.onRefreshTeams();
          // Add the new team to the selection.
          if (newTeamId && !form.selectedTeams.includes(newTeamId)) {
            handlers.onTeamsChange([...form.selectedTeams, newTeamId]);
          }
        }}
      />

      <TeamImportModal
        open={teamImportModalOpen}
        onClose={() => setTeamImportModalOpen(false)}
        onImport={async () => {
          await props.onRefreshTeams();
          setTeamImportModalOpen(false);
        }}
      />

      {AddResourceDialog && (
        <AddResourceDialog
          open={serverModalOpen}
          onClose={() => setServerModalOpen(false)}
          onSaved={async () => {
            await refreshServers();
            setServerModalOpen(false);
          }}
        />
      )}

      {BatchResourceDialog && (
        <BatchResourceDialog
          open={batchServerModalOpen}
          onClose={() => setBatchServerModalOpen(false)}
          onSaved={async () => {
            await refreshServers();
            setBatchServerModalOpen(false);
          }}
        />
      )}
    </Box>
  );
}

/** A labelled group inside a step: bold label, the control, optional help line. */
function Field({
  label,
  labelId,
  help,
  children,
}: {
  label: string;
  labelId?: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5, minWidth: 0 }}>
      <Typography component="span" id={labelId} variant="body2" fontWeight={600}>
        {label}
      </Typography>
      {children}
      {help && (
        <Typography variant="body2" color="text.secondary">
          {help}
        </Typography>
      )}
    </Box>
  );
}
