import { emitGameEvent } from '../../../services/gameEvents';
import type { JsonObject } from '../../../utils/json';
import { fleetInbound } from './inbound';

let stop: (() => void) | null = null;

/** Every fleet `event.*` from Ready Up, once, onto the platform's game events (services/gameEvents). */
export function startGameEventFeed(): void {
  if (stop) return;
  stop = fleetInbound.onEvent((notice) => {
    if (notice.patch === 'duplicate') return;
    const p = notice.envelope.payload as {
      match_id: string;
      map_number?: number;
      round?: number;
      data: JsonObject;
    };
    emitGameEvent({
      game: 'cs2',
      matchId: p.match_id,
      type: notice.envelope.type.replace(/^event\./, ''),
      mapNumber: p.map_number,
      round: p.round,
      data: p.data,
    });
  });
}

export function stopGameEventFeed(): void {
  stop?.();
  stop = null;
}
