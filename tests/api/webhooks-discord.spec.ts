import { test, expect } from '@playwright/test';
import { discordMessage, isDiscordWebhookUrl } from '../../api/src/services/webhooks/discord';
import { sampleEnvelope } from '../../api/src/services/webhooks/samples';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * Discord webhook endpoints (Vikunja 1842): an endpoint with format
 * 'discord' gets a Discord message with an embed instead of the signed JSON,
 * and never a server password or connect line.
 *
 * @tag api
 */

type Embed = { title: string; description?: string; url?: string; color: number; fields?: Array<{ name: string; value: string }>; footer?: { text: string } };
const embedOf = (msg: Record<string, unknown>) => (msg.embeds as Embed[])[0];

test.describe('Discord webhook format (pure)', () => {
  test('only Discord webhook URLs count as Discord', { tag: ['@api'] }, () => {
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/123456789/abc-DEF_ghi')).toBe(true);
    expect(isDiscordWebhookUrl('https://canary.discord.com/api/webhooks/1/x')).toBe(true);
    expect(isDiscordWebhookUrl('https://discordapp.com/api/v10/webhooks/1/x')).toBe(true);
    expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/x')).toBe(false);
    expect(isDiscordWebhookUrl('https://evil.example/api/webhooks/1/x')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com.evil.example/api/webhooks/1/x')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com/api/channels/1')).toBe(false);
    expect(isDiscordWebhookUrl('not a url')).toBe(false);
  });

  test('admin.called: who, why, server and the match link; nothing secret, nobody pinged', { tag: ['@api'] }, () => {
    const envelope = sampleEnvelope('admin.called', { test: false });
    expect(envelope.data.match.connect).not.toBeNull();
    const msg = discordMessage(envelope, null);
    const embed = embedOf(msg);
    expect(embed.title).toBe(`Admin called: ${envelope.data.match.team1!.name} vs ${envelope.data.match.team2!.name}`);
    expect(embed.description).toContain('my game crashed');
    expect(embed.url).toBe(envelope.data.admin_call!.match_url);
    const text = JSON.stringify(msg);
    expect(text).toContain('Sample Player');
    expect(text).toContain('Sample server #1');
    expect(text).not.toContain(envelope.data.match.connect!.console);
    if (envelope.data.match.connect!.password) expect(text).not.toContain(envelope.data.match.connect!.password);
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(embed.footer).toBeUndefined();
  });

  test('admin.call_resolved and match events get their own embeds', { tag: ['@api'] }, () => {
    const resolved = embedOf(discordMessage(sampleEnvelope('admin.call_resolved'), null));
    expect(resolved.title).toMatch(/^Admin call answered: /);
    expect(resolved.description).toContain('Sample Admin');
    expect(resolved.description).toContain('restarted the round');
    expect(resolved.footer?.text).toMatch(/Test event/);

    const finished = embedOf(discordMessage(sampleEnvelope('match.finished'), 'https://at.example/matches?match=r2m1'));
    expect(finished.title).toMatch(/^Finished: /);
    expect(finished.url).toBe('https://at.example/matches?match=r2m1');
    // A message far longer than Discord allows is cut.
    const long = sampleEnvelope('admin.called');
    long.data.admin_call!.message = 'x'.repeat(5000);
    expect(embedOf(discordMessage(long, null)).description!.length).toBeLessThanOrEqual(2000);
  });
});

test('a Discord endpoint needs a Discord webhook URL', { tag: ['@api'] }, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const bad = await request.post('/api/webhooks', {
    headers: getAuthHeader(),
    data: { url: 'https://example.com/hook', format: 'discord', eventTypes: ['admin.called'] },
  });
  expect(bad.status()).toBe(400);
  expect(await bad.text()).toContain('Discord webhook URL');
  const unknown = await request.post('/api/webhooks', {
    headers: getAuthHeader(),
    data: { url: 'https://example.com/hook', format: 'slack' },
  });
  expect(unknown.status()).toBe(400);
});
