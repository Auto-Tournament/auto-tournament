import { test, expect } from '@playwright/test';
import {
  configTeamName,
  hasTbdSide,
  matchNoticeName,
} from '../../api/src/services/matchNoticeName';
import { describeNotice } from '../../client/src/components/social/noticeText';

/**
 * Match notices never say "TBD vs TBD" (services/matchNoticeName.ts): nothing
 * is announced until both teams are known, and stored placeholders are not shown.
 *
 * @tag api
 */
test.describe('Match notice names', () => {
  test('a name needs both teams', () => {
    expect(matchNoticeName('Alpha', 'Bravo')).toBe('Alpha vs Bravo');
    expect(matchNoticeName('Alpha', null)).toBeNull();
    expect(matchNoticeName(null, null)).toBeNull();
    expect(matchNoticeName('Alpha', 'TBD')).toBeNull();
    expect(matchNoticeName('  ', 'Bravo')).toBeNull();
  });

  test('placeholders are found, real names are not', () => {
    expect(hasTbdSide('TBD vs TBD')).toBe(true);
    expect(hasTbdSide('Alpha vs TBD')).toBe(true);
    expect(hasTbdSide('Alpha vs Bravo')).toBe(false);
    expect(hasTbdSide('TBDogs vs Bravo')).toBe(false);
  });

  test('team names come from the stored config', () => {
    const config = JSON.stringify({ team1: { name: 'Red' }, team2: {} });
    expect(configTeamName(config, 'team1')).toBe('Red');
    expect(configTeamName(config, 'team2')).toBeNull();
    expect(configTeamName('not json', 'team1')).toBeNull();
  });

  test('the bell shows no placeholder lead', () => {
    const t = ((k: string) => k) as never;
    const base = { id: 1, kind: 'tournament', createdAt: 0, read: false } as const;
    const tbd = describeNotice(
      { ...base, data: { event: 'match_ready', matchSlug: 'm1', name: 'TBD vs TBD' } } as never,
      t,
      null
    );
    expect(tbd.lead).toBe('');
    const real = describeNotice(
      { ...base, data: { event: 'match_ready', matchSlug: 'm1', name: 'A vs B' } } as never,
      t,
      null
    );
    expect(real.lead).toBe('A vs B');
  });
});
