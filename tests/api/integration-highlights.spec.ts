import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { ADMIN_TOKEN, INTEGRATOR, READONLY_TOKEN, bearer } from '../helpers/webhooks';

/**
 * GET /api/integrations/highlights: the notable moments of analyzed maps for
 * an integrator (api/src/integrations/cs2/demos/momentStore.ts), on an
 * imported match whose analysis is the fixture map
 * (tests/fixtures/moments/map.json, the rules are tests/api/highlight-facts.spec.ts).
 *
 * - the integrator token reads them, oldest change first, with a cursor;
 *   filters by match and kind; imported matches are included;
 * - the same analysis again changes nothing (same ids, nothing after the cursor);
 * - a re-parse that no longer finds a moment revokes it, under the same id;
 * - the backfill reads stored analyses again (dry run stores nothing), admin only;
 * - a deleted match's moments are revoked.
 *
 * @tag api
 * @tag integrations
 */

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'moments', 'map.json'), 'utf8')
) as { analysis: { kills: Array<{ weapon: string; round: number }> }; replay: unknown };

async function importedMatch(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/game/cs2/imports', {
    data: { maps: 1, event: 'CI LAN' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { slug } = (await created.json()) as { slug: string };
  const name = Buffer.from('de_mirage');
  const head = Buffer.concat([
    Buffer.from('PBDEMS2\0', 'latin1'),
    Buffer.alloc(8),
    Buffer.from([0x01, 0x00, name.length + 2, 0x2a, name.length]),
    name,
  ]);
  const demo = Buffer.concat([head, Buffer.alloc(2048 - head.length, 7)]);
  const up = await request.put(
    `/api/game/cs2/imports/${slug}/maps/0?offset=0&total=${demo.length}`,
    {
      headers: { 'Content-Type': 'application/octet-stream' },
      data: demo,
    }
  );
  expect(up.ok(), await up.text()).toBe(true);
  return slug;
}

async function analyze(request: APIRequestContext, slug: string, analysis: unknown) {
  const job = `/api/game/cs2/demo-worker/jobs/${slug}/0`;
  const replay = await request.put(`${job}/replay`, {
    headers: { ...bearer(ADMIN_TOKEN.token), 'Content-Type': 'application/gzip' },
    data: zlib.gzipSync(JSON.stringify(fixture.replay)),
  });
  expect(replay.ok(), await replay.text()).toBe(true);
  const result = await request.post(`${job}/result`, {
    headers: bearer(ADMIN_TOKEN.token),
    data: { worker: 'spec', analysis },
  });
  expect(result.ok(), await result.text()).toBe(true);
}

interface Page {
  highlights: Array<Record<string, unknown> & { id: string; kind: string; revoked: boolean }>;
  nextCursor: string;
  hasMore: boolean;
}

async function list(
  request: APIRequestContext,
  query: string,
  token = INTEGRATOR.token
): Promise<Page> {
  const res = await request.get(`/api/integrations/highlights?${query}`, {
    headers: bearer(token),
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Page;
}

test.describe.serial('Highlights API for integrators', () => {
  let slug = '';
  let knifeId = '';
  let cursor = '';

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('an analyzed import has its moments, read with the integrator token', async ({
    request,
  }) => {
    slug = await importedMatch(request);
    await analyze(request, slug, fixture.analysis);

    const page = await list(request, `match=${slug}`);
    const kinds = page.highlights.map((h) => h.kind);
    for (const kind of [
      'knife_kill',
      'zeus_kill',
      'ace',
      'clutch_1vN',
      'noscope_kill',
      'grenade_kill',
      'bomb_defuse_last_second',
    ]) {
      expect(kinds, kind).toContain(kind);
    }
    const knife = page.highlights.filter((h) => h.kind === 'knife_kill');
    expect(knife).toHaveLength(2);
    expect(knife[0]).toMatchObject({
      matchSlug: slug,
      mapNumber: 1,
      map: 'de_mirage',
      round: 2,
      player: { steamId64: '76561198000000011' },
      victim: { steamId64: '76561198000000021' },
      weapon: 'Knife',
      imported: true,
      revoked: false,
      tournament: { id: null, name: 'CI LAN' },
      playedAt: null,
      clipUrl: null,
    });
    expect(String(knife[0]!.replayUrl)).toContain(`/analysis/${slug}/0?round=2`);
    expect(knife[0]!.id).toMatch(/^hl_[0-9a-f]{24}$/);
    knifeId = knife[0]!.id;
    cursor = page.nextCursor;

    // Filter by kind; the read-only token reads too.
    const only = await list(request, `match=${slug}&kind=knife_kill`, READONLY_TOKEN.token);
    expect(only.highlights.map((h) => h.id)).toEqual(knife.map((h) => h.id));
  });

  test('pages run oldest first with a cursor', async ({ request }) => {
    const all = await list(request, `match=${slug}`);
    const first = await list(request, `match=${slug}&limit=2`);
    expect(first.hasMore).toBe(true);
    expect(first.highlights.map((h) => h.id)).toEqual(all.highlights.slice(0, 2).map((h) => h.id));
    const second = await list(request, `match=${slug}&limit=2&since=${first.nextCursor}`);
    expect(second.highlights.map((h) => h.id)).toEqual(all.highlights.slice(2, 4).map((h) => h.id));
  });

  test('the same analysis again changes nothing', async ({ request }) => {
    await analyze(request, slug, fixture.analysis);
    const after = await list(request, `match=${slug}&since=${cursor}`);
    expect(after.highlights).toEqual([]);
    expect(after.nextCursor).toBe(cursor);
  });

  test('a re-parse without the knife kill revokes it, under the same id', async ({ request }) => {
    const kills = fixture.analysis.kills.filter((k) => !(k.round === 2 && k.weapon === 'Knife'));
    await analyze(request, slug, { ...fixture.analysis, kills });
    const after = await list(request, `match=${slug}&since=${cursor}`);
    expect(after.highlights.map((h) => [h.id, h.revoked])).toEqual([[knifeId, true]]);
    cursor = after.nextCursor;
    // And back again when a later read finds it.
    await analyze(request, slug, fixture.analysis);
    const back = await list(request, `match=${slug}&since=${cursor}`);
    expect(back.highlights.map((h) => [h.id, h.revoked])).toEqual([[knifeId, false]]);
    cursor = back.nextCursor;
  });

  test('the backfill reads stored analyses again; admin only', async ({
    request,
    playwright,
    baseURL,
  }) => {
    const dry = await request.post('/api/game/cs2/moments/backfill', {
      data: { match: slug, dryRun: true },
    });
    expect(dry.ok(), await dry.text()).toBe(true);
    const body = await dry.json();
    expect(body).toMatchObject({ success: true, dryRun: true, maps: 1, created: 0 });
    expect(body.knifeKills).toHaveLength(2);
    const real = await (
      await request.post('/api/game/cs2/moments/backfill', { data: { match: slug } })
    ).json();
    expect(real).toMatchObject({ maps: 1, created: 0, updated: 0, revoked: 0 });
    expect(real.unchanged).toBeGreaterThan(0);

    const integrator = await playwright.request.newContext({ baseURL });
    const denied = await integrator.post('/api/game/cs2/moments/backfill', {
      headers: bearer(INTEGRATOR.token),
      data: { dryRun: true },
    });
    expect(denied.status()).toBe(403);
    const anonymous = await integrator.get('/api/integrations/highlights');
    expect(anonymous.status()).toBe(401);
    await integrator.dispose();
  });

  test('bad parameters are refused', async ({ request }) => {
    for (const q of ['since=abc', 'limit=0', 'limit=5000', 'tournament=x', 'kind=headshot']) {
      const res = await request.get(`/api/integrations/highlights?${q}`, {
        headers: bearer(INTEGRATOR.token),
      });
      expect(res.status(), q).toBe(400);
    }
  });

  test("a deleted match's moments are revoked", async ({ request }) => {
    expect((await request.delete(`/api/matches/${slug}`)).ok()).toBe(true);
    // The backfill (and every demo worker claim) revokes moments of gone matches.
    await request.post('/api/game/cs2/moments/backfill', { data: { match: 'no-such-match' } });
    const after = await list(request, `match=${slug}&since=${cursor}`);
    expect(after.highlights.length).toBeGreaterThan(0);
    expect(after.highlights.every((h) => h.revoked && h.clipUrl === null)).toBe(true);
  });
});
