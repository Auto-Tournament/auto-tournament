import { test, expect } from '@playwright/test';
import { discordFetch } from '../../api/src/services/discord/rest';

/**
 * Discord calls go one at a time and wait out Discord's limits: a 429 is
 * tried again after its retry_after, and calls never overlap.
 *
 * @tag api
 */

type FetchFn = typeof globalThis.fetch;

function answer(
  status: number,
  body: object,
  headers: Record<string, string> = {}
): globalThis.Response {
  return new globalThis.Response(JSON.stringify(body), { status, headers });
}

test.describe('Discord REST queue', () => {
  let realFetch: FetchFn;
  test.beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  test.afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('a 429 is tried again after retry_after', async () => {
    const calls: number[] = [];
    globalThis.fetch = (async () => {
      calls.push(Date.now());
      return calls.length === 1
        ? answer(429, { retry_after: 0.2 })
        : answer(200, { id: 'channel-1' });
    }) as FetchFn;
    const r = await discordFetch('token', '/guilds/1/channels', { method: 'POST', body: {} });
    expect(r.ok).toBe(true);
    expect(r.body.id).toBe('channel-1');
    expect(calls).toHaveLength(2);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(180);
  });

  test('gives up after three 429s and returns the last answer', async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return answer(429, { retry_after: 0.01 });
    }) as FetchFn;
    const r = await discordFetch('token', '/users/@me');
    expect(r.status).toBe(429);
    expect(n).toBe(3);
  });

  test('calls run one at a time, in order', async () => {
    let open = 0;
    let most = 0;
    const order: string[] = [];
    globalThis.fetch = (async (url: string | URL | globalThis.Request) => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 20));
      order.push(String(url).split('/').pop() ?? '');
      open--;
      return answer(200, {});
    }) as FetchFn;
    await Promise.all(['a', 'b', 'c'].map((p) => discordFetch('token', `/x/${p}`)));
    expect(most).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  test('waits for the window to reset when Discord says none are left', async () => {
    const calls: number[] = [];
    globalThis.fetch = (async () => {
      calls.push(Date.now());
      return calls.length === 1
        ? answer(200, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '0.2' })
        : answer(200, {});
    }) as FetchFn;
    await discordFetch('token', '/x/1');
    await discordFetch('token', '/x/2');
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(180);
  });
});
