import { test, expect } from '@playwright/test';
import { waitsForTournamentStart } from '../../api/src/utils/tournamentStarted';
import { tournamentAction, tournamentWhen } from '../../client/src/utils/tournamentSummary';
import type { TournamentSummary } from '../../client/src/hooks/useTournamentList';
import { matchLines, rulesLines } from '../../client/src/integrations/cs2/rules/rulesLines';

/**
 * What Manage and the player pages disagreed on (cs.sivert.io, 2026-11-07). Pure.
 */
test.describe('a bracket match waits for its tournament to start', () => {
  const match = { tournament_id: 12, round: 1 };

  test('setup or ready: waits (no veto yet)', () => {
    expect(waitsForTournamentStart({ ...match, tournamentStatus: 'setup' })).toBe(true);
    expect(waitsForTournamentStart({ ...match, tournamentStatus: 'ready' })).toBe(true);
  });

  test('started or over: does not wait', () => {
    expect(waitsForTournamentStart({ ...match, tournamentStatus: 'in_progress' })).toBe(false);
    expect(waitsForTournamentStart({ ...match, tournamentStatus: 'completed' })).toBe(false);
  });

  test('a manual match (round 0) or matchmaking (no tournament) never waits', () => {
    expect(
      waitsForTournamentStart({ tournament_id: 12, round: 0, tournamentStatus: 'setup' })
    ).toBe(false);
    expect(
      waitsForTournamentStart({ tournament_id: null, round: 1, tournamentStatus: 'setup' })
    ).toBe(false);
  });
});

test.describe('Browse: Sign up only while sign-up is open', () => {
  const base: TournamentSummary = {
    id: 13,
    name: 'Fjord Wingman Weekend',
    status: 'setup',
    type: 'double_elimination',
    format: 'bo1',
    teamCount: 0,
    isLive: false,
  };

  test('open now: Sign up', () => {
    expect(tournamentAction({ ...base, signupOpenNow: true })).toMatchObject({
      key: 'signUp',
      primary: true,
    });
  });

  test('switched on but closed, or off: View', () => {
    expect(
      tournamentAction({ ...base, registrationOpen: true, signupOpenNow: false })
    ).toMatchObject({ key: 'view', primary: false });
    expect(tournamentAction({ ...base, signupOpenNow: false })).toMatchObject({ key: 'view' });
  });

  test('live and finished keep their actions', () => {
    expect(tournamentAction({ ...base, isLive: true, status: 'in_progress' }).key).toBe('watch');
    expect(tournamentAction({ ...base, status: 'completed' }).key).toBe('results');
  });
});

test.describe("the Overview's rules line keeps overtime", () => {
  const t = (key: string) => key;
  const bo3 = {
    id: 12,
    type: 'round_robin',
    format: 'bo3',
    teamSize: 5,
    settings: { cs2: { maxRounds: 24 } },
  } as unknown as Parameters<typeof matchLines>[1];

  test('Bo3: size, series, rounds and overtime (the cut at 3 dropped overtime)', () => {
    const lines = matchLines(t, bo3);
    expect(lines).toContain('rules.series');
    expect(lines.some((l) => l.startsWith('rules.overtime') || l === 'rules.noOvertime')).toBe(
      true
    );
    expect(lines).not.toContain('rules.veto');
  });

  test('the Rules tab still gets every line, in the same order', () => {
    const all = rulesLines(t, bo3);
    expect(all.slice(0, matchLines(t, bo3).length)).toEqual(matchLines(t, bo3));
    expect(all).toContain('rules.veto');
  });
});

test.describe('a cancelled tournament is over, not coming up', () => {
  const cancelled: TournamentSummary = {
    id: 31,
    name: 'Ready Up HUD test',
    status: 'cancelled',
    type: 'single_elimination',
    format: 'bo1',
    teamCount: 2,
    isLive: false,
    startsAt: Date.parse('2026-10-27T13:37:00.000Z'),
  };

  test('Browse: View, never Sign up (it said "Starts Tue 27 Oct" before)', () => {
    expect(tournamentAction(cancelled)).toMatchObject({ key: 'view', primary: false });
    expect(tournamentAction({ ...cancelled, signupOpenNow: true }).key).toBe('view');
  });

  test('its "when" says cancelled, not a start in the past', () => {
    const t = ((key: string) => key) as unknown as Parameters<typeof tournamentWhen>[0];
    expect(tournamentWhen(t, cancelled, 'en')).toEqual({
      kind: 'text',
      muted: true,
      text: 'overviewPage.status.cancelled',
    });
  });
});
