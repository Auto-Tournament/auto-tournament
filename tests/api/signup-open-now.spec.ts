import { test, expect } from '@playwright/test';
import { signupOpenNow } from '../../client/src/utils/signupOpen';
import {
  signupOpenNow as serverSignupOpenNow,
  windowOfSettings,
} from '../../api/src/services/tournamentSignupService';

/** When the tournament page offers sign-up (client/src/utils/signupOpen.ts). Pure. */
test('sign-up stays open through check-in, until it closes or the start', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 10, 14, 18, m)).toISOString();
  const now = Date.parse(t(40));
  const base = { registrationOpen: true, registrationClosesAt: null, checkInClosesAt: t(59) };
  expect(signupOpenNow(base, now)).toBe(true);
  expect(signupOpenNow({ ...base, registrationOpen: false }, now)).toBe(false);
  expect(signupOpenNow({ ...base, registrationOpensAt: t(50) }, now)).toBe(false);
  expect(signupOpenNow({ ...base, registrationClosesAt: t(30) }, now)).toBe(false);
  expect(signupOpenNow({ ...base, checkInClosesAt: t(30) }, now)).toBe(false);
  expect(signupOpenNow(null, now)).toBe(false);
});

/**
 * The lists and share cards (tournamentSignupService.signupOpenNow). The switch stays on
 * after the deadline; cs.sivert.io 2026-11-07 showed "Sign-up open" on the front page for
 * a tournament that closed the day before.
 */
test('server: switched on is not open once the deadline has passed', () => {
  const now = Date.parse('2026-11-07T20:00:00.000Z');
  const win = (s: Record<string, unknown>) => windowOfSettings(JSON.stringify(s));
  expect(serverSignupOpenNow(win({ registrationOpen: true }), now)).toBe(true);
  expect(
    serverSignupOpenNow(
      win({ registrationOpen: true, registrationClosesAt: '2026-11-13T20:00:00.000Z' }),
      now
    )
  ).toBe(true);
  expect(
    serverSignupOpenNow(
      win({ registrationOpen: true, registrationClosesAt: '2026-11-06T18:00:00.000Z' }),
      now
    )
  ).toBe(false);
  expect(
    serverSignupOpenNow(
      win({ registrationOpen: true, registrationOpensAt: '2026-11-08T12:00:00.000Z' }),
      now
    )
  ).toBe(false);
  expect(serverSignupOpenNow(win({ registrationOpen: false }), now)).toBe(false);
});
