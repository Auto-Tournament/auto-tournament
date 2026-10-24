import { test, expect, request as newRequest } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Request bodies: 1 MB of JSON and 100 KB of form data by default, read
 * before authentication; the admin routes that carry files get a larger limit
 * of their own, read only once the caller is an admin (utils/bodyLimits.ts).
 *
 * @tag api
 * @tag security
 */

const TAGS = { tag: ['@api', '@security'] };
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const twoMb = () => ({ pad: 'x'.repeat(2 * 1024 * 1024) });

test('a 2 MB JSON body is refused before auth, on an ordinary route', TAGS, async () => {
  const anon = await newRequest.newContext({ baseURL: BASE });
  try {
    const res = await anon.post('/api/teams', { data: twoMb() });
    expect(res.status()).toBe(413);
  } finally {
    await anon.dispose();
  }
});

test('a large route is not read for a caller who is not an admin', TAGS, async () => {
  const anon = await newRequest.newContext({ baseURL: BASE });
  try {
    const res = await anon.post('/api/players/import', { data: twoMb() });
    expect(res.status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test('form bodies: 100 KB and 100 fields', TAGS, async () => {
  const anon = await newRequest.newContext({ baseURL: BASE });
  try {
    const big = await anon.post('/api/auth/logout', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `a=${'x'.repeat(200 * 1024)}`,
    });
    expect(big.status()).toBe(413);
    const many = await anon.post('/api/auth/logout', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: Array.from({ length: 500 }, (_, i) => `k${i}=v`).join('&'),
    });
    expect(many.status()).toBe(413);
  } finally {
    await anon.dispose();
  }
});

test('the large admin routes still take bodies over 1 MB', TAGS, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  for (const [method, path] of [
    ['post', '/api/maps/no-such-map/upload-image'],
    ['post', '/api/game/cs2/demo-worker/jobs/no-such-match/1/result'],
    ['post', '/api/packs'],
    ['post', '/api/players/import'],
    ['post', '/api/players/bulk-import'],
  ] as const) {
    const res = await request[method](path, { data: twoMb() });
    expect(res.status(), `${method} ${path}`).not.toBe(413);
    expect(res.status(), `${method} ${path}`).toBeLessThan(500);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(3 * 1024 * 1024),
  ]).toString('base64');
  const radar = await request.put('/api/game/cs2/radars/de_bodylimit/default', {
    data: { png, scale: 5 },
  });
  expect(radar.status(), await radar.text()).toBe(200);
});
