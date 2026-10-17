import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Players choosing their own display name: the `playersChooseName` setting,
 * `/api/me/name`, the prompt flag on `/api/auth/me`, and admins' override.
 */

function uniqueSteamId(): string {
  return `7656119${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

async function setChooseName(request: APIRequestContext, on: boolean) {
  await signInViaRequest(request);
  const res = await request.put('/api/settings', { data: { playersChooseName: on } });
  expect(res.ok(), `PUT /api/settings: ${await res.text()}`).toBe(true);
  expect(((await res.json()) as { settings: { playersChooseName: boolean } }).settings).toEqual(
    expect.objectContaining({ playersChooseName: on })
  );
}

async function player(playwright: Playwright, baseURL: string | undefined, name: string) {
  const ctx = await playwright.request.newContext({ baseURL });
  const steamId = uniqueSteamId();
  const res = await ctx.post('/api/test/login-player', { data: { steamId, name } });
  expect(res.ok(), `login-player: ${await res.text()}`).toBe(true);
  return { ctx, steamId };
}

async function authMe(ctx: APIRequestContext) {
  return (await (await ctx.get('/api/auth/me')).json()) as { namePrompt?: boolean };
}

test.describe.serial('Player display name', () => {
  test.afterAll(async ({ request }) => {
    await setChooseName(request, false);
  });

  test('off (default): no prompt, and the player cannot change it', async ({
    request,
    playwright,
    baseURL,
  }) => {
    await setChooseName(request, false);
    const { ctx } = await player(playwright, baseURL, 'Simpert');

    const mine = await (await ctx.get('/api/me/name')).json();
    expect(mine).toEqual(
      expect.objectContaining({ name: 'Simpert', enabled: false, showPrompt: false })
    );
    expect((await authMe(ctx)).namePrompt).toBe(false);

    const put = await ctx.put('/api/me/name', { data: { name: 'Sivert G.' } });
    expect(put.status()).toBe(403);
    expect((await (await ctx.get('/api/me/name')).json()).name).toBe('Simpert');
    await ctx.dispose();
  });

  test('anonymous: 401', async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get('/api/me/name')).status()).toBe(401);
    expect((await anon.put('/api/me/name', { data: { name: 'Anon' } })).status()).toBe(401);
    await anon.dispose();
  });

  test('on: prompt until confirmed, validation, once a day', async ({
    request,
    playwright,
    baseURL,
  }) => {
    await setChooseName(request, true);
    const { ctx } = await player(playwright, baseURL, 'Simpert');

    expect((await authMe(ctx)).namePrompt).toBe(true);
    expect(await (await ctx.get('/api/me/name')).json()).toEqual(
      expect.objectContaining({ name: 'Simpert', enabled: true, showPrompt: true })
    );

    // Validation: length after trimming, control/colour characters, quotes and < >.
    for (const bad of ['', ' a ', 'x'.repeat(33), 'Si\u0002vert', 'Si"vert', '<b>Sivert', 42]) {
      const res = await ctx.put('/api/me/name', { data: { name: bad } });
      expect(res.status(), `name ${JSON.stringify(bad)}`).toBe(400);
    }
    expect((await authMe(ctx)).namePrompt).toBe(true);

    // Confirming the same name ends the prompt and does not start the day's wait.
    const confirm = await ctx.put('/api/me/name', { data: { name: ' Simpert ' } });
    expect(confirm.ok(), await confirm.text()).toBe(true);
    expect(await confirm.json()).toEqual(
      expect.objectContaining({ name: 'Simpert', showPrompt: false, nextChangeAt: null })
    );
    expect((await authMe(ctx)).namePrompt).toBe(false);

    // A change, trimmed; then the next one waits a day.
    const changed = await ctx.put('/api/me/name', { data: { name: '  Sivert   G. ' } });
    expect(changed.ok(), await changed.text()).toBe(true);
    const body = (await changed.json()) as { name: string; nextChangeAt: number | null };
    expect(body.name).toBe('Sivert G.');
    expect(body.nextChangeAt).toBeGreaterThan(Date.now() / 1000 + 23 * 3600);

    expect((await ctx.put('/api/me/name', { data: { name: 'Another' } })).status()).toBe(429);
    // The same name is still fine (a confirm, not a change).
    expect((await ctx.put('/api/me/name', { data: { name: 'Sivert G.' } })).ok()).toBe(true);
    await ctx.dispose();
  });

  test('admins can always rename, and imports keep a chosen name', async ({
    request,
    playwright,
    baseURL,
  }) => {
    await setChooseName(request, true);
    const { ctx, steamId } = await player(playwright, baseURL, 'Simpert');
    expect((await ctx.put('/api/me/name', { data: { name: 'Sivert G.' } })).ok()).toBe(true);

    // An import does not overwrite a name the player chose.
    await signInViaRequest(request);
    const imported = await request.post('/api/players/bulk-import', {
      data: [{ id: steamId, name: 'Imported Name' }],
    });
    expect(imported.ok(), await imported.text()).toBe(true);
    expect((await (await ctx.get('/api/me/name')).json()).name).toBe('Sivert G.');

    // An admin renames them, even inside the player's day-long wait.
    const edit = await request.put(`/api/players/${steamId}`, { data: { name: 'Admin Set' } });
    expect(edit.ok(), await edit.text()).toBe(true);
    expect((await (await ctx.get('/api/me/name')).json()).name).toBe('Admin Set');

    // And with the setting off too.
    await setChooseName(request, false);
    const edit2 = await request.put(`/api/players/${steamId}`, { data: { name: 'Admin Again' } });
    expect(edit2.ok(), await edit2.text()).toBe(true);
    expect((await (await ctx.get('/api/me/name')).json()).name).toBe('Admin Again');
    await ctx.dispose();
  });
});
