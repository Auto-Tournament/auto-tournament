import { test, expect } from '@playwright/test';
import { getAuthHeader } from '../helpers/auth';

/**
 * Add-on modules turn on and off while the platform runs: start() and
 * stop() run at once, and the add-on's own API answers only while it is on.
 * Uses the test-only add-on (addons/testAddon.ts).
 *
 * @tag api
 */
test.describe('Add-on modules', () => {
  test('an add-on turns on and off live', { tag: ['@api'] }, async ({ request }) => {
    const headers = getAuthHeader();
    const state = async () => request.get('/api/addons/test-addon/state', { headers });

    expect((await request.get('/api/addons')).status()).toBe(401);
    const listed = await request.get('/api/addons', { headers });
    const list = await listed.json();
    expect(listed.status(), JSON.stringify(list)).toBe(200);
    expect(list.addons.map((a: { id: string }) => a.id)).toContain('test-addon');

    await request.put('/api/addons/test-addon', { headers, data: { enabled: false } });
    expect((await state()).status()).toBe(404);

    const on = await request.put('/api/addons/test-addon', { headers, data: { enabled: true } });
    expect((await on.json()).addon).toMatchObject({ enabled: true, running: true, error: null });
    const running = await (await state()).json();
    expect(running.starts).toBeGreaterThan(0);

    const off = await request.put('/api/addons/test-addon', { headers, data: { enabled: false } });
    expect((await off.json()).addon).toMatchObject({ enabled: false, running: false });
    expect((await state()).status()).toBe(404);

    // Back on: stop() ran once for each time it was turned off.
    await request.put('/api/addons/test-addon', { headers, data: { enabled: true } });
    const again = await (await state()).json();
    expect(again.starts).toBe(running.starts + 1);
    expect(again.stops).toBe(running.stops + 1);
    await request.put('/api/addons/test-addon', { headers, data: { enabled: false } });

    expect(
      (await request.put('/api/addons/test-addon', { headers, data: { enabled: 'yes' } })).status()
    ).toBe(400);
    expect(
      (await request.put('/api/addons/no-such', { headers, data: { enabled: true } })).status()
    ).toBe(404);
  });
});
