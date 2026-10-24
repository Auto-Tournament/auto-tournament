import { test, expect } from '@playwright/test';
import { execLineError } from '../../api/src/integrations/cs2/routes/fleetCommands';

/**
 * A console command goes to the server as one plain line: a carriage return,
 * NUL or escape sequence in it is refused (routes/fleetCommands.ts).
 *
 * @tag api
 * @tag fleet
 */

test.describe('exec line (no server)', () => {
  test('one plain line passes', () => {
    expect(execLineError('status')).toBeNull();
    expect(execLineError('say hello\tworld')).toBeNull();
  });

  test('empty, multi-line and oversize lines are refused', () => {
    expect(execLineError('  ')).not.toBeNull();
    expect(execLineError('status\nquit')).not.toBeNull();
    expect(execLineError('x'.repeat(513))).not.toBeNull();
  });

  test('control characters are refused', () => {
    for (const line of ['status\rquit', 'status\u0000', 'say \u001b[2J', 'say \u007f']) {
      expect(execLineError(line), JSON.stringify(line)).not.toBeNull();
    }
  });
});
