import { test, expect } from '@playwright/test';
import { signupOpenNow } from '../../client/src/utils/signupOpen';

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
