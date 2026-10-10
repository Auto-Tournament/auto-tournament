import { test, expect } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';

test('a real two-player bracket fills to the configured team size without fake roster players', async ({
  request,
}) => {
  expect(await signInViaRequest(request)).toBe(true);
  const headers = getAuthHeader();
  await request.delete('/api/tournament', { headers });
  const suffix = Date.now();
  const teams = [1, 2].map((n) => ({
    id: `mixed-bots-${suffix}-${n}`,
    name: `Mixed team ${n}`,
    players: [{ steamId: `7656119800000000${n}`, name: `Human ${n}` }],
  }));
  for (const team of teams) {
    const res = await request.post('/api/teams', { headers, data: team });
    expect(res.ok(), await res.text()).toBe(true);
  }
  const created = await request.post('/api/tournament', {
    headers,
    data: {
      name: 'Mixed bracket',
      type: 'single_elimination',
      format: 'bo1',
      teamSize: 2,
      maps: ['de_mirage'],
      teamIds: teams.map((t) => t.id),
      settings: { cs2: { fillTeamsWithBots: true } },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const list = await request.get('/api/matches', { headers });
  const { matches } = await list.json();
  const match = matches.find((m: { round: number }) => m.round === 1);
  expect(match).toBeTruthy();
  const configRes = await request.get(`/api/matches/${match.slug}.json`, { headers });
  expect(configRes.ok(), await configRes.text()).toBe(true);
  const config = await configRes.json();
  expect(config.bot_fill).toBe(true);
  expect(config.players_per_team).toBe(2);
  expect(config.simulation).toBe(false);
  expect(config.simulation_timescale).toBeUndefined();
  expect(Object.keys(config.team1.players)).toHaveLength(1);
  expect(Object.keys(config.team2.players)).toHaveLength(1);
  expect(config.expected_players_team1).toBe(1);
  expect(config.expected_players_team2).toBe(1);
  const disabled = await request.put('/api/tournament', {
    headers,
    data: {
      settings: { cs2: { fillTeamsWithBots: false } },
    },
  });
  expect(disabled.ok(), await disabled.text()).toBe(true);
  const normal = await (await request.get(`/api/matches/${match.slug}.json`, { headers })).json();
  expect(normal.bot_fill).toBeUndefined();
  expect(normal.players_per_team).toBe(1);
});
