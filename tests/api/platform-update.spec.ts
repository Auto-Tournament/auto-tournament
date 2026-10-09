import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  checkPlatformUpdate,
  newestRelease,
  resetPlatformUpdateCache,
} from '../../api/src/services/platform/updateCheck';
import { moduleUpdatesFrom } from '../../api/src/services/platform/moduleUpdates';
import type { CatalogItem } from '../../api/src/modules/catalogService';

/** The admin's "update available" (api/src/services/platform/updateCheck.ts). */

const TAGS = { tag: ['@api'] };

const releases = [
  { tag_name: 'v3.0.0-beta.72', html_url: 'https://example.test/b72', prerelease: true },
  { tag_name: 'v3.0.0-beta.71', html_url: 'https://example.test/b71', prerelease: true },
  { tag_name: 'v2.4.15', html_url: 'https://example.test/2415' },
  { tag_name: 'v3.1.0', html_url: 'https://example.test/draft', draft: true },
];

test('a beta sees betas; a stable build only stable releases; drafts never', TAGS, () => {
  expect(newestRelease(releases, '3.0.0-beta.70')?.version).toBe('3.0.0-beta.72');
  expect(newestRelease(releases, '2.4.14')?.version).toBe('2.4.15');
  expect(newestRelease([], '2.4.14')).toBeNull();
});

test('available only when the newest is newer than what runs', TAGS, async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => releases });
  resetPlatformUpdateCache();
  expect(
    await checkPlatformUpdate({ running: '3.0.0-beta.71', fetchImpl, forceRefresh: true })
  ).toMatchObject({
    latest: '3.0.0-beta.72',
    available: true,
    releaseUrl: 'https://example.test/b72',
  });
  expect(
    await checkPlatformUpdate({ running: '3.0.0-beta.72', fetchImpl, forceRefresh: true })
  ).toMatchObject({
    available: false,
  });
  // GitHub down: nothing to say.
  const down = async () => ({ ok: false, status: 503, json: async () => [] });
  expect(
    await checkPlatformUpdate({ running: '3.0.0-beta.71', fetchImpl: down, forceRefresh: true })
  ).toMatchObject({
    latest: null,
    available: false,
  });
});

test('the endpoint is admin-only', TAGS, async ({ request, playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  expect((await anon.get('/api/system/update')).status()).toBe(401);
  await anon.dispose();
  expect(await signInViaRequest(request)).toBe(true);
  const res = await request.get('/api/system/update');
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({
    success: true,
    running: expect.any(String),
    modules: expect.any(Array),
  });
});

const item = (over: Partial<CatalogItem>): CatalogItem => ({
  kind: 'module',
  id: 'cs2',
  name: 'Counter-Strike 2',
  description: null,
  icon: null,
  engine: null,
  state: 'installed',
  reason: null,
  installed: { version: '3.0.0-beta.72', source: 'snapshot', enabled: true },
  available: null,
  restartRequired: false,
  notice: null,
  ...over,
});

test('module updates: an update, one that did not take, and nothing to say', TAGS, () => {
  const updates = moduleUpdatesFrom([
    item({ state: 'update-available', available: { version: '3.0.0-beta.75', from: 'snapshot' } }),
    // cs.sivert.io, 2026-10-09: the update loaded no further and was rolled back.
    item({
      id: 'other',
      name: 'Other',
      state: 'update-available',
      available: { version: '2.0.0', from: 'remote' },
      notice: 'Version 2.0.0 did not load (its migrations did not apply), so 1.0.0 was kept.',
    }),
    item({ id: 'current', name: 'Current' }),
    item({
      id: 'not-installed',
      state: 'available',
      installed: null,
      available: { version: '1.0.0', from: 'remote' },
    }),
  ]);
  expect(updates.map((u) => u.id)).toEqual(['cs2', 'other']);
  expect(updates[0]).toMatchObject({
    installed: '3.0.0-beta.72',
    available: '3.0.0-beta.75',
    problem: null,
  });
  expect(updates[1].problem).toContain('did not load');
});
