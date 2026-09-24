import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo, Socket } from 'net';
import { test, expect } from '@playwright/test';
import {
  downloadRelease,
  readRemoteFeed,
  refreshRemoteFeed,
  setCatalogOverridesForTests,
  type CatalogRelease,
} from '../../api/src/modules/catalogFeed';

/**
 * How the catalog fetches, in process, against a local server that can stall
 * or reset connections (DESIGN-modules §10.2).
 *
 * On a beta box one TLS handshake in three to raw.githubusercontent.com hung
 * until the deadline and the next one answered in 40 ms, so the Games page
 * showed the offline snapshot at random. A stalled or reset connection is
 * now retried once on a new one, a page load waits on the network for a
 * short deadline only (the fetch finishes in the background), and a failure
 * falls back to the last good copy with when it was fetched.
 *
 * @tag api
 * @tag modules
 */

const FEED = JSON.stringify({
  schema: 1,
  packs: [{ slug: 'stall-test', name: 'Stall Test', version: '1.0.0', engine: 'manual-report', file: 'packs/stall-test.json' }],
  modules: [],
});

interface FakeServer {
  origin: string;
  /** Connections accepted so far. */
  connections: () => number;
  /** The next `n` connections are accepted and never answered. */
  stall: (n: number) => void;
  /** The next `n` connections are reset as soon as they open. */
  reset: (n: number) => void;
  close: () => Promise<void>;
}

