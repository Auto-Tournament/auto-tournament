import type { Tournament as TournamentRecord } from '../../../types/tournament.types';
import type { EventPageFields } from '../EventPageSettingsCard';
import { DEFAULT_GROUPS, groupsFormOf } from './GroupsFields';
import { DEFAULT_MATCH_TIMES, matchTimesFormOf } from './ScheduleStep';
import { DEFAULT_SIGNUP } from './SignupSettings';
import type { SetupFormValues } from './TournamentSetup';
import { nearestTeamCount } from './setupSteps';
import { DEFAULT_SETUP_GAME } from './games';
import { gameSettingsFor, moduleKeysOf } from './gameSettings';
import { DEFAULT_ELO_TEMPLATE_ID } from './EloTemplateSelect';

export type GrandFinalMode = 'none' | 'simple' | 'double';

/** sessionStorage key for a new tournament's form (drafts are per browser tab). */
export const STORAGE_KEY = 'tournament_form_draft';
/** Step key the old wizard used; cleared with the draft. */
export const LEGACY_STEP_STORAGE_KEY = 'tournament_form_step';

export const EMPTY_EVENT_PAGE: EventPageFields = {
  description: '',
  location: '',
  organizer: '',
  rulebookUrl: '',
  rules: [],
  prizes: [],
  schedule: [],
};

export const DEFAULT_FORM: SetupFormValues = {
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
  signup: DEFAULT_SIGNUP,
  groups: DEFAULT_GROUPS,
  matchTimes: DEFAULT_MATCH_TIMES,
};

export const isEventPageEmpty = (fields: EventPageFields) =>
  JSON.stringify(fields) === JSON.stringify(EMPTY_EVENT_PAGE);

/** Grand final mode stored in a tournament's settings ('simple' when unset). */
export const grandFinalModeOf = (
  tournament: Pick<TournamentRecord, 'settings'> | null
): GrandFinalMode => {
  const stored = (tournament?.settings as { grandFinalMode?: string } | undefined)?.grandFinalMode;
  return stored === 'none' || stored === 'double' ? stored : 'simple';
};

/**
 * The same without the teams and (outside shuffle) the players per team,
 * which change on the Teams step without the rest of the form.
 */
export const restKeyOf = (tournament: TournamentRecord) =>
  formKeyOf({
    ...tournament,
    teamIds: [],
    teamSize: tournament.type === 'shuffle' ? tournament.teamSize : undefined,
  });

/** The fields of a saved tournament the setup form edits, for "did the server copy change?". */
export const formKeyOf = (tournament: TournamentRecord) =>
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
    tournament.type === 'groups' ? groupsFormOf(tournament.settings) : null,
    matchTimesFormOf(tournament.settings),
    tournament.game ?? null,
    // The game module's own settings (CS2: map pool and round rules).
    moduleKeysOf(tournament.settings),
  ]);

/** Form values for a saved tournament. */
export const formFromTournament = (tournament: TournamentRecord): SetupFormValues => {
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
    groups: groupsFormOf(tournament.settings),
    matchTimes: matchTimesFormOf(tournament.settings),
  };
};
