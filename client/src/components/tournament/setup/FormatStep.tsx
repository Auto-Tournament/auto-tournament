/**
 * The setup's Format step: the tournament type, the series length, the grand
 * final, groups, how many teams, and the game's own settings (moved out of
 * TournamentSetup.tsx).
 */
import type { ReactNode } from 'react';
import { Alert, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Team } from '../../../types';
import type { GrandFinalMode } from '../../../utils/tournamentMatchCount';
import { FormField } from '../../common/ui';
import { ShuffleTournamentConfigStep } from '../ShuffleTournamentConfigStep';
import { FormatCards } from './FormatCards';
import { GroupsFields } from './GroupsFields';
import { SegmentedControl } from './SegmentedControl';
import { TeamCountStepper } from './TeamCountStepper';
import { teamCountChoices } from './setupSteps';
import type { SetupFormHandlers, SetupFormValues } from './TournamentSetup';

export function FormatStep({
  form,
  handlers,
  locked,
  canEdit,
  saving,
  teams,
  askSeriesLength,
  gameSettings,
}: {
  form: SetupFormValues;
  handlers: SetupFormHandlers;
  locked: boolean;
  canEdit: boolean;
  saving: boolean;
  teams: Team[];
  /** The core asks for the series length unless the game's settings step does. */
  askSeriesLength: boolean;
  /** The game's own settings step, rendered (CS2: rounds and overtime). */
  gameSettings: ReactNode;
}) {
  const { t } = useTranslation();
  const choices = teamCountChoices(form.type);
  const rule =
    choices.length > 0 && choices[choices.length - 1] - choices[0] + 1 !== choices.length;
  return (
    <>
      <FormField label={t('tournament.setup.format.label')}>
        <FormatCards value={form.type} onChange={handlers.onTypeChange} disabled={locked} />
      </FormField>

      {form.type === 'shuffle' ? (
        <>
          <Alert severity="info">{t('tournament.formatStep.shuffleInfo')}</Alert>
          <FormField label={t('tournament.setup.format.shuffleTitle')}>
            <ShuffleTournamentConfigStep
              settings={form.shuffleSettings}
              canEdit={canEdit}
              saving={saving}
              onSettingsChange={handlers.onShuffleSettingsChange}
            />
          </FormField>
        </>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
            gap: 3,
          }}
        >
          {askSeriesLength && (
            <FormField
              label={
                form.type === 'groups'
                  ? t('tournament.setup.groups.groupMatches')
                  : t('tournament.setup.format.seriesLength')
              }
            >
              <SegmentedControl
                label={
                  form.type === 'groups'
                    ? t('tournament.setup.groups.groupMatches')
                    : t('tournament.setup.format.seriesLength')
                }
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
            </FormField>
          )}
          {form.type === 'double_elimination' && (
            <FormField
              label={t('tournament.setup.format.grandFinal')}
              help={t(`tournament.setup.format.grandFinalHelp.${form.grandFinalMode}`)}
            >
              <SegmentedControl<GrandFinalMode>
                label={t('tournament.setup.format.grandFinal')}
                value={form.grandFinalMode}
                onChange={handlers.onGrandFinalModeChange}
                disabled={locked}
                testId="tournament-grand-final-selector"
                // Bracket reset is not implemented yet (it plays as one grand
                // final), so it is only shown for a tournament that has it.
                options={(form.grandFinalMode === 'double'
                  ? (['simple', 'double', 'none'] as const)
                  : (['simple', 'none'] as const)
                ).map((value) => ({
                  value,
                  label: t(`tournament.setup.format.grandFinalOptions.${value}`),
                  testId: `tournament-grand-final-option-${value}`,
                }))}
              />
            </FormField>
          )}
          {form.type === 'groups' && (
            <GroupsFields
              value={form.groups}
              onChange={handlers.onGroupsChange}
              teamCount={
                form.selectedTeams.length >= 2 ? form.selectedTeams.length : form.plannedTeams
              }
              teams={form.selectedTeams
                .map((id) => teams.find((team) => team.id === id))
                .filter((team): team is Team => Boolean(team))}
              disabled={locked}
            />
          )}
          <FormField
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
          </FormField>
        </Box>
      )}

      {gameSettings}
    </>
  );
}
