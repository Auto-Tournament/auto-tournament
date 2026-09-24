import { test, expect } from '@playwright/test';
import {
  getPluginBootstrapCommands,
  getPluginLoadMatchCommand,
  redactLoadMatchCommand,
} from '../../api/src/integrations/cs2/utils/pluginRconCommands';

/**
 * Order of the RCON commands that hand a server its bootstrap URL.
 *
 * The plugin fetches the bootstrap URL the moment `at_bootstrap_url` is
 * set, using whatever token it has persisted then, and does not refetch when
 * the token changes. A server last configured by another MAT instance therefore
 * fetched with the old token, got a 401, and stayed unconfigured. Fake test
 * servers short-circuit RCON, so the order is checked on the command list the
 * initialization service sends.
 *
 * @tag api
 */
test.describe('Auto Tournament CS2 bootstrap commands', () => {
  const commands = getPluginBootstrapCommands('http://mat.example:3069', 's_1', 'new-token');
  const indexOf = (prefix: string) => commands.findIndex((cmd) => cmd.startsWith(prefix));

  test('sets the token before the URL, and the URL last', () => {
    const tokenIndex = indexOf('at_bootstrap_token ');
    const urlIndex = indexOf('at_bootstrap_url ');

    expect(tokenIndex).toBeGreaterThanOrEqual(0);
    expect(urlIndex).toBeGreaterThan(tokenIndex);
    // Nothing after the URL: it is the command that triggers the fetch.
    expect(urlIndex).toBe(commands.length - 1);
  });

  test('clears the event queue and sets the server id before the fetch', () => {
    expect(commands[0]).toBe('at_clear_event_queue');
    expect(indexOf('at_server_id ')).toBeLessThan(indexOf('at_bootstrap_url '));
  });

  test('points at this server with this token', () => {
    expect(commands).toContain('at_server_id "s_1"');
    expect(commands).toContain('at_bootstrap_token "new-token"');
    expect(commands).toContain(
      'at_bootstrap_url "http://mat.example:3069/api/servers/s_1/bootstrap"'
    );
  });
});

/**
 * The load command authenticates the config fetch: Auto Tournament CS2 takes a header name
 * and value after the URL and adds them to its request. The config endpoint
 * refuses a fetch without it.
 *
 * @tag api
 */
test.describe('Auto Tournament CS2 load command', () => {
  const url = 'http://mat.example:3069/api/matches/r1m1.json?server_id=s_1&match_id=7';

  test('passes the server token as a header on the same line', () => {
    expect(getPluginLoadMatchCommand(url, 'tok-123')).toBe(
      `at_loadmatch_url "${url}" "X-Auto-Tournament-Token" "tok-123"`
    );
  });

  test('falls back to the bare command when there is no token', () => {
    expect(getPluginLoadMatchCommand(url, '')).toBe(`at_loadmatch_url "${url}"`);
    expect(getPluginLoadMatchCommand(url, undefined)).toBe(`at_loadmatch_url "${url}"`);
  });

  test('hides the token when the command is logged or returned', () => {
    const redacted = redactLoadMatchCommand(getPluginLoadMatchCommand(url, 'tok-123'));
    expect(redacted).toBe(`at_loadmatch_url "${url}" "X-Auto-Tournament-Token" "REDACTED"`);
    expect(redacted).not.toContain('tok-123');
    expect(redactLoadMatchCommand(`at_loadmatch_url "${url}"`)).toBe(
      `at_loadmatch_url "${url}"`
    );
  });
});
