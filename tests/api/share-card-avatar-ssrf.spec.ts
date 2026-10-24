import { test, expect } from '@playwright/test';
import { Readable } from 'stream';
import { fromUrl, readCapped } from '../../api/src/services/shareCards/images';

/**
 * Share-card avatars are fetched by the server: the host is resolved and
 * every address checked (services/webhooks/ssrf.ts, private never allowed),
 * the connection goes to the checked address, and the body is read with a
 * cap.
 *
 * @tag api
 * @tag security
 */

const TAGS = { tag: ['@api', '@security'] };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Any request that slips through answers with a picture. */
function stubFetch(): { calls: string[]; restore: () => void } {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    return new globalThis.Response(PNG, { headers: { 'content-type': 'image/png' } });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

test('a host that resolves to a private address gets no request', TAGS, async () => {
  const stub = stubFetch();
  try {
    const lookup = async () => [{ address: '10.1.2.3', family: 4 }];
    expect(await fromUrl('https://avatars.rebind.test/a.png', lookup)).toBeNull();
    expect(stub.calls).toEqual([]);
  } finally {
    stub.restore();
  }
});

test('IPv4-mapped IPv6 literals are private too', TAGS, async () => {
  const stub = stubFetch();
  try {
    for (const url of ['https://[::ffff:127.0.0.1]/a.png', 'https://[::ffff:a9fe:a9fe]/a.png']) {
      expect(await fromUrl(url), url).toBeNull();
    }
    expect(stub.calls).toEqual([]);
  } finally {
    stub.restore();
  }
});

test('the body is read up to the cap and no further', TAGS, async () => {
  expect(await readCapped(Readable.from([Buffer.alloc(10), Buffer.alloc(10)]), 32)).toEqual(
    Buffer.alloc(20)
  );
  const endless = new Readable({
    read() {
      this.push(Buffer.alloc(1024));
    },
  });
  expect(await readCapped(endless, 4096)).toBeNull();
  expect(endless.destroyed).toBe(true);
});
