import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  connectionTestCommands,
  connectionTestServerIds,
} from '../../api/src/integrations/cs2/utils/connectionTest';
import { computeTeamStanding, globalMatchNumbers } from '../../api/src/utils/teamPage';

/**
 * QA pass on admin and player pages (MAT 2.4.10).
 *
 * "Test connection" repointed a live server's `matchzy_remote_log_url` at a
 * `test_<host>_<port>` address and left it there, then polled for the test
 * event under that id while the plugin reported its real id — a false
 * "server cannot reach the API". The team page ranked a team among every team
 * in the database and numbered its history by per-round match number.
 *
 * CI has no CS2 server, so the command list and the pure helpers are checked.
 *
 * @tag api
 * @tag regression
 */
test.describe('Connection test does not change server config', () => {
  test('sends only convar reads and the test-event trigger', () => {
    const commands = connectionTestCommands();
    expect(commands).toContain('css_te');
    for (const command of commands) {
      // A convar write carries a value after the name; reads and css_te do not.
      expect(command.trim().split(/\s+/)).toHaveLength(1);
    }
  });

  test('route no longer sends webhook configuration commands', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../api/src/integrations/cs2/routes/rcon.ts'),
      'utf8'
    );
    expect(source).not.toContain('getMatchZyWebhookCommands');
    expect(source).not.toMatch(/test_\$\{host/);
  });

  test('watches for the test event under the real server ids', () => {
    expect(connectionTestServerIds('s_1', 's_1', ' s_1 ')).toEqual(['s_1']);
    expect(connectionTestServerIds(undefined, null, 's_2')).toEqual(['s_2']);
    expect(connectionTestServerIds('', undefined, null)).toEqual([]);
  });
});

test.describe('Team page standing and numbering', () => {
  const tournamentTeams = ['a', 'b', 'c', 'd'];
  const wins = new Map([
    ['a', 1],
    ['b', 3],
    ['outsider', 9],
    ['c', 2],
  ]);

  test('ranks only teams in the tournament', () => {
    expect(computeTeamStanding('a', tournamentTeams, wins)).toEqual({
      position: 3,
      totalTeams: 4,
      wins: 1,
    });
    expect(computeTeamStanding('outsider', tournamentTeams, wins)).toBeNull();
  });

  test('uses the Swiss standings order when given', () => {
    const swiss = [
      { teamId: 'c', wins: 2 },
      { teamId: 'outsider', wins: 2 },
      { teamId: 'a', wins: 1 },
    ];
    expect(computeTeamStanding('a', tournamentTeams, wins, swiss)).toEqual({
      position: 2,
      totalTeams: 2,
      wins: 1,
    });
  });

  test('numbers history chronologically, not per round', () => {
    const numbers = globalMatchNumbers([
      { id: 3, slug: 'r2m1', round: 2, match_number: 1 },
      { id: 1, slug: 'r1m1', round: 1, match_number: 1 },
      { id: 2, slug: 'r1m2', round: 1, match_number: 2 },
    ]);
    expect(numbers.get('r1m1')).toBe(1);
    expect(numbers.get('r1m2')).toBe(2);
    expect(numbers.get('r2m1')).toBe(3);
  });
});
