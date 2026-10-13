/**
 * One Ready Up event as a line of the admin match page's server log (pure: ./serverLog writes it).
 */

import type { MatchState } from './protocol/v1';

export type ServerLogLevel = 'error' | 'warn' | 'info';

const QUIET = new Set(['event.round_start', 'event.backup']);

function nameOf(state: MatchState | null, sid: unknown): string {
  const id = typeof sid === 'string' ? sid : '';
  return (
    state?.teams?.team1?.players?.[id]?.name ??
    state?.teams?.team2?.players?.[id]?.name ??
    (id || 'a player')
  );
}

/** One event as a log line: its level and a short text. Null for events not worth a line. */
export function serverLogLine(
  type: string,
  data: Record<string, unknown> | undefined,
  state: MatchState | null,
  mapNumber?: number,
  round?: number
): { level: ServerLogLevel; text: string } | null {
  if (QUIET.has(type)) return null;
  const d = data ?? {};
  const who = () => nameOf(state, d.steamid64);
  const where = [mapNumber ? `map ${mapNumber}` : '', round ? `round ${round}` : '']
    .filter(Boolean)
    .join(', ');
  switch (type) {
    case 'event.error':
      return {
        level: 'error',
        text: `${String(d.code ?? 'error')}: ${String(d.message ?? '')}`.trim(),
      };
    case 'event.player_connect':
      return { level: 'info', text: `${who()} connected` };
    case 'event.player_disconnect':
      return {
        level: 'warn',
        text: `${who()} disconnected${d.reason ? ` (${String(d.reason)})` : ''}`,
      };
    case 'event.player_ready':
      return { level: 'info', text: `${who()} is ready` };
    case 'event.player_unready':
      return { level: 'info', text: `${who()} is not ready` };
    case 'event.pause':
      return {
        level: 'warn',
        text: `paused (${String(d.type ?? 'pause')})${d.by ? ` by ${String(d.by)}` : ''}${where ? `, ${where}` : ''}`,
      };
    case 'event.forfeit':
      return { level: 'warn', text: `forfeit: ${JSON.stringify(d).slice(0, 160)}` };
    case 'event.phase':
      return {
        level: 'info',
        text: `phase: ${String(d.phase ?? d.to ?? '')}${where ? ` (${where})` : ''}`,
      };
    case 'event.round_end':
      return {
        level: 'info',
        text: `round ${String((d.round as { round_number?: unknown })?.round_number ?? round ?? '')} ended${where ? ` (${where})` : ''}`,
      };
    case 'event.map_result':
      return {
        level: 'info',
        text: `map ${String(d.map_number ?? mapNumber ?? '')} done: ${String(d.team1_score ?? '?')}–${String(d.team2_score ?? '?')}`,
      };
    case 'event.series_end':
      return {
        level: 'info',
        text: `series over: ${String(d.team1_series_score ?? '?')}–${String(d.team2_series_score ?? '?')}`,
      };
    case 'event.match_restored':
      return { level: 'warn', text: `restored to ${where || 'a backup'}` };
    case 'event.rounds_voided':
      return {
        level: 'warn',
        text: `rounds from ${String(d.from_round ?? '?')} voided (${String(d.reason ?? '')})`,
      };
    case 'event.admin_called':
      return {
        level: 'warn',
        text: `${who()} called an admin${d.message ? `: “${String(d.message)}”` : ''}`,
      };
    default:
      return { level: 'info', text: type.replace(/^event\./, '').replace(/_/g, ' ') };
  }
}
