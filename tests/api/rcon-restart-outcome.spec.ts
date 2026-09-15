import { test, expect } from '@playwright/test';
import { isLostReplyError, isServerRestartCommand } from '../../api/src/utils/rconRestartOutcome';

/**
 * Outcome of a `css_restart` sent over RCON.
 *
 * "Reset to Setup" ends active matches with `css_restart`. The server restarts
 * before it answers, so the reply never arrives and the client times out — and
 * MAT logged `Failed to end match on server s_3` for a server that had in fact
 * restarted and gone idle. CI has no CS2 server (fake servers short-circuit
 * RCON), so the classification is checked on the error strings the RCON client
 * (dathost-rcon-client) produces.
 *
 * @tag api
 * @tag regression
 */
test.describe('RCON restart command outcome', () => {
  const lostReply = 'Rcon command "css_restart" to 192.168.50.196:27035 timed out after 5000ms';

  test('treats css_restart as a server restart command', () => {
    expect(isServerRestartCommand('css_restart')).toBe(true);
    expect(isServerRestartCommand('  CSS_RESTART ')).toBe(true);
    expect(isServerRestartCommand('css_endmatch')).toBe(false);
    expect(isServerRestartCommand('mp_restartgame 1')).toBe(false);
    expect(isServerRestartCommand('status')).toBe(false);
  });

  test('a reply timeout after sending is a lost reply, not a failure', () => {
    expect(isLostReplyError(lostReply)).toBe(true);
  });

  test('errors before the command was sent stay failures', () => {
    const neverSent = [
      'Rcon connect to 192.168.50.196:27035 timed out after 5000ms',
      'Rcon connection to 192.168.50.196:27035 unexpectedly ended',
      'connect ECONNREFUSED 192.168.50.196:27035',
      'read ECONNRESET',
      'getaddrinfo ENOTFOUND cs2.example',
      'Authentication error',
      'RCON operation timeout (10s)',
      "Server 's_3' not found",
      'Server is disabled',
    ];

    for (const error of neverSent) {
      expect(isLostReplyError(error), error).toBe(false);
    }
    expect(isLostReplyError(undefined)).toBe(false);
  });
});
