import { test, expect } from '@playwright/test';
import { standInsOf } from '../../api/src/integrations/cs2/demos/standIns';

/**
 * Simulated matches: the roster's SteamIDs and names go to the demo worker and
 * the recorder, which take each bot playing under a roster name as that player.
 *
 * @tag api
 */
test('a simulated match lists its roster; a real one none', () => {
  const config = {
    simulation: true,
    team1: { name: 'A', players: { '76561198000000001': 'Ada' } },
    team2: { name: 'B', players: { '76561198000000002': 'Bea', bot: 'x' } },
  };
  expect(standInsOf(config)).toEqual({ '76561198000000001': 'Ada', '76561198000000002': 'Bea' });
  expect(standInsOf({ ...config, simulation: false })).toBeNull();
  expect(standInsOf({ simulation: true, team1: { players: {} } })).toBeNull();
  expect(standInsOf(null)).toBeNull();
});
