import type { TournamentRulesViewProps } from '../../types';
import { cs2SettingsOf } from '../setup/cs2TournamentSettings';

/** The lines, in order: pure, so the view and a test read the same words. */
export function rulesLines(
  t: (key: string, values?: Record<string, unknown>) => string,
  tournament: TournamentRulesViewProps['tournament']
): string[] {
  const cs2 = cs2SettingsOf(tournament.settings as Record<string, unknown> | undefined);
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
  else lines.push(t('rules.veto'));
  if (cs2.fillTeamsWithBots) lines.push(t('rules.bots'));
  return lines;
}
