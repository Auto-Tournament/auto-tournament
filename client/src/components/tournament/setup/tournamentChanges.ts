import type { TFunction } from 'i18next';
import type { Tournament as TournamentRecord } from '../../../types/tournament.types';
import type { TournamentSetupContext } from '../../../integrations/types';
import type { Untrusted } from '../../../utils/untrusted';
import { seriesLabel, typeLabel } from '../../../utils/tournamentSummary';
import { DEFAULT_ELO_TEMPLATE_ID } from './EloTemplateSelect';
import { gameSettingsChanges } from './gameSettings';
import type { SetupFormValues } from './TournamentSetup';
import { grandFinalModeOf } from './tournamentForm';

interface TournamentChange {
  field: string;
  label?: string;
  oldValue?: string | string[];
  newValue?: string | string[];
}

/** One line of the "confirm these changes" dialog. */
export interface ChangeItem {
  field: string;
  label: string;
  oldValue: string | string[];
  newValue: string | string[];
}

/** What saving `form` would change on the saved `tournament`, for the confirm dialog. */
export function tournamentChanges(
  tournament: TournamentRecord,
  form: SetupFormValues,
  savedGameSettings: Record<string, Untrusted>,
  teams: Array<{ id: string; name: string }>,
  settingsCtx: TournamentSetupContext,
  eloTemplateName: (id: string) => string,
  t: TFunction
): ChangeItem[] {
  const { name, type, format, selectedTeams, grandFinalMode, eloTemplateId } = form;
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
      oldValue: typeLabel(t, tournament.type),
      newValue: typeLabel(t, type),
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
      oldValue: seriesLabel(tournament.format),
      newValue: seriesLabel(format),
    });
  }
  if (
    JSON.stringify([...selectedTeams].sort()) !== JSON.stringify([...tournament.teamIds].sort())
  ) {
    const oldTeams = teams.filter((tm) => tournament.teamIds.includes(tm.id)).map((tm) => tm.name);
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
  for (const change of gameSettingsChanges(savedGameSettings, form.gameSettings, settingsCtx, t)) {
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

  return detectedChanges.flatMap(({ field, label, oldValue, newValue }) =>
    label && oldValue !== undefined && newValue !== undefined
      ? [{ field, label, oldValue, newValue }]
      : []
  );
}
