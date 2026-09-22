import { test, expect } from '@playwright/test';
import {
  getMatchZyBootstrapCommands,
  getMatchZyLoadMatchCommand,
  redactLoadMatchCommand,
} from '../../api/src/integrations/cs2/utils/matchzyRconCommands';

/**
 * Order of the RCON commands that hand a server its bootstrap URL.
 *
 * The plugin fetches the bootstrap URL the moment `matchzy_bootstrap_url` is
 * set, using whatever token it has persisted then, and does not refetch when
 * the token changes. A server last configured by another MAT instance therefore
 * fetched with the old token, got a 401, and stayed unconfigured. Fake test
 * servers short-circuit RCON, so the order is checked on the command list the
 * initialization service sends.
 *
 * @tag api
 */
test.describe('MatchZy bootstrap commands', () => {
  const commands = getMatchZyBootstrapCommands('http://mat.example:3069', 's_1', 'new-token');
  const indexOf = (prefix: string) => commands.findIndex((cmd) => cmd.startsWith(prefix));

  test('sets the token before the URL, and the URL last', () => {
    const tokenIndex = indexOf('matchzy_bootstrap_token ');
    const urlIndex = indexOf('matchzy_bootstrap_url ');

    expect(tokenIndex).toBeGreaterThanOrEqual(0);
    expect(urlIndex).toBeGreaterThan(tokenIndex);
    // Nothing after the URL: it is the command that triggers the fetch.
    expect(urlIndex).toBe(commands.length - 1);
  });

  test('clears the event queue and sets the server id before the fetch', () => {
    expect(commands[0]).toBe('matchzy_clear_event_queue');
    expect(indexOf('matchzy_server_id ')).toBeLessThan(indexOf('matchzy_bootstrap_url '));
  });

  test('points at this server with this token', () => {
    expect(commands).toContain('matchzy_server_id "s_1"');
    expect(commands).toContain('matchzy_bootstrap_token "new-token"');
    expect(commands).toContain(
      'matchzy_bootstrap_url "http://mat.example:3069/api/servers/s_1/bootstrap"'
    );
  });
});

/**
 * The load command authenticates the config fetch: MatchZy takes a header name
 * and value after the URL and adds them to its request. The config endpoint
 * refuses a fetch without it.
 *
 * @tag api
 */
test.describe('MatchZy load command', () => {
  const url = 'http://mat.example:3069/api/matches/r1m1.json?server_id=s_1&match_id=7';

  test('passes the server token as a header on the same line', () => {
    expect(getMatchZyLoadMatchCommand(url, 'tok-123')).toBe(
      `matchzy_loadmatch_url "${url}" "X-MatchZy-Token" "tok-123"`
    );
  });

  test('falls back to the bare command when there is no token', () => {
    expect(getMatchZyLoadMatchCommand(url, '')).toBe(`matchzy_loadmatch_url "${url}"`);
    expect(getMatchZyLoadMatchCommand(url, undefined)).toBe(`matchzy_loadmatch_url "${url}"`);
  });

  test('hides the token when the command is logged or returned', () => {
    const redacted = redactLoadMatchCommand(getMatchZyLoadMatchCommand(url, 'tok-123'));
    expect(redacted).toBe(`matchzy_loadmatch_url "${url}" "X-MatchZy-Token" "REDACTED"`);
    expect(redacted).not.toContain('tok-123');
    expect(redactLoadMatchCommand(`matchzy_loadmatch_url "${url}"`)).toBe(
      `matchzy_loadmatch_url "${url}"`
    );
  });
});
