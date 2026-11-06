import { test, expect } from '@playwright/test';

/** `/api/me/language`: the site language a player uses, which Ready Up gets per player. */

function uniqueSteamId(): string {
  return `7656119${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

test('a player saves their site language; junk and anonymous calls are refused', async ({
  playwright,
  baseURL,
}) => {
  const anon = await playwright.request.newContext({ baseURL });
  expect((await anon.put('/api/me/language', { data: { language: 'nb' } })).status()).toBe(401);
  await anon.dispose();

  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/test/login-player', {
    data: { steamId: uniqueSteamId(), name: 'Language tester' },
  });
  expect(login.ok(), `login-player: ${await login.text()}`).toBe(true);

  for (const language of ['nb', 'pt-BR', 'es-419', 'zh-CN']) {
    const res = await ctx.put('/api/me/language', { data: { language } });
    expect(res.ok(), `${language}: ${await res.text()}`).toBe(true);
    expect(await res.json()).toEqual({ success: true, language });
  }
  for (const language of ['', 'norwegian', 'nb_NO', '<script>', 42]) {
    expect((await ctx.put('/api/me/language', { data: { language } })).status()).toBe(400);
  }
  await ctx.dispose();
});
