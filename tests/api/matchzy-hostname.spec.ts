import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext, configureWebhook } from '../helpers/setup';
import { createTestServer, deleteServer } from '../helpers/servers';

/**
 * Server hostname format.
 *
 * MatchZy overwrites a server's `hostname` on every match load, using
 * `matchzy_hostname_format`. MAT never sent that cvar, so the plugin default
 * ("{TEAM1} vs {TEAM2}") always won and the hostname an operator had set in
 * their own server.cfg was silently replaced with no way to stop it.
 *
 * The setting is now MAT's, and the interesting case is the empty one: the
 * plugin reads `""` as "leave the hostname alone". Every other string setting
 * folds "" to NULL and falls back to its default, which would make that choice
 * impossible to express — so this setting deliberately does not.
 *
 * @tag api
 * @tag matchzy
 * @tag settings
 */

const PLUGIN_DEFAULT = '{TEAM1} vs {TEAM2}';

/** Commands the server would receive on bootstrap. */
async function bootstrapCommands(
  request: APIRequestContext,
  serverId: string
): Promise<string[]> {
  const response = await request.get(`/api/servers/${serverId}/bootstrap`, {
    headers: { 'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123' },
  });
  expect(response.ok(), `bootstrap failed: ${await response.text()}`).toBe(true);
  const body = (await response.json()) as { commands: string[] };
  return body.commands;
}

async function setHostnameFormat(request: APIRequestContext, value: string | null) {
  const response = await request.put('/api/settings', {
    data: { matchzyHostnameFormat: value },
  });
  expect(response.ok(), `settings PUT failed: ${await response.text()}`).toBe(true);
}

async function readHostnameFormat(request: APIRequestContext): Promise<string | undefined> {
  const response = await request.get('/api/settings');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { settings: { matchzyHostnameFormat?: string } };
  return body.settings.matchzyHostnameFormat;
}

test.describe.serial('MatchZy hostname format', () => {
  let serverId: string;

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    // The bootstrap payload embeds the webhook base URL, so it 500s without one.
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);

    const server = await createTestServer(request, 'hostname');
    expect(server).toBeTruthy();
    serverId = server!.id;
  });

  test.afterEach(async ({ request }) => {
    await setHostnameFormat(request, null);
    if (serverId) await deleteServer(request, serverId);
  });

  test(
    'defaults to the plugin format and sends it to the server',
    { tag: ['@api', '@matchzy', '@settings'] },
    async ({ request }) => {
      await setHostnameFormat(request, null);

      expect(await readHostnameFormat(request)).toBe(PLUGIN_DEFAULT);
      expect(await bootstrapCommands(request, serverId)).toContain(
        `matchzy_hostname_format "${PLUGIN_DEFAULT}"`
      );
    }
  );

  test(
    'a configured format reaches the server',
    { tag: ['@api', '@matchzy', '@settings'] },
    async ({ request }) => {
      await setHostnameFormat(request, 'LAN #{MATCH_ID} - {TEAM1} vs {TEAM2}');

      expect(await readHostnameFormat(request)).toBe('LAN #{MATCH_ID} - {TEAM1} vs {TEAM2}');
      expect(await bootstrapCommands(request, serverId)).toContain(
        'matchzy_hostname_format "LAN #{MATCH_ID} - {TEAM1} vs {TEAM2}"'
      );
    }
  );

  test(
    'an empty format survives the round trip and tells the server to keep its own hostname',
    { tag: ['@api', '@matchzy', '@settings'] },
    async ({ request }) => {
      await setHostnameFormat(request, '');

      // The interesting assertion: "" must not come back as the default. If it
      // did, an operator could never stop MatchZy renaming their server.
      expect(await readHostnameFormat(request)).toBe('');
      expect(await bootstrapCommands(request, serverId)).toContain(
        'matchzy_hostname_format ""'
      );
    }
  );

  test(
    'strips quotes that would break the RCON command',
    { tag: ['@api', '@matchzy', '@settings'] },
    async ({ request }) => {
      await setHostnameFormat(request, 'My "LAN" server');

      // An embedded quote would close the argument early and leave the server
      // with a malformed command rather than the intended hostname.
      expect(await readHostnameFormat(request)).toBe('My LAN server');
      expect(await bootstrapCommands(request, serverId)).toContain(
        'matchzy_hostname_format "My LAN server"'
      );
    }
  );

  test(
    'clearing the setting with null restores the default',
    { tag: ['@api', '@matchzy', '@settings'] },
    async ({ request }) => {
      await setHostnameFormat(request, '');
      expect(await readHostnameFormat(request)).toBe('');

      await setHostnameFormat(request, null);

      expect(await readHostnameFormat(request)).toBe(PLUGIN_DEFAULT);
      expect(await bootstrapCommands(request, serverId)).toContain(
        `matchzy_hostname_format "${PLUGIN_DEFAULT}"`
      );
    }
  );
});
