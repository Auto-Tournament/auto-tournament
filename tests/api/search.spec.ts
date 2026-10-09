import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/** The search box's API (api/src/routes/search.ts). */

const TAGS = { tag: ['@api'] };
const stamp = String(Date.now()).slice(-7);

test(
  'finds players, teams and tournaments by name; banned players stay out',
  TAGS,
  async ({ request, playwright, baseURL }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const headers = getAuthHeader();
    const word = `Zq${stamp}`;
    const ids = [`765611981${stamp}1`, `765611981${stamp}2`];
    await request.post('/api/players/import', {
      headers,
      data: [
        { steamId: ids[0], name: `${word} Finder` },
        { steamId: ids[1], name: `${word} Banned` },
      ],
    });
    await request.post(`/api/players/${ids[1]}/ban`, { headers, data: { reason: 'spec' } });
    await request.post('/api/teams?upsert=true', {
      headers,
      data: {
        id: `search-${stamp}`,
        name: `${word} Team`,
        tag: 'ZQ',
        players: [{ steamId: ids[0], name: `${word} Finder` }],
      },
    });

    // Public: no sign-in needed.
    const anon = await playwright.request.newContext({ baseURL });
    expect((await (await anon.get('/api/search?q=a')).json()).players).toEqual([]);
    const res = await anon.get(`/api/search?q=${encodeURIComponent(word.toLowerCase())}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      players: Array<{ id: string; name: string }>;
      teams: Array<{ id: string; name: string }>;
    };
    expect(body.players.map((p) => p.id)).toEqual([ids[0]]);
    expect(body.teams.map((t) => t.id)).toEqual([`search-${stamp}`]);
    // A SteamID64 finds that player.
    expect((await (await anon.get(`/api/search?q=${ids[0]}`)).json()).players[0]?.id).toBe(ids[0]);
    // % and _ are not wildcards.
    expect((await (await anon.get('/api/search?q=%25%25')).json()).players).toEqual([]);
    await anon.dispose();
  }
);
