import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { io } from 'socket.io-client';
import { signInViaRequest } from '../helpers/auth';
import { parseProgress } from '../../api/src/integrations/cs2/demos/recorderLink';

/**
 * The recorder link (api/src/integrations/cs2/demos/recorderLink.ts): a
 * recorder keeps a WebSocket to the platform, is woken when there is work and
 * streams its progress, which the Recorders list and the match page show.
 */

const TAGS = { tag: ['@api'] };
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/api/game/cs2/recorder/link';

function open(
  token: string
): Promise<{ ws: WebSocket; messages: Array<Record<string, unknown>>; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${token}` } });
    const messages: Array<Record<string, unknown>> = [];
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({ ws, messages, closed }));
    ws.on('error', reject);
  });
}

async function until<T>(fn: () => T | undefined, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('progress is checked and bounded', TAGS, () => {
  expect(
    parseProgress({ step: 'recording', done: 2, total: 5, matchSlug: 'm-1', percent: 40 }, 1)
  ).toEqual({
    step: 'recording',
    detail: undefined,
    matchSlug: 'm-1',
    mapNumber: undefined,
    done: 2,
    total: 5,
    percent: 40,
    elapsed: undefined,
    eta: undefined,
    at: 1,
  });
  expect(parseProgress({ step: '<b>x</b>' })).toBeNull();
  expect(parseProgress({ step: 'recording', percent: 400, matchSlug: '../x' })).toMatchObject({
    percent: undefined,
    matchSlug: undefined,
  });
});

test('a recorder links, is woken, and its progress shows', TAGS, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const { token } = (await (
    await request.post('/api/game/cs2/recorder-keys', { data: { name: `spec-link-${Date.now()}` } })
  ).json()) as { token: string };

  // A bad key: the handshake, then 4401.
  const bad = await open('atr_000000000000_nope');
  bad.ws.send(JSON.stringify({ type: 'hello', recorder: 'x', version: 9 }));
  expect(await bad.closed).toBe(4401);

  // It says hello, gets welcome and a wake (it may have been waiting).
  const name = `spec-linked-${Date.now()}`;
  await request.post('/api/game/cs2/recorder/claim', {
    headers: { Authorization: `Bearer ${token}` },
    data: { recorder: name, version: 8 },
  });
  const link = await open(token);
  link.ws.send(JSON.stringify({ type: 'hello', recorder: name, version: 9 }));
  await until(() => link.messages.find((m) => m.type === 'welcome'));
  await until(() => link.messages.find((m) => m.type === 'wake'));

  // Asking it for a benchmark wakes it at once.
  const wakes = () => link.messages.filter((m) => m.type === 'wake').length;
  const before = wakes();
  expect((await request.post(`/api/game/cs2/recorders/${name}/benchmark`)).status()).toBe(200);
  await until(() => (wakes() > before ? true : undefined));

  // Its progress: on the Recorders list (linked, what it does) and on the match page.
  const slug = `spec-link-match-${Date.now()}`;
  const page = io(BASE_URL, { transports: ['polling'], forceNew: true });
  await new Promise<void>((r) => page.once('connect', () => r()));
  const seen = new Promise<Record<string, unknown>>((r) =>
    page.once(`highlights:progress:${slug}`, r)
  );
  link.ws.send(
    JSON.stringify({
      type: 'progress',
      step: 'recording',
      detail: 'ZywOo · 4K',
      matchSlug: slug,
      done: 1,
      total: 4,
    })
  );
  expect(await seen).toMatchObject({ recorder: name, step: 'recording', done: 1, total: 4 });
  const listed = async () =>
    (
      (await (await request.get('/api/game/cs2/recorders')).json()).recorders as Array<{
        name: string;
        linked?: boolean;
        online: boolean;
        progress?: { step: string } | null;
      }>
    ).find((r) => r.name === name)!;
  expect(await listed()).toMatchObject({
    linked: true,
    online: true,
    progress: { step: 'recording' },
  });

  // Idle: the match page's line goes, the list shows nothing in progress.
  const cleared = new Promise<Record<string, unknown>>((r) =>
    page.once(`highlights:progress:${slug}`, r)
  );
  link.ws.send(JSON.stringify({ type: 'idle' }));
  expect(await cleared).toMatchObject({ recorder: name, step: null });
  expect((await listed()).progress).toBeNull();

  // Gone: not linked any more.
  link.ws.close();
  await link.closed;
  await expect.poll(async () => (await listed()).linked).toBe(false);
  page.close();
});
