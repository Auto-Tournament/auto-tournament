import { test, expect } from '@playwright/test';
import {
  EXPERIMENTAL_FEATURES,
  resolveExperimentalFeature,
  type ExperimentalFeature,
} from '../../api/src/services/experimentalFeatures';
import { CORE_SETTINGS } from '../../api/src/services/settingsService';
import { DEFAULT_MODES, MODES, parseEnabledModes } from '../../api/src/services/matchmaking/rules';
import { signInViaRequest } from '../helpers/auth';

/**
 * Experimental features (services/experimentalFeatures): off by default, an
 * admin toggle stored as a setting, an environment override that wins both
 * ways. The list is empty: matchmaking graduated and is always on, with every
 * mode enabled when the admin never chose.
 *
 * The first part is pure; the second runs against the server.
 *
 * @tag api
 * @tag settings
 */

const json = { 'Content-Type': 'application/json' };

// The framework is generic; exercise it with a made-up feature.
const sample: ExperimentalFeature = {
  id: 'sample',
  settingKey: 'experimental_matchmaking',
  env: 'EXPERIMENTAL_SAMPLE',
};

test.describe('experimental features: resolution', () => {
  test('no feature is experimental right now; stored keys stay out of PUT /api/settings', () => {
    expect(EXPERIMENTAL_FEATURES).toHaveLength(0);
    const coreKeys: string[] = CORE_SETTINGS.map((definition) => definition.key);
    for (const feature of EXPERIMENTAL_FEATURES) {
      expect(coreKeys).toContain(feature.settingKey);
      expect(CORE_SETTINGS.find((d) => d.key === feature.settingKey)?.field).toBeUndefined();
    }
  });

  test('off by default', () => {
    expect(resolveExperimentalFeature(sample, null, {})).toMatchObject({
      enabled: false,
      source: 'default',
    });
    expect(resolveExperimentalFeature(sample, '  ', {})).toMatchObject({
      enabled: false,
      source: 'default',
    });
  });

  test('the stored setting decides without an override', () => {
    expect(resolveExperimentalFeature(sample, '1', {})).toMatchObject({
      enabled: true,
      source: 'setting',
    });
    expect(resolveExperimentalFeature(sample, '0', {})).toMatchObject({
      enabled: false,
      source: 'setting',
    });
  });

  test('the environment wins over the setting, both ways', () => {
    expect(
      resolveExperimentalFeature(sample, null, { EXPERIMENTAL_SAMPLE: '1' })
    ).toMatchObject({ enabled: true, source: 'env' });
    expect(
      resolveExperimentalFeature(sample, '1', { EXPERIMENTAL_SAMPLE: '0' })
    ).toMatchObject({ enabled: false, source: 'env' });
    // An empty variable is no override.
    expect(
      resolveExperimentalFeature(sample, '1', { EXPERIMENTAL_SAMPLE: '' })
    ).toMatchObject({ enabled: true, source: 'setting' });
  });

  test('matchmaking modes: every mode is on when the admin never chose', () => {
    expect(MODES).toEqual(['5v5', '2v2', '1v1']);
    expect(DEFAULT_MODES).toEqual(MODES);
    expect(parseEnabledModes(null)).toEqual(MODES);
    expect(parseEnabledModes('["1v1"]')).toEqual(['1v1']);
  });
});

test.describe.serial('experimental features: HTTP', () => {
  test('admin only; the list is empty; nothing to toggle', async ({ request, playwright }) => {
    const anon = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    expect((await anon.get('/api/experimental')).status()).toBe(401);
    expect(
      (await anon.put('/api/experimental/matchmaking', { data: { enabled: true }, headers: json }))
        .status()
    ).toBe(401);
    await anon.dispose();

    expect(await signInViaRequest(request)).toBe(true);
    const list = await (await request.get('/api/experimental')).json();
    expect(list.features).toEqual([]);
    expect(
      (await request.put('/api/experimental/matchmaking', { data: { enabled: true }, headers: json }))
        .status()
    ).toBe(404);
  });

  test('matchmaking needs no setting: status works and lists every mode', async ({ request, playwright }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const res = await request.get('/api/matchmaking/status');
    expect(res.status()).toBe(200);
    const status = await res.json();
    expect(status.enabled).toBe(true);
    expect(status.allModes).toEqual(['5v5', '2v2', '1v1']);
    expect(Array.isArray(status.modes)).toBe(true);
    expect(status.modes.length).toBeGreaterThan(0);
    expect(typeof status.openToPlayers).toBe('boolean');

    const anon = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    expect((await anon.get('/api/matchmaking/status')).status()).toBe(401);
    await anon.dispose();
  });
});
