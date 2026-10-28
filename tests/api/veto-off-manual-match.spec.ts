import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * A manual match with the veto off and its sides set has no veto: no side pick
 * for the other team, and its sides stay as set (#1020).
 *
 * @tag api
 * @tag veto
 */
test(
  'a manual match without a veto has no veto to read or act in',
  { tag: ['@api'] },
  async ({ request }) => {
    await signInViaRequest(request);
    const slug = `veto-off-${Date.now()}`;
    const created = await request.post('/api/matches', {
      headers: getAuthHeader(),
      data: {
        slug,
        config: {
          vetoDisabled: true,
          maplist: ['de_mirage'],
          num_maps: 1,
          players_per_team: 1,
          map_sides: ['team1_ct'],
          team1: { name: 'Preset Alpha', players: [{ steamid: '76561198000100001', name: 'a' }] },
          team2: { name: 'Preset Bravo', players: [{ steamid: '76561198000100002', name: 'b' }] },
        },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    try {
      expect((await request.get(`/api/veto/${slug}`, { headers: getAuthHeader() })).status()).toBe(
        409
      );
      const act = await request.post(`/api/veto/${slug}/action`, {
        headers: getAuthHeader(),
        data: { side: 'CT', actAs: 'team2' },
      });
      expect(act.status()).toBe(409);
      const match = await (
        await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() })
      ).json();
      expect(match.match.config.map_sides).toEqual(['team1_ct']);
    } finally {
      await request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() });
    }
  }
);
