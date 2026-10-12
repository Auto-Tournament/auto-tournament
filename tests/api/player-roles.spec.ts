import { test, expect, request as playwrightRequest } from '@playwright/test';
import { suggestRole, type RoleEvidence } from '../../api/src/integrations/cs2/roles';
import { signInAsPlayerViaRequest } from '../helpers/auth';

/**
 * CS2 player roles (api/src/integrations/cs2/roles.ts): suggestions from the
 * demos, checked on real players' numbers (EWC and MOUZ vs Vitality demos,
 * 2026-10-12), and a chosen role that the demos never overwrite.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api'] };
const e = (over: Partial<RoleEvidence>): RoleEvidence => ({
  maps: 4,
  rounds: 90,
  kills: 70,
  awpShare: 0,
  openingRate: 0.2,
  flashesPerRound: 0.3,
  utilityPerRound: 4,
  ...over,
});

test('the demos suggest how players play', TAGS, () => {
  // sh1ro: half his kills with the AWP.
  expect(suggestRole(e({ awpShare: 0.52, openingRate: 0.07, flashesPerRound: 0.58 }))?.role).toBe(
    'awper'
  );
  // donk: in two of five opening duels.
  expect(suggestRole(e({ openingRate: 0.39, flashesPerRound: 0.33 }))?.role).toBe('entry');
  // apEX: a flash and 14 utility damage a round.
  expect(suggestRole(e({ maps: 3, flashesPerRound: 1.1, utilityPerRound: 14 }))?.role).toBe(
    'support'
  );
  // ropz: none of those stands out.
  expect(
    suggestRole(e({ maps: 3, awpShare: 0.09, openingRate: 0.2, flashesPerRound: 0.39 }))?.role
  ).toBe('rifler');
});

test('too little to go on: no suggestion; more maps, more confidence', TAGS, () => {
  expect(suggestRole(e({ maps: 2 }))).toBeNull();
  expect(suggestRole(e({ kills: 29 }))).toBeNull();
  expect(suggestRole(e({ maps: 3, awpShare: 0.5 }))?.confidence).toBe('low');
  expect(suggestRole(e({ maps: 8, awpShare: 0.5 }))?.confidence).toBe('medium');
  expect(suggestRole(e({ maps: 14, awpShare: 0.5 }))?.confidence).toBe('high');
});

test('a player chooses their own role', TAGS, async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const id = `7656119${Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('')}`;
  expect(await signInAsPlayerViaRequest(ctx, id, 'Role picker')).toBe(true);
  expect(
    (await ctx.put('/api/game/cs2/players/me/role', { data: { role: 'boss' } })).status()
  ).toBe(400);
  const chose = await ctx.put('/api/game/cs2/players/me/role', { data: { role: 'igl' } });
  expect(await chose.json()).toMatchObject({ chosen: 'igl', suggestion: null });
  expect(await (await ctx.get(`/api/game/cs2/players/${id}/role`)).json()).toMatchObject({
    chosen: 'igl',
  });
  await ctx.put('/api/game/cs2/players/me/role', { data: { role: null } });
  expect(await (await ctx.get(`/api/game/cs2/players/${id}/role`)).json()).toMatchObject({
    chosen: null,
  });
  // Nobody signed in: no choosing.
  const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
  expect(
    (await anon.put('/api/game/cs2/players/me/role', { data: { role: 'awper' } })).status()
  ).toBe(401);
  await Promise.all([ctx.dispose(), anon.dispose()]);
});
