import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { mapEntryOf, setupIdOf, setupOf } from '../../api/src/integrations/cs2/serverSetups';

/**
 * Saved setups (Servers › Setups): a plugin set and a map pool an admin starts on any free
 * server. Checked on their own, then saved, listed, replaced and removed over the API.
 *
 * @tag api
 */

test('map entries: names, Workshop ids and links', { tag: ['@api'] }, () => {
  expect(mapEntryOf('de_mirage')).toBe('de_mirage');
  expect(mapEntryOf(' surf_utopia_v3 ')).toBe('surf_utopia_v3');
  expect(mapEntryOf('3070212801')).toBe('workshop/3070212801');
  expect(mapEntryOf('ws:3070212801')).toBe('workshop/3070212801');
  expect(mapEntryOf('workshop/3070212801/surf_kitsune')).toBe('workshop/3070212801/surf_kitsune');
  expect(
    mapEntryOf('https://steamcommunity.com/sharedfiles/filedetails/?id=3070212801&searchtext=')
  ).toBe('workshop/3070212801');
  expect(mapEntryOf('de dust2')).toBeNull();
  expect(mapEntryOf('de_dust2; quit')).toBeNull();
  expect(mapEntryOf('https://example.com/?id=3070212801')).toBeNull();
  expect(mapEntryOf(42)).toBeNull();
});

test('a setup: name, plugin set and maps, each checked', { tag: ['@api'] }, () => {
  const ok = setupOf({
    name: 'Surf',
    plugins: { preset: 'movement' },
    maps: ['surf_utopia_v3', '3070212801', 'surf_utopia_v3'],
  });
  expect(ok.error).toBeUndefined();
  expect(ok.setup?.maps).toEqual(['surf_utopia_v3', 'workshop/3070212801']);
  expect(ok.setup?.plugins.plugins).toContain('movement');
  expect(ok.setup?.plugins.plugins).toContain('fleet');
  expect(setupOf({ name: '', plugins: { preset: 'fun' }, maps: ['de_dust2'] }).error).toMatch(
    /name/
  );
  expect(setupOf({ name: 'X', plugins: { preset: 'nope' }, maps: ['de_dust2'] }).error).toMatch(
    /preset/
  );
  expect(
    setupOf({ name: 'X', plugins: { preset: 'custom', plugins: ['rcon'] }, maps: ['de_dust2'] })
      .error
  ).toMatch(/rcon/);
  expect(setupOf({ name: 'X', plugins: { preset: 'fun' }, maps: [] }).error).toMatch(/maps/);
  expect(setupOf({ name: 'X', plugins: { preset: 'fun' }, maps: ['a b'] }).error).toMatch(/maps/);
  expect(setupIdOf('Aim deathmatch!')).toBe('aim-deathmatch');
});

test('save, list, replace and remove a setup', { tag: ['@api'] }, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const name = `Setup ${Date.now().toString(36)}`;
  const id = setupIdOf(name);
  try {
    const bad = await request.put('/api/game/cs2/setups', {
      data: { name, plugins: { preset: 'fun' }, maps: [] },
    });
    expect(bad.status()).toBe(400);

    const saved = await request.put('/api/game/cs2/setups', {
      data: { name, plugins: { preset: 'practice' }, maps: ['de_mirage'] },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    expect(((await saved.json()) as { setup: { id: string } }).setup.id).toBe(id);

    const again = await request.put('/api/game/cs2/setups', {
      data: { name, plugins: { preset: 'custom', plugins: ['deathmatch'] }, maps: ['de_dust2'] },
    });
    expect(again.ok()).toBe(true);
    const list = (await (await request.get('/api/game/cs2/setups')).json()) as {
      setups: Array<{ id: string; maps: string[]; plugins: { preset: string; plugins: string[] } }>;
    };
    const mine = list.setups.filter((s) => s.id === id);
    expect(mine).toHaveLength(1);
    expect(mine[0].maps).toEqual(['de_dust2']);
    expect(mine[0].plugins.preset).toBe('custom');
    expect(mine[0].plugins.plugins).toContain('deathmatch');
  } finally {
    expect((await request.delete(`/api/game/cs2/setups/${id}`)).ok()).toBe(true);
  }
  expect((await request.delete(`/api/game/cs2/setups/${id}`)).status()).toBe(404);
});

test('setups are for admins only', { tag: ['@api'] }, async ({ playwright }) => {
  const anon = await playwright.request.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
  });
  try {
    expect((await anon.get('/api/game/cs2/setups')).status()).toBe(401);
    const put = await anon.put('/api/game/cs2/setups', {
      data: { name: 'X', plugins: { preset: 'fun' }, maps: ['de_dust2'] },
    });
    expect(put.status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});
