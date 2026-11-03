import { test, expect } from '@playwright/test';
import { autoStartMinutesFor } from '../../api/src/integrations/cs2/fleet/autoStart';

test("auto-start: the tournament's minutes, else the site's; 0 is never", { tag: ['@api'] }, () => {
  const t = (cs2: object) => JSON.stringify({ cs2 });
  expect(autoStartMinutesFor(t({ autoStartMinutes: 10 }), 5)).toBe(10);
  expect(autoStartMinutesFor(t({ autoStartMinutes: 0 }), 5)).toBe(0);
  expect(autoStartMinutesFor(t({}), 5)).toBe(5);
  expect(autoStartMinutesFor(null, 0)).toBe(0);
  expect(autoStartMinutesFor('not json', 3)).toBe(3);
});
