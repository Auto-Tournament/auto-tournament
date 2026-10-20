import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Notifications outside the site (Account → Notifications): a player's
 * switch per event and channel, defaults "your own matches only", and why a
 * channel cannot reach them. The admin's Discord bot token is checked and
 * never read back.
 *
 * @tag api
 * @tag notifications
 */
test(
  'a player sets where they get notified; the bot token is admin-only',
  { tag: ['@api'] },
  async ({ request, playwright }) => {
    const player = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      const steamId = `7656119805${String(Date.now()).slice(-7)}`;
      expect(await signInAsPlayerViaRequest(player, steamId, 'Notify Player')).toBe(true);

      const prefs = await (await player.get('/api/social/notifications/channels')).json();
      // Defaults: your own matches on, the rest off.
      expect(prefs.events.match_ready).toEqual({ discord: true, email: true, push: true });
      expect(prefs.events.veto_turn).toEqual({ discord: true, email: true, push: true });
      expect(prefs.events.checkin_open).toEqual({ discord: false, email: false, push: false });
      // No Discord linked / no email: each says why.
      expect(prefs.channels.discord.available).toBe(false);
      expect(['no_bot', 'no_discord']).toContain(prefs.channels.discord.reason);
      expect(prefs.channels.email.available).toBe(false);
      expect(['email_off', 'no_email']).toContain(prefs.channels.email.reason);

      const put = (data: Record<string, unknown>) =>
        player.put('/api/social/notifications/channels', { data });
      const on = await put({ event: 'checkin_open', channel: 'discord', on: true });
      expect(on.ok(), await on.text()).toBe(true);
      expect((await on.json()).events.checkin_open.discord).toBe(true);
      const off = await put({ event: 'match_ready', channel: 'email', on: false });
      expect((await off.json()).events.match_ready.email).toBe(false);
      // Saved, not just echoed.
      const again = await (await player.get('/api/social/notifications/channels')).json();
      expect(again.events.checkin_open.discord).toBe(true);
      expect(again.events.match_ready.email).toBe(false);

      expect((await put({ event: 'nope', channel: 'email', on: true })).status()).toBe(400);
      expect((await put({ event: 'veto_turn', channel: 'sms', on: true })).status()).toBe(400);
      expect((await put({ event: 'veto_turn', channel: 'email', on: 'yes' })).status()).toBe(400);

      // The bot (the Discord add-on): admins only; a bad token is refused; clearing works.
      expect(await signInViaRequest(request)).toBe(true);
      await request.put('/api/addons/discord', { data: { enabled: true } });
      expect([401, 403]).toContain((await player.get('/api/addons/discord')).status());
      const status = await (await request.get('/api/addons/discord')).json();
      expect(status).toMatchObject({ success: true });
      expect(JSON.stringify(status)).not.toMatch(/token/i);
      const bad = await request.put('/api/addons/discord/token', {
        data: { token: 'not-a-token' },
      });
      expect([400, 502]).toContain(bad.status());
      // The bot's Discord server: only one the bot is in; null clears it.
      expect(Array.isArray(status.guilds)).toBe(true);
      const notIn = await request.put('/api/addons/discord/guild', {
        data: { guildId: '123456789012345678' },
      });
      expect(notIn.status()).toBe(400);
      const cleared = await request.put('/api/addons/discord/guild', {
        data: { guildId: null },
      });
      expect((await cleared.json()).guildId).toBeNull();
      // Team voice channels: on and off; a category must be one of the server's.
      const voiceOn = await request.put('/api/addons/discord/match-voice', {
        data: { enabled: true },
      });
      expect((await voiceOn.json()).matchVoice.enabled).toBe(true);
      const badCategory = await request.put('/api/addons/discord/match-voice', {
        data: { categoryId: '123456789012345678' },
      });
      expect(badCategory.status()).toBe(400);
      const voiceOff = await request.put('/api/addons/discord/match-voice', {
        data: { enabled: false },
      });
      expect((await voiceOff.json()).matchVoice).toEqual({ enabled: false, categoryId: null });
      // An API token alone (no session) cannot set it.
      const bare = await playwright.request.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
      });
      try {
        const viaToken = await bare.put('/api/addons/discord/token', {
          headers: getAuthHeader(),
          data: { token: null },
        });
        expect([401, 403]).toContain(viaToken.status());
      } finally {
        await bare.dispose();
      }
    } finally {
      await player.dispose();
    }
  }
);
