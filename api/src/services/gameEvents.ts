import { EventEmitter } from 'events';
import type { JsonObject } from '../utils/json';
import { log } from '../utils/logger';

/** A match event from a game server, as add-ons see it. `type` is the game's own name (CS2: `kill`, `chat`, ...). */
export interface GameEvent {
  game: string;
  matchId: string;
  type: string;
  mapNumber?: number;
  round?: number;
  /** As the game server sent it, already checked against the game's schema. */
  data: JsonObject;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitGameEvent(event: GameEvent): void {
  bus.emit('event', event);
}

/** Listen to every game event; returns the unsubscribe. A listener that throws is logged, not passed on. */
export function onGameEvent(listener: (event: GameEvent) => void): () => void {
  const safe = (event: GameEvent) => {
    try {
      listener(event);
    } catch (error) {
      log.warn('[GAME EVENTS] a listener threw', { error: (error as Error).message });
    }
  };
  bus.on('event', safe);
  return () => bus.off('event', safe);
}
