import { test, expect } from '@playwright/test';
import { signupState, type SignupStateInput } from '../../client/src/utils/signupState';

/**
 * Where sign-up stands for a viewer without a sign-up (client/src/utils/signupState.ts).
 * The overview hero and the sign-up tab both read it, so each state here is one thing a
 * player sees. Pure. cs.sivert.io 2026-11-07: a closed tournament said "open" on one page
 * and showed the whole sign-up form on the other.
 */
const now = Date.parse('2026-11-07T20:00:00.000Z');
const iso = (hoursFromNow: number) => new Date(now + hoursFromNow * 3600_000).toISOString();
const input = (over: Partial<SignupStateInput> = {}): SignupStateInput => ({
  window: {
    registrationOpen: true,
    registrationOpensAt: null,
    registrationClosesAt: iso(48),
    checkInClosesAt: null,
    maxTeams: null,
  },
  status: 'setup',
  teamCount: 3,
  teamIn: false,
  now,
  ...over,
});
const win = (over: Partial<NonNullable<SignupStateInput['window']>>) => ({
  ...input().window!,
  ...over,
});

test.describe('signupState', () => {
  test('open: switched on, inside its window, room left', () => {
    expect(signupState(input())).toMatchObject({ kind: 'open', left: null });
    expect(signupState(input({ window: win({ maxTeams: 8 }) }))).toMatchObject({
      kind: 'open',
      left: 5,
    });
    expect(signupState(input({ window: win({ registrationClosesAt: null }) })).kind).toBe('open');
  });

  test('full: open, every spot taken', () => {
    expect(signupState(input({ window: win({ maxTeams: 3 }) }))).toMatchObject({
      kind: 'full',
      left: 0,
    });
  });

  test('ended: the deadline passed (Fjord, Midnight Sun)', () => {
    const closed = iso(-25);
    expect(signupState(input({ window: win({ registrationClosesAt: closed }) }))).toMatchObject({
      kind: 'ended',
      closedAt: Date.parse(closed),
    });
  });

  test('ended: check-in closed, even with no sign-up deadline', () => {
    const checkIn = iso(-1);
    expect(
      signupState(input({ window: win({ registrationClosesAt: null, checkInClosesAt: checkIn }) }))
    ).toMatchObject({ kind: 'ended', closedAt: Date.parse(checkIn) });
  });

  test('ended: the bracket is set (status ready), no time to show', () => {
    expect(signupState(input({ status: 'ready' }))).toMatchObject({
      kind: 'ended',
      closedAt: null,
    });
  });

  test('notYet: before its opening time', () => {
    const opens = iso(5);
    expect(signupState(input({ window: win({ registrationOpensAt: opens }) }))).toMatchObject({
      kind: 'notYet',
      opensAt: Date.parse(opens),
    });
  });

  test('a passed deadline wins over a later opening time', () => {
    expect(
      signupState(
        input({ window: win({ registrationOpensAt: iso(5), registrationClosesAt: iso(-1) }) })
      ).kind
    ).toBe('ended');
  });

  test('off: switched off, the organizer adds the teams', () => {
    expect(signupState(input({ window: win({ registrationOpen: false }) })).kind).toBe('off');
    expect(signupState(input({ window: null })).kind).toBe('off');
  });

  test("teamIn: the viewer's team is in, whatever the window says", () => {
    for (const w of [
      win({}),
      win({ registrationOpen: false }),
      win({ registrationClosesAt: iso(-1) }),
    ])
      expect(signupState(input({ window: w, teamIn: true })).kind).toBe('teamIn');
  });
});
