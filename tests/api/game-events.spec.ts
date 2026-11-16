import { test, expect } from '@playwright/test';
import { emitGameEvent, onGameEvent, type GameEvent } from '../../api/src/services/gameEvents';

/**
 * Game events (services/gameEvents): what add-ons listen to. A listener that
 * throws must not stop the others, and unsubscribing stops delivery.
 *
 * @tag api
 * @tag modules
 */
test.describe('Game events', () => {
  test('reach every listener, survive one that throws, stop on unsubscribe', () => {
    const seen: GameEvent[] = [];
    const offBad = onGameEvent(() => {
      throw new Error('boom');
    });
    const off = onGameEvent((e) => seen.push(e));
    const event = { game: 'cs2', matchId: 'm1', type: 'kill', round: 3, data: { weapon: 'ak47' } };
    emitGameEvent(event);
    expect(seen).toEqual([event]);
    off();
    offBad();
    emitGameEvent(event);
    expect(seen).toHaveLength(1);
  });
});
