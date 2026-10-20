/**
 * The setup's Teams step: shuffle self sign-up and players, or sign-up
 * settings, the saved tournament's teams and picking teams (moved out of
 * TournamentSetup.tsx).
 */
import { Alert, Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Team } from '../../../types';
import { SwitchRow } from '../../common/ui';
import { TeamSelectionStep } from '../TeamSelectionStep';
import { ShufflePlayerRegistration } from '../ShufflePlayerRegistration';
import { ShuffleTournamentStats } from '../ShuffleTournamentStats';
import { SignupSettings } from './SignupSettings';
import { TournamentTeamsList } from './TournamentTeamsList';
import type { SetupFormHandlers, SetupFormValues, SetupTournament } from './TournamentSetup';
import type { useSetupSignup } from './useSetupData';

const SIGNUP_SWITCH_INPUT: Record<string, string> = { 'data-testid': 'shuffle-signup-open' };

export function TeamsStep({
  tournament,
  form,
  handlers,
  locked,
  canEdit,
  saving,
  teams,
  registeredPlayerCount,
  onPlayersUpdated,
  onRefreshTeams,
  signupState,
  servers,
  onCreateTeam,
  onImportTeams,
  onAddServer,
  onBatchAddServers,
}: {
  tournament: SetupTournament | null;
  form: SetupFormValues;
  handlers: SetupFormHandlers;
  locked: boolean;
  canEdit: boolean;
  saving: boolean;
  teams: Team[];
  registeredPlayerCount?: number;
  onPlayersUpdated: () => void;
  onRefreshTeams: () => void | Promise<void>;
  /** The saved tournament's sign-up and team changes (useSetupSignup). */
  signupState: ReturnType<typeof useSetupSignup>;
  servers: { needed: boolean; count: number; loading: boolean };
  onCreateTeam: () => void;
  onImportTeams: () => void;
  onAddServer?: () => void;
  onBatchAddServers?: () => void;
}) {
  const { t } = useTranslation();
  const {
    signup,
    savedSignup,
    savingSignup,
    saveSignup,
    shuffleSignupOpen,
    setShuffleSignup,
    changingTeams,
    changeTeams,
  } = signupState;
  const selectedCount = form.selectedTeams.length;
  const needsServers = servers.needed;
  const serverCount = servers.count;
  const loadingServers = servers.loading;
  if (form.type === 'shuffle') {
    const selfSignup = (
      <SwitchRow
        label={
          <Box>
            <Typography>{t('tournament.setup.teams.shuffleSelfSignup')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('tournament.setup.teams.shuffleSelfSignupHelp')}
            </Typography>
          </Box>
        }
        checked={tournament ? shuffleSignupOpen : form.signup.registrationOpen}
        onChange={(e) => void setShuffleSignup(e.target.checked)}
        disabled={locked}
        inputProps={SIGNUP_SWITCH_INPUT}
      />
    );
    if (!tournament) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {selfSignup}
          <Alert severity="info" data-testid="shuffle-signup-after-create">
            {t('tournament.setup.teams.shuffleBeforeCreate')}
          </Alert>
        </Box>
      );
    }
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {selfSignup}
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
            onPlayersUpdated={onPlayersUpdated}
          />
          <ShuffleTournamentStats
            playerCount={registeredPlayerCount || 0}
            teamSize={tournament.teamSize || 5}
          />
        </Box>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <SignupSettings
        value={signup}
        onChange={tournament ? savedSignup.setValue : handlers.onSignupChange}
        disabled={locked}
        {...(tournament
          ? {
              onSave: () => void saveSignup(),
              dirty: savedSignup.dirty,
              saving: savingSignup,
            }
          : {})}
      />
      {tournament && (
        <TournamentTeamsList
          tournamentId={tournament.id}
          teamSize={tournament.teamSize ?? signup.teamSize}
          teamKey={form.selectedTeams.join(',')}
          canEdit={canEdit}
          live={tournament.settings?.registrationOpen === true}
          onRemoved={onRefreshTeams}
        />
      )}
      <Typography variant="subtitle2">
        {signup.registrationOpen
          ? t('tournament.setup.signup.addYourself')
          : t('tournament.setup.signup.pickTeams')}
      </Typography>
      <TeamSelectionStep
        teams={teams}
        selectedTeams={form.selectedTeams}
        type={form.type}
        serverCount={serverCount}
        requiredServers={Math.ceil(selectedCount / 2)}
        // A game with no servers has nothing to run short of, so the
        // "not enough servers" warning and its two buttons never show.
        hasEnoughServers={!needsServers || serverCount >= Math.ceil(selectedCount / 2)}
        loadingServers={needsServers && loadingServers}
        canEdit={canEdit}
        saving={saving || changingTeams}
        onTeamsChange={(next) => void changeTeams(next)}
        onCreateTeam={onCreateTeam}
        onImportTeams={onImportTeams}
        onAddServer={onAddServer}
        onBatchAddServers={onBatchAddServers}
      />
    </Box>
  );
}
