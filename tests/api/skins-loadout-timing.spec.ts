import { test, expect } from '@playwright/test';
import { waitsForRoundEnd } from '../../api/src/integrations/cs2/fleet/push/skins';

/**
 * A loadout changed on the site reaches a player's server at the end of the
 * round being played, and at once in warmup, knife and between maps: by the
 * map's phase, not the match's status (a match is live from its first map to
 * its last, and a map-2 warmup has no round end to carry the change).
 *
 * @tag api
 */
test('a loadout waits only for a round being played', { tag: ['@api'] }, () => {
  expect(waitsForRoundEnd('live', 'live')).toBe(true);
  expect(waitsForRoundEnd('live', undefined)).toBe(true);
  for (const phase of ['warmup', 'knife', 'map_end', 'veto', 'paused_between_maps']) {
    expect(waitsForRoundEnd('live', phase)).toBe(false);
  }
  expect(waitsForRoundEnd('loaded', 'warmup')).toBe(false);
  expect(waitsForRoundEnd('loaded', null)).toBe(false);
});
