import { test, expect } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * A player's own skin writes (/api/skins/me/*) come from this site: a
 * cross-site request is refused before it touches the inventory.
 *
 * @tag api
 * @tag security
 */

const WRITES: Array<['post' | 'put' | 'delete', string]> = [
  ['post', '/api/skins/me/trade-up'],
  ['post', '/api/skins/me/choices/1'],
  ['post', '/api/skins/me/equip'],
  ['delete', '/api/skins/me/equip/knife'],
  ['post', '/api/skins/me/seen'],
  ['put', '/api/skins/me/showcase'],
];

test('cross-site skin writes are refused', { tag: ['@api', '@security'] }, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const on = await request.put('/api/skins/admin/config', { data: { enabled: true } });
  expect(on.status(), await on.text()).toBe(200);
  expect(await signInAsPlayerViaRequest(request, '76561198000000081')).toBe(true);
  for (const [method, path] of WRITES) {
    const res = await request[method](path, {
      data: method === 'delete' ? undefined : {},
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status(), `${method} ${path}`).toBe(403);
  }
  const seen = await request.post('/api/skins/me/seen', { data: { ids: [] } });
  expect(seen.status(), await seen.text()).toBe(200);
});