async function fakeServer(routes: Record<string, (res: http.ServerResponse) => void>): Promise<FakeServer> {
  let stallNext = 0;
  let resetNext = 0;
  let count = 0;
  const held = new WeakSet<Socket>();
  const server = http.createServer((req, res) => {
    // What a lost handshake looks like from the client: connected, then no answer.
    if (held.has(req.socket)) return;
    const route = routes[req.url ?? ''];
    if (route) route(res);
    else res.writeHead(404).end('not here');
  });
  server.on('connection', (socket: Socket) => {
    count++;
    if (stallNext > 0) {
      stallNext--;
      held.add(socket);
    } else if (resetNext > 0) {
      resetNext--;
      socket.resetAndDestroy();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    connections: () => count,
    stall: (n) => {
      stallNext = n;
    },
    reset: (n) => {
      resetNext = n;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let server: FakeServer;
let dir: string;

function point(overrides: { pageWaitMs?: number } = {}): string {
  const cacheFile = path.join(dir, 'catalog.json');
  setCatalogOverridesForTests({
    catalogUrl: `${server.origin}/catalog.json`,
    releasePrefix: `${server.origin}/releases/`,
    redirectOrigins: [server.origin],
    feedTimeoutMs: 400,
    pageWaitMs: overrides.pageWaitMs ?? 3000,
    downloadTimeoutMs: 3000,
    downloadAttemptTimeoutMs: 400,
    snapshotDir: dir,
    cacheFile,
  });
  return cacheFile;
}

test.describe('catalog feed fetching', () => {
  test.beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'at-catalog-feed-'));
    server = await fakeServer({
      '/catalog.json': (res) => res.writeHead(200, { 'content-type': 'application/json' }).end(FEED),
      '/broken.json': (res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"schema":'),
      '/releases/demo-1.0.0.atmod': (res) => res.writeHead(200).end('archive-bytes'),
      '/releases/demo-1.0.0.atmod.sig': (res) => res.writeHead(200).end('{"sig":true}'),
    });
  });

  test.afterEach(async () => {
    setCatalogOverridesForTests(null);
    await server.close();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('a first connection that stalls is retried on a new one', async () => {
    const cacheFile = point();
    server.stall(1);
    const started = Date.now();
    const feed = await readRemoteFeed();
    expect(feed).toMatchObject({ from: 'remote', error: null, refreshing: false });
    expect(feed.packs.map((pack) => pack.slug)).toEqual(['stall-test']);
    expect(server.connections()).toBe(2);
    // One attempt's deadline (400 ms) and the retry, not a long hang.
    expect(Date.now() - started).toBeLessThan(2000);
    expect(fs.existsSync(cacheFile)).toBe(true);
  });

  test('a connection reset is retried too', async () => {
    point();
    server.reset(1);
    const feed = await readRemoteFeed();
    expect(feed).toMatchObject({ from: 'remote', error: null });
    expect(server.connections()).toBe(2);
  });

  test('two stalls: the last good copy, with when it was fetched', async () => {
    const cacheFile = point();
    expect((await readRemoteFeed()).from).toBe('remote');
    const written = fs.statSync(cacheFile).mtime.toISOString();

    point();
    server.stall(2);
    const feed = await readRemoteFeed();
    expect(feed).toMatchObject({ from: 'cache', error: 'timeout', fetchedAt: written, refreshing: false });
    expect(feed.packs.map((pack) => pack.slug)).toEqual(['stall-test']);
    expect(server.connections()).toBe(3);

    // Straight after a failure the next page load does not wait on the network again.
    const started = Date.now();
    expect(await readRemoteFeed()).toMatchObject({ from: 'cache', error: 'timeout', refreshing: false });
    expect(Date.now() - started).toBeLessThan(200);
    expect(server.connections()).toBe(3);
  });

  test('a page load waits a short deadline, and the fetch finishes in the background', async () => {
    point({ pageWaitMs: 150 });
    server.stall(1);
    const started = Date.now();
    const first = await readRemoteFeed();
    expect(Date.now() - started).toBeLessThan(400);
    // Nothing cached yet: nothing to list, a fetch still running, and why.
    expect(first).toMatchObject({ from: 'none', error: 'timeout', refreshing: true });

    // The same fetch, joined rather than started again, answers on its retry.
    const background = await refreshRemoteFeed();
    expect(background).toMatchObject({ from: 'remote', refreshing: false });
    expect(server.connections()).toBe(2);
    expect((await readRemoteFeed()).from).toBe('remote');
  });

  test('an answer is not retried, and the reason is a code', async () => {
    point();
    setCatalogOverridesForTests({
      catalogUrl: `${server.origin}/missing.json`,
      feedTimeoutMs: 400,
      cacheFile: path.join(dir, 'none.json'),
    });
    expect(await readRemoteFeed()).toMatchObject({ from: 'none', error: 'http_404', fetchedAt: null });
    expect(server.connections()).toBe(1);

    setCatalogOverridesForTests({
      catalogUrl: `${server.origin}/broken.json`,
      feedTimeoutMs: 400,
      cacheFile: path.join(dir, 'none.json'),
    });
    expect(await readRemoteFeed()).toMatchObject({ from: 'none', error: 'bad_response' });
  });

  test('a release download whose first connection stalls is retried', async () => {
    point();
    server.stall(1);
    const release: CatalogRelease = {
      version: '1.0.0',
      serverApi: '^0.1.0',
      clientApi: '^0.2.0',
      sha256: null,
      size: null,
      from: 'remote',
      url: `${server.origin}/releases/demo-1.0.0.atmod`,
    };
    const bytes = await downloadRelease(release);
    expect(bytes.archive.toString()).toBe('archive-bytes');
    expect(bytes.signature.toString()).toBe('{"sig":true}');
    expect(server.connections()).toBe(3);
  });

  test('a release download that stalls every time fails within its deadline', async () => {
    point();
    server.stall(10);
    const started = Date.now();
    const failure = await downloadRelease({
        version: '1.0.0',
        serverApi: '^0.1.0',
        clientApi: '^0.2.0',
        sha256: null,
        size: null,
        from: 'remote',
        url: `${server.origin}/releases/demo-1.0.0.atmod`,
      })
      .then(() => null, (error: Error) => error.message);
    expect(failure).toBe('downloading the release failed: it did not answer in time');
    expect(server.connections()).toBe(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
