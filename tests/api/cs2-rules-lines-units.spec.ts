import { test, expect } from '@playwright/test';
import { rulesLines } from '../../client/src/integrations/cs2/rules/rulesLines';

/** "How matches are played" (client/src/integrations/cs2/rules/rulesLines.ts). */
test.describe('CS2 rules summary', () => {
  const t = (key: string, v?: Record<string, unknown>) => `${key}${v ? JSON.stringify(v) : ''}`;

  test('wingman, no veto, bots', () => {
    expect(
      rulesLines(t, {
        type: 'single_elimination',
        format: 'bo1',
        teamSize: 2,
        settings: {
          cs2: { mapMode: 'wingman', maxRounds: 16, veto: false, fillTeamsWithBots: true },
        },
      })
    ).toEqual([
      'rules.modeWingman',
      'rules.rounds{"rounds":16,"win":9,"half":8}',
      'rules.overtime{"half":8}',
      'rules.mapsDrawn',
      'rules.bots',
    ]);
  });

  test('5v5 BO3 with veto and two overtimes', () => {
    expect(
      rulesLines(t, {
        type: 'single_elimination',
        format: 'bo3',
        teamSize: 5,
        settings: { cs2: { maxRounds: 24, overtimeMode: 'enabled', overtimeSegments: 2 } },
      })
    ).toEqual([
      'rules.mode{"size":5}',
      'rules.series{"count":3,"win":2}',
      'rules.rounds{"rounds":24,"win":13,"half":12}',
      'rules.overtimeLimited{"half":12,"count":2}',
      'rules.veto',
    ]);
  });
});
