import { test, expect } from '@playwright/test';
import { gameMessageText, mapLabel } from '../../api/src/integrations/cs2/fleet/gameMessages';

/**
 * In-game messages from the platform (fleet/gameMessages.ts): the lines
 * players read in chat, short enough for Ready Up's say (190 bytes).
 *
 * @tag api
 */
test.describe('in-game messages', () => {
  test('next map and series lines', () => {
    expect(
      gameMessageText('nextMap', {
        mapNumber: 1,
        winner: 'Alpha',
        score1: 1,
        score2: 0,
        nextNumber: 2,
        nextMap: 'de_nuke',
      })
    ).toBe('Map 1 goes to Alpha. Series 1-0. Next: map 2, Nuke.');
    expect(gameMessageText('seriesOver', { winner: 'Bravo', score1: 1, score2: 2 })).toBe(
      'GG! Bravo wins 1-2. Results and your next match are on the site.'
    );
    expect(gameMessageText('serverBack', { mapNumber: 2, round: 7 })).toContain(
      'map 2, round 7 restored'
    );
  });

  test('map names read like people say them', () => {
    expect(mapLabel('de_dust2')).toBe('Dust2');
    expect(mapLabel('cs_office')).toBe('Office');
    expect(mapLabel('aim_map_usp')).toBe('Map usp');
  });

  test('never longer than say takes', () => {
    const long = 'Ø'.repeat(200);
    const text = gameMessageText('nextMap', {
      mapNumber: 1,
      winner: long,
      score1: 0,
      score2: 0,
      nextNumber: 2,
    });
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(190);
    expect(text.endsWith('…')).toBe(true);
  });
});
