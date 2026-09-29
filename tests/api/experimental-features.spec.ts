import { test, expect } from '@playwright/test';
import {
  EXPERIMENTAL_FEATURES,
  findExperimentalFeature,
  resolveExperimentalFeature,
} from '../../api/src/services/experimentalFeatures';
import { CORE_SETTINGS } from '../../api/src/services/settingsService';
import { signInViaRequest } from '../helpers/auth';

/**
 * Experimental features (services/experimentalFeatures): off by default, an
 * admin toggle stored as a setting, an environment override that wins both
 * ways. While `matchmaking` is off, /api/matchmaking answers 404 to everyone.
 *
 * The first part is pure; the second runs against the server.
 *
 * @tag api
 * @tag settings
 */

const matchmaking = findExperimentalFeature('matchmaking')!;
const json = { 'Content-Type': 'application/json' };

test.describe('experimental features: resolution', () => {
  test('matchmaking is the first feature, stored under a core setting', () => {
    expect(EXPERIMENTAL_FEATURES[0].id).toBe('matchmaking');
    expect(matchmaking.env).toBe('EXPERIMENTAL_MATCHMAKING');
    const coreKeys: string[] = CORE_SETTINGS.map((definition) => definition.key);
    for (const feature of EXPERIMENTAL_FEATURES) {
      expect(coreKeys).toContain(feature.settingKey);
      // Never settable through PUT /api/settings.
      expect(CORE_SETTINGS.find((d) => d.key === feature.settingKey)?.field).toBeUndefined();
    }
  });

  test('off by default', () => {
    expect(resolveExperimentalFeature(matchmaking, null, {})).toMatchObject({
      enabled: false,
      source: 'default',
    });
    expect(resolveExperimentalFeature(matchmaking, '  ', {})).toMatchObject({
      enabled: false,
      source: 'default',
    });
  });

  test('the stored setting decides without an override', () => {
    expect(resolveExperimentalFeature(matchmaking, '1', {})).toMatchObject({
      enabled: true,
      source: 'setting',
    });
    expect(resolveExperimentalFeature(matchmaking, '0', {})).toMatchObject({
      enabled: false,
      source: 'setting',
    });
  });

  test('the environment wins over the setting, both ways', () => {
    expect(
      resolveExperimentalFeature(matchmaking, null, { EXPERIMENTAL_MATCHMAKING: '1' })
    ).toMatchObject({ enabled: true, source: 'env' });
    expect(
      resolveExperimentalFeature(matchmaking, '0', { EXPERIMENTAL_MATCHMAKING: 'true' })
    ).toMatchObject({ enabled: true, source: 'env' });
    expect(
      resolveExperimentalFeature(matchmaking, '1', { EXPERIMENTAL_MATCHMAKING: '0' })
    ).toMatchObject({ enabled: false, source: 'env' });
    // An empty variable is no override.
    expect(
      resolveExperimentalFeature(matchmaking, '1', { EXPERIMENTAL_MATCHMAKING: '' })
    ).toMatchObject({ enabled: true, source: 'setting' });
  });
});

test.describe.serial('experimental features: HTTP', () => {
  test.skip(
    Boolean(process.env.EXPERIMENTAL_MATCHMAKING),
    'EXPERIMENTAL_MATCHMAKING overrides the toggle in this environment'
  );

  test('admin only', async ({ playwright }) => {
    const anon = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    expect((await anon.get('/api/experimental')).status()).toBe(401);
    expect(
      (await anon.put('/api/experimental/matchmaking', { data: { enabled: true }, headers: json }))
        .status()
    ).toBe(401);
    await anon.dispose();
  });

  test('toggling matchmaking opens and closes /api/matchmaking', async ({ request, playwright }) => {
    expect(await signInViaRequest(request)).toBe(true);

    const off = await request.put('/api/experimental/matchmaking', {
      data: { enabled: false },
      headers: json,
    });
    expect(off.status()).toBe(200);
    expect((await off.json()).feature).toMatchObject({ enabled: false, source: 'setting' });
    expect((await request.get('/api/matchmaking/status')).status()).toBe(404);

    const list = await (await request.get('/api/experimental')).json();
    expect(list.features.map((f: { id: string }) => f.id)).toContain('matchmaking');

    expect(
      (await request.put('/api/experimental/matchmaking', { data: { enabled: 'yes' }, headers: json }))
        .status()
    ).toBe(400);
    expect(
      (await request.put('/api/experimental/nope', { data: { enabled: true }, headers: json }))
        .status()
    ).toBe(404);

    const on = await request.put('/api/experimental/matchmaking', {
      data: { enabled: true },
      headers: json,
    });
    expect((await on.json()).feature).toMatchObject({ enabled: true, source: 'setting' });
    const status = await request.get('/api/matchmaking/status');
    expect(status.status()).toBe(200);
    expect((await status.json()).enabled).toBe(true);

    // On, but still admin only while it is being built.
    const anon = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    expect((await anon.get('/api/matchmaking/status')).status()).toBe(401);
    await anon.dispose();

    await request.put('/api/experimental/matchmaking', { data: { enabled: false }, headers: json });
    expect((await request.get('/api/matchmaking/status')).status()).toBe(404);
  });
});
