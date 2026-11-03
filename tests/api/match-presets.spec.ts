import { test, expect } from '@playwright/test';
import { presetIdOf, presetSettingsOf } from '../../api/src/integrations/cs2/matchPresets';

test('a preset keeps only match settings, each checked', { tag: ['@api'] }, () => {
  const ok = presetSettingsOf({
    esportsMode: true,
    knifeRound: false,
    tacticalTimeouts: 3,
    autoStartMinutes: 10,
    connectVia: 'lan',
    maps: ['de_mirage'],
    name: 'not a setting',
  });
  expect(ok.error).toBeUndefined();
  expect(ok.settings).toEqual({
    esportsMode: true,
    knifeRound: false,
    tacticalTimeouts: 3,
    autoStartMinutes: 10,
    connectVia: 'lan',
  });
  expect(presetSettingsOf({ knifeRound: 'yes' }).error).toMatch(/knifeRound/);
  expect(presetSettingsOf({ maxRounds: 99 }).error).toMatch(/maxRounds/);
  expect(presetSettingsOf({ connectVia: 'moon' }).error).toMatch(/connectVia/);
  expect(presetSettingsOf('x').error).toBeDefined();
  expect(presetIdOf('LAN night!')).toBe('lan-night');
  expect(presetIdOf('***')).toBe('');
});
