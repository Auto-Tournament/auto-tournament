import { test, expect, type APIRequestContext } from '@playwright/test';
import { ensureSignedIn, signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import type { Team } from '../helpers/teams';

/**
 * Map pool size limits of a veto tournament: bo1 1-7, bo3 3-7, bo5 5-7
 *
 * @tag api
 * @tag veto
 */

const ALL_MAPS = [
  'de_mirage',
  'de_inferno',
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_vertigo',
  'de_nuke',
];

test.describe.serial('Veto map pool limits', () => {
  let teamIds: string[];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: ALL_MAPS,
      teamCount: 2,
      serverCount: 1,
      prefix: 'veto-limits',
    });
    expect(setup).toBeTruthy();
    teamIds = setup!.teams.map((t: Team) => t.id);
    await request.delete('/api/tournament', { headers: getAuthHeader() });
  });

  function create(
    request: APIRequestContext,
    format: 'bo1' | 'bo3' | 'bo5',
    maps: string[],
    settings?: Record<string, unknown>
  ) {
    return request.post('/api/tournament', {
      headers: getAuthHeader(),
      data: {
        name: `Pool Limits ${format} ${Date.now()}`,
        type: 'single_elimination',
        format,
        maps,
        teamIds,
        settings,
      },
    });
  }

  function update(request: APIRequestContext, data: Record<string, unknown>) {
    return request.put('/api/tournament', { headers: getAuthHeader(), data });
  }

  test('bo3 with 2 maps is rejected', { tag: ['@api', '@veto'] }, async ({ request }) => {
    const res = await create(request, 'bo3', ALL_MAPS.slice(0, 2));
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('A bo3 map veto needs between 3 and 7 maps, got 2');
  });

  test('bo5 with 4 maps is rejected', { tag: ['@api', '@veto'] }, async ({ request }) => {
    const res = await create(request, 'bo5', ALL_MAPS.slice(0, 4));
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('A bo5 map veto needs between 5 and 7 maps, got 4');
  });

  test('bo1 with 8 maps is rejected', { tag: ['@api', '@veto'] }, async ({ request }) => {
    const res = await create(request, 'bo1', [...ALL_MAPS, 'de_overpass']);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('A bo1 map veto needs between 1 and 7 maps, got 8');
  });

  test('bo3 with 3 maps is accepted', { tag: ['@api', '@veto'] }, async ({ request }) => {
    const res = await create(request, 'bo3', ALL_MAPS.slice(0, 3));
    expect(res.status()).toBeLessThan(300);
  });

  test(
    'a pool below the veto minimum is accepted when the veto is off',
    { tag: ['@api', '@veto'] },
    async ({ request }) => {
      const res = await create(request, 'bo3', ALL_MAPS.slice(0, 2), { cs2: { veto: false } });
      expect(res.status()).toBeLessThan(300);
    }
  );

  test(
    'an update that shrinks a bo3 pool to 2 is rejected',
    { tag: ['@api', '@veto'] },
    async ({ request }) => {
      expect((await create(request, 'bo3', ALL_MAPS.slice(0, 5))).ok()).toBeTruthy();
      const res = await update(request, { maps: ALL_MAPS.slice(0, 2) });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toBe('A bo3 map veto needs between 3 and 7 maps, got 2');
      expect((await update(request, { maps: ALL_MAPS.slice(0, 4) })).ok()).toBeTruthy();
    }
  );

  test(
    'an update that changes only the format checks the stored pool',
    { tag: ['@api', '@veto'] },
    async ({ request }) => {
      expect((await create(request, 'bo1', ALL_MAPS.slice(0, 4))).ok()).toBeTruthy();
      const res = await update(request, { format: 'bo5' });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toBe('A bo5 map veto needs between 5 and 7 maps, got 4');
    }
  );

  test(
    'a custom order is checked against the stored pool when the update sends no maps',
    { tag: ['@api', '@veto'] },
    async ({ request }) => {
      expect((await create(request, 'bo1', ALL_MAPS.slice(0, 4))).ok()).toBeTruthy();
      const sevenMapOrder = {
        bo1: [
          { step: 1, team: 'team1', action: 'ban' },
          { step: 2, team: 'team1', action: 'ban' },
          { step: 3, team: 'team2', action: 'ban' },
          { step: 4, team: 'team2', action: 'ban' },
          { step: 5, team: 'team2', action: 'ban' },
          { step: 6, team: 'team1', action: 'ban' },
          { step: 7, team: 'team2', action: 'side_pick' },
        ],
      };
      const bad = await update(request, { settings: { customVetoOrder: sevenMapOrder } });
      expect(bad.status()).toBe(400);

      const fourMapOrder = {
        bo1: [
          { step: 1, team: 'team1', action: 'ban' },
          { step: 2, team: 'team2', action: 'ban' },
          { step: 3, team: 'team1', action: 'ban' },
          { step: 4, team: 'team2', action: 'side_pick' },
        ],
      };
      const good = await update(request, { settings: { customVetoOrder: fourMapOrder } });
      expect(good.ok()).toBeTruthy();
    }
  );
});
