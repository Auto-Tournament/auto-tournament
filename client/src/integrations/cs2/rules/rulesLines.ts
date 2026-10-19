import type { TournamentRulesViewProps } from '../../types';
import { cs2SettingsOf } from '../setup/cs2TournamentSettings';
import type { Untrusted } from '../../types';

/** Splits a line's bold first sentence from the rest (the view draws it strong). */
export const STRONG_END = '\u0000';

/** The lines, in order: pure, so the view and a test read the same words. */
export function rulesLines(
  t: (key: string, values?: Record<string, Untrusted>) => string,
  tournament: TournamentRulesViewProps['tournament']
): string[] {
  const cs2 = cs2SettingsOf(tournament.settings as Record<string, Untrusted> | undefined);
  const lines: string[] = [];
  const wingman = cs2.mapMode === 'wingman';
  const size = tournament.teamSize ?? (wingman ? 2 : 5);
  lines.push(wingman ? t('rules.modeWingman') : t('rules.mode', { size }));
  const series = tournament.format === 'bo3' ? 3 : tournament.format === 'bo5' ? 5 : 1;
  if (tournament.type !== 'shuffle' && series > 1) {
    lines.push(t('rules.series', { count: series, win: Math.floor(series / 2) + 1 }));
  }
  if (cs2.maxRounds > 0) {
    const half = Math.floor(cs2.maxRounds / 2);
    lines.push(t('rules.rounds', { rounds: cs2.maxRounds, win: half + 1, half }));
    if (cs2.overtimeMode === 'disabled') {
      lines.push(t('rules.noOvertime', { half }));
    } else if (cs2.overtimeSegments && cs2.overtimeSegments > 0) {
      lines.push(t('rules.overtimeLimited', { half, count: cs2.overtimeSegments }));
    } else {
      lines.push(t('rules.overtime', { half }));
    }
  }
  if (tournament.type === 'shuffle') lines.push(t('rules.shuffleMaps'));
  else if (cs2.veto === false) lines.push(t('rules.mapsDrawn'));
  else {
    lines.push(t('rules.veto'));
    // Match times (Manage › Schedule): the veto opens by itself before each match.
    const times = (
      tournament.settings as
        { matchTimes?: { mode?: string; vetoLeadMinutes?: number } } | undefined
    )?.matchTimes;
    if (times?.mode === 'times') {
      const lead = typeof times.vetoLeadMinutes === 'number' ? times.vetoLeadMinutes : 5;
      lines.push(
        lead > 0
          ? `${t('rules.beThere', { count: lead })}${STRONG_END}${t('rules.beThereWhy', { count: lead })}`
          : `${t('rules.beThereOnTime')}${STRONG_END}${t('rules.beThereOnTimeWhy')}`
      );
    }
  }
  if (cs2.fillTeamsWithBots) lines.push(t('rules.bots'));
  return lines;
}
