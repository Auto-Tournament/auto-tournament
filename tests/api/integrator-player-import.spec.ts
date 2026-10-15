import { test, expect } from '@playwright/test';

/**
 * An event site imports its players with its integrator token, the same one it sends its teams
 * with (routes/players.ts POST /import). Everything else under /api/players stays admin only.
 */

const INTEGRATOR = 'ci-integrator-token-0123456789abcdef';
const TAGS = { tag: ['@api', '@security'] };

test(
  'an integrator token imports players, and reaches nothing else under /api/players',
  TAGS,
  async ({ request }) => {
    const auth = { Authorization: `Bearer ${INTEGRATOR}` };
    const steamId = `7656119${String(Date.now()).slice(-10)}`;
    const res = await request.post('/api/players/import', {
      headers: auth,
      data: { players: [{ steamId, name: 'Imported Via Site' }] },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).created).toBe(1);

    // Other player routes refuse the integrator token.
    expect((await request.get('/api/players', { headers: auth })).status()).toBe(403);
    expect(
      (await request.post('/api/players/bulk-import', { headers: auth, data: [] })).status()
    ).toBe(403);
  }
);
