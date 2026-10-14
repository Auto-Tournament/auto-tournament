/**
 * What the platform does to a match, told in game (Ready Up `say`): the next
 * map and the series score, the end of the series, a pause or restore done
 * from the site, a server brought back after a crash, skins switched on or
 * off, a player's loadout updated. Chat with the server's prefix, and the
 * center panel for the big ones. Fire and forget: a message never holds up
 * what it reports, and a server that is gone simply misses it.
 */
import { log } from '../../../utils/logger';
import { fleetInbound, type FleetCommandResultNotice, type FleetEventNotice } from './inbound';
import { sendReliable } from './reliable';
import type { FleetEventData } from './protocol/v1';

export type GameMessageKey =
  | 'nextMap'
  | 'seriesOver'
  | 'paused'
  | 'unpaused'
  | 'roundRestored'
  | 'starting'
  | 'matchEnded'
  | 'serverBack'
  | 'skinsOn'
  | 'skinsOff'
  | 'loadoutUpdated'
  | 'nextMatchReady'
  | 'nextMatchSoon';

type Params = Record<string, string | number | null | undefined>;

const p = (params: Params, key: string, fallback = '') => {
  const v = params[key];
  return v === null || v === undefined || v === '' ? fallback : String(v);
};

/** "de_nuke" reads as "Nuke". */
export function mapLabel(map: string): string {
  const name = map.replace(/^[a-z]+_/, '').replace(/_/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const TEXT: Record<GameMessageKey, (params: Params) => string> = {
  nextMap: (x) =>
    `Map ${p(x, 'mapNumber')} goes to ${p(x, 'winner', 'nobody')}. Series ${p(x, 'score1', '0')}-${p(x, 'score2', '0')}. Next: map ${p(x, 'nextNumber')}${x.nextMap ? `, ${mapLabel(String(x.nextMap))}` : ''}.`,
  seriesOver: (x) =>
    `GG! ${p(x, 'winner', 'Nobody')} wins ${p(x, 'score1', '0')}-${p(x, 'score2', '0')}. Results and your next match are on the site.`,
  paused: () => 'The match is paused from the site.',
  unpaused: () => 'The match is unpaused.',
  roundRestored: () => 'An earlier round is restored. Get ready.',
  starting: () => 'The match is starting.',
  matchEnded: () => 'The match was ended from the site.',
  serverBack: (x) =>
    `The server went down and is back: map ${p(x, 'mapNumber', '1')}, round ${p(x, 'round', '1')} restored. Rejoin if you dropped.`,
  skinsOn: () => 'Skins are on: your loadout from the site is applied.',
  skinsOff: () => 'Skins are off for this match.',
  loadoutUpdated: () => 'Your loadout is updated.',
  nextMatchSoon: (x) =>
    `Next: ${p(x, 'name', 'your next match')}. The map veto opens in ${p(x, 'minutes', 'a few')} min at ${p(x, 'url', 'the site')}`,
  nextMatchReady: (x) =>
    `Your next match is ready: ${p(x, 'name', 'next match')}. The map veto is open at ${p(x, 'url', 'the site')}`,
};

/** Which messages also take the center panel, and for how long (seconds). */
const CENTER: Partial<Record<GameMessageKey, number>> = {
  nextMap: 8,
  seriesOver: 8,
  serverBack: 10,
  roundRestored: 5,
  nextMatchReady: 10,
  nextMatchSoon: 8,
};

/** The line for a message, at most 190 bytes (what Ready Up's say takes). */
export function gameMessageText(key: GameMessageKey, params: Params = {}): string {
  let text = TEXT[key](params);
  while (Buffer.byteLength(text, 'utf8') > 190) text = `${text.slice(0, -2)}…`;
  return text;
}

/** Say it on a fleet server: to everyone, or to one player (`to`, SteamID64). */
/** Lines nobody may miss: the player's next match. */
const IMPORTANT = new Set<GameMessageKey>(['nextMatchReady', 'nextMatchSoon']);

export async function sayInGame(
  fleetServerId: string,
  key: GameMessageKey,
  params: Params = {},
  options: { to?: string } = {}
): Promise<void> {
  try {
    const center = CENTER[key];
    await sendReliable(fleetServerId, {
      type: 'cmd',
      payload: {
        name: 'say',
        args: {
          text: gameMessageText(key, params),
          ...(options.to ? { to: options.to } : {}),
          ...(center ? { center_seconds: center } : {}),
          // Ready Up beta.36+: gold, three times (a line nobody may miss); older ones ignore it.
          ...(IMPORTANT.has(key) ? { important: true } : {}),
        },
        issued_by: { user_id: 'platform', name: 'Auto Tournament', root: false },
        expires_at: Date.now() + 60_000,
      },
    });
  } catch (error) {
    log.debug('[FLEET] in-game message not sent', {
      fleetServerId,
      key,
      error: (error as Error).message,
    });
  }
}

const teamName = (data: { winner: string; team1_name?: string; team2_name?: string }) =>
  data.winner === 'team1'
    ? (data.team1_name ?? 'Team 1')
    : data.winner === 'team2'
      ? (data.team2_name ?? 'Team 2')
      : null;

function onEvent(notice: FleetEventNotice): void {
  if (notice.patch === 'stale_epoch') return;
  const { envelope, record, serverId } = notice;
  if (envelope.type === 'event.map_result') {
    const data = (envelope.payload as { data: FleetEventData['map_result'] }).data;
    const series = record?.state?.series;
    const next = (data.map_number ?? 0) + 1;
    // The last map's result is followed by series_end, which says it all.
    if (!series || next > series.num_maps) return;
    const s1 = data.team1_series_score;
    const s2 = data.team2_series_score;
    const needed = Math.floor(series.num_maps / 2) + 1;
    if (s1 >= needed || s2 >= needed) return;
    void sayInGame(serverId, 'nextMap', {
      mapNumber: data.map_number,
      winner: teamName(data),
      score1: s1,
      score2: s2,
      nextNumber: next,
      nextMap: series.maps?.[String(next)]?.name ?? null,
    });
  }
  if (envelope.type === 'event.series_end') {
    const data = (envelope.payload as { data: FleetEventData['series_end'] }).data;
    void sayInGame(serverId, 'seriesOver', {
      winner: teamName(data),
      score1: data.team1_series_score,
      score2: data.team2_series_score,
    });
  }
}

const COMMAND_MESSAGES: Record<string, GameMessageKey> = {
  pause: 'paused',
  unpause: 'unpaused',
  restore_round: 'roundRestored',
  restart_round: 'roundRestored',
  start: 'starting',
  force_ready: 'starting',
  end_match: 'matchEnded',
  end: 'matchEnded',
};

function onCommand(notice: FleetCommandResultNotice): void {
  const command = notice.command;
  if (!command || command.type !== 'cmd' || notice.result.status !== 'ok' || !command.name) return;
  const key = COMMAND_MESSAGES[command.name];
  if (key) void sayInGame(notice.serverId, key);
}

let stops: Array<() => void> = [];

export function startGameMessages(): void {
  if (stops.length) return;
  stops = [fleetInbound.onEvent(onEvent), fleetInbound.onCommandResult(onCommand)];
}

export function stopGameMessages(): void {
  stops.forEach((stop) => stop());
  stops = [];
}
