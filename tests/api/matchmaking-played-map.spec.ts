import { test, expect } from '@playwright/test';
import { mapFromMatch } from '../../api/src/services/matchmaking/mapFromMatch';

/**
 * A vetoed 5v5 lobby never gets mm_lobbies.map from the draw: /play history, the lobby
 * payload and the admin list read the played map off the match instead.
 *
 * @tag api
 * @tag matchmaking
 */
const TAGS = { tag: ['@api', '@matchmaking'] };
const pool = ['de_ancient', 'de_nuke', 'de_mirage'];

test.describe('played map of a matchmaking match', () => {
  test('a finished veto gives the picked map', TAGS, () => {
    const config = JSON.stringify({ vetoDisabled: false, maplist: ['de_nuke'] });
    const veto_state = JSON.stringify({
      status: 'completed',
      pickedMaps: [{ mapName: 'de_nuke', mapNumber: 1 }],
    });
    expect(mapFromMatch({ config, veto_state })).toBe('de_nuke');
    // A match that predates the config rewrite: the veto's pick is enough.
    const old = JSON.stringify({ vetoDisabled: false, maplist: pool });
    expect(mapFromMatch({ config: old, veto_state })).toBe('de_nuke');
  });

  test('a veto still running has no map (the maplist is the whole pool)', TAGS, () => {
    const config = JSON.stringify({ vetoDisabled: false, maplist: pool });
    expect(mapFromMatch({ config, veto_state: null })).toBe('');
    expect(mapFromMatch({ config, veto_state: JSON.stringify({ status: 'in_progress' }) })).toBe(
      ''
    );
  });

  test('a drawn map (2v2, 1v1) is the maplist', TAGS, () => {
    expect(
      mapFromMatch({ config: JSON.stringify({ maplist: ['de_inferno'] }), veto_state: null })
    ).toBe('de_inferno');
  });
});
