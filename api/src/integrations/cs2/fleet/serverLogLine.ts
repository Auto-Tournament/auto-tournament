/**
 * One Ready Up event as a line of the admin match page's server log (pure: ./serverLog writes it).
 */

import type { FleetEventData, FleetEventName, MatchState } from './protocol/v1';

export type ServerLogLevel = 'error' | 'warn' | 'info';

/** An event as the log reads it: its type decides its data (a `FleetEventMessage` is one). */
export type ServerLogEvent = {
  [K in FleetEventName]: { type: `event.${K}`; payload: { data: FleetEventData[K] } };
}[FleetEventName];

function nameOf(state: MatchState | null, steamId: string): string {
  return (
    state?.teams?.team1?.players?.[steamId]?.name ??
    state?.teams?.team2?.players?.[steamId]?.name ??
    (steamId || 'a player')
  );
}

/** One event as a log line: its level and a short text. Null for events not worth a line. */
export function serverLogLine(
  event: ServerLogEvent,
  state: MatchState | null,
  mapNumber?: number,
  round?: number
): { level: ServerLogLevel; text: string } | null {
  const where = [mapNumber ? `map ${mapNumber}` : '', round ? `round ${round}` : '']
    .filter(Boolean)
    .join(', ');
  switch (event.type) {
    // Chat lines go to the match's chat (chatBridge.ts), not the log.
    case 'event.round_start':
    case 'event.backup':
    case 'event.chat':
      return null;
    case 'event.error': {
      const d = event.payload.data;
      return { level: 'error', text: `${d.code}: ${d.message}`.trim() };
    }
    case 'event.player_connect':
      return { level: 'info', text: `${nameOf(state, event.payload.data.steamid64)} connected` };
    case 'event.player_disconnect': {
      const d = event.payload.data;
      return {
        level: 'warn',
        text: `${nameOf(state, d.steamid64)} disconnected${d.reason ? ` (${d.reason})` : ''}`,
      };
    }
    case 'event.player_ready':
      return { level: 'info', text: `${nameOf(state, event.payload.data.steamid64)} is ready` };
    case 'event.player_unready':
      return {
        level: 'info',
        text: `${nameOf(state, event.payload.data.steamid64)} is not ready`,
      };
    case 'event.pause': {
      const d = event.payload.data;
      return {
        level: 'warn',
        text: `paused (${d.type})${d.by ? ` by ${d.by}` : ''}${where ? `, ${where}` : ''}`,
      };
    }
    case 'event.forfeit':
      return {
        level: 'warn',
        text: `forfeit: ${JSON.stringify(event.payload.data).slice(0, 160)}`,
      };
    case 'event.phase':
      return {
        level: 'info',
        text: `phase: ${event.payload.data.to}${where ? ` (${where})` : ''}`,
      };
    case 'event.round_end':
      return {
        level: 'info',
        text: `round ${event.payload.data.round.round_number} ended${where ? ` (${where})` : ''}`,
      };
    case 'event.map_result': {
      const d = event.payload.data;
      return { level: 'info', text: `map ${d.map_number} done: ${d.team1_score}–${d.team2_score}` };
    }
    case 'event.series_end': {
      const d = event.payload.data;
      return {
        level: 'info',
        text: `series over: ${d.team1_series_score}–${d.team2_series_score}`,
      };
    }
    case 'event.match_restored':
      return { level: 'warn', text: `restored to ${where || 'a backup'}` };
    case 'event.rounds_voided': {
      const d = event.payload.data;
      return { level: 'warn', text: `rounds from ${d.from_round} voided (${d.reason})` };
    }
    case 'event.admin_called': {
      const d = event.payload.data;
      return {
        level: 'warn',
        text: `${nameOf(state, d.player.steamid64)} called an admin${d.message ? `: “${d.message}”` : ''}`,
      };
    }
    default:
      return { level: 'info', text: event.type.replace(/^event\./, '').replace(/_/g, ' ') };
  }
}
