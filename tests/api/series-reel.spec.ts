import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * A series reel (map -1) waits for every map: a map none of whose clips could
 * be recorded holds it back, while the other map still gets its own reel
 * (api/src/integrations/cs2/demos/highlights.ts queueMatchReelFor).
 */

const TAGS = { tag: ['@api'] };

function fakeDemo(map: string, size: number): Buffer {
  const name = Buffer.from(map);
  const header = Buffer.concat([Buffer.from([0x2a, name.length]), name]);
  const command = Buffer.from([0x01, 0x00, header.length]);
  const head = Buffer.concat([
    Buffer.from('PBDEMS2\0', 'latin1'),
    Buffer.alloc(8),
    command,
    header,
  ]);
  return Buffer.concat([head, Buffer.alloc(size - head.length, 7)]);
}

/** An imported two-map match where two players get a 3K on each map. */
async function twoMapMatch(request: APIRequestContext): Promise<string> {
  const { slug } = (await (
    await request.post('/api/game/cs2/imports', { data: { maps: 2 } })
  ).json()) as {
    slug: string;
  };
  const stamp = String(Date.now()).slice(-5);
  const a = Array.from({ length: 5 }, (_, i) => `7656119802${stamp}${i}0`);
  const b = Array.from({ length: 5 }, (_, i) => `7656119802${stamp}${i}5`);
  const players = Object.fromEntries(
    [...a, ...b].map((id, i) => [id, { name: `S${i}`, roundsPlayed: 2, kills: 3, deaths: 1 }])
  );
  for (const [map, mapName] of [
    [0, 'de_mirage'],
    [1, 'de_nuke'],
  ] as const) {
    const demo = fakeDemo(mapName, 2048);
    await request.put(`/api/game/cs2/imports/${slug}/maps/${map}?offset=0&total=${demo.length}`, {
      headers: { 'Content-Type': 'application/octet-stream' },
      data: demo,
    });
    const kills = [1, 2].flatMap((round) =>
      [0, 1, 2].map((k) => ({
        tick: round * 10_000 + k * 64,
        round,
        attacker: a[round - 1],
        victim: b[k],
        attackerSide: 'CT',
        victimSide: 'T',
        weapon: 'ak47',
        headshot: false,
      }))
    );
    const analysis = {
      analyzerVersion: 7,
      map: mapName,
      rounds: [1, 2].map((n) => ({
        number: n,
        startTick: (n - 1) * 10_000 + 5_000,
        endTick: n * 10_000 + 5_000,
        winner: 'CT',
        reason: 'ct_win',
      })),
      kills,
      players,
      teams: [
        { name: 'Series A', startSide: 'CT', score: 2, players: a },
        { name: 'Series B', startSide: 'T', score: 0, players: b },
      ],
    };
    const res = await request.post(`/api/game/cs2/demo-worker/jobs/${slug}/${map}/result`, {
      data: { worker: 'spec', analysis },
    });
    expect(res.status()).toBe(200);
  }
  return slug;
}

type Job = {
  kind: string;
  matchSlug: string;
  mapNumber: number;
  players: Array<{ moments: Array<{ id: number }> }>;
};

test(
  'a map none of whose clips were recorded holds the series reel back',
  TAGS,
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const slug = await twoMapMatch(request);
    // The import's moments are saved after its analysis answers: wait for both maps'.
    await expect
      .poll(
        async () => {
          const list = (await (await request.get('/api/game/cs2/clips')).json()) as {
            matches: Array<{ slug: string; clips: Array<{ mapNumber: number }> }>;
          };
          const clips = list.matches.find((m) => m.slug === slug)?.clips ?? [];
          return new Set(clips.map((c) => c.mapNumber)).size;
        },
        { timeout: 15_000 }
      )
      .toBe(2);
    const name = `spec-series-${Date.now()}`;
    const ask = () =>
      request.post('/api/game/cs2/recorder/claim', { data: { recorder: name, version: 7 } });
    await ask();
    await request.post('/api/game/cs2/recorder/benchmark', {
      data: {
        recorder: name,
        tries: [
          {
            gamescopeHz: 120,
            seconds: 60,
            captureFps: 118,
            repeatPct: 0.4,
            jumpPct: 1.4,
            ok: true,
          },
        ],
      },
    });
    // Our moments on a map, claimed (other specs' jobs are skipped).
    const seen: string[] = [];
    // Tournament matches go before imports, and other specs leave moments
    // waiting: take (and keep) theirs until ours come up.
    const claimOurs = async (map: number): Promise<number[]> => {
      const ids: number[] = [];
      for (let i = 0; i < 300; i++) {
        const res = await ask();
        if (res.status() !== 200) {
          seen.push(`HTTP ${res.status()}`);
          break;
        }
        const job = (await res.json()).job as Job;
        if (job.kind !== 'map' || job.matchSlug !== slug) {
          seen.push(`${job.kind} ${job.matchSlug ?? ''}`);
          continue;
        }
        const got = job.players.flatMap((p) => p.moments.map((m) => m.id));
        if (job.mapNumber !== map) {
          await request.post('/api/game/cs2/recorder/fail', {
            data: { ids: got, error: 'not now' },
          });
          continue;
        }
        ids.push(...got);
        if (ids.length >= 2) break;
      }
      return ids;
    };
    const reels = async () => {
      const list = (await (await request.get('/api/game/cs2/clips')).json()) as {
        matches: Array<{
          slug: string;
          reels: Array<{ mapNumber: number }>;
          clips: Array<{ mapNumber: number; status: string }>;
        }>;
      };
      return list.matches.find((m) => m.slug === slug)!;
    };

    // Map 0: every take fails, until its moments are given up on.
    for (let round = 0; round < 6; round++) {
      const ids = await claimOurs(0);
      if (ids.length === 0) break;
      await request.post('/api/game/cs2/recorder/fail', { data: { ids, error: 'spec: broken' } });
    }
    const map0 = (await reels()).clips.filter((c) => c.mapNumber === 0);
    expect(map0.length).toBeGreaterThan(0);
    expect(
      map0.every((c) => c.status === 'failed'),
      `map 0: ${JSON.stringify(map0.map((c) => c.status))}; claims: ${seen.slice(-10).join(', ')}`
    ).toBe(true);

    // Map 1: recorded.
    const ids = await claimOurs(1);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      const up = await request.put(`/api/game/cs2/recorder/jobs/${id}/clip`, {
        headers: { 'Content-Type': 'video/mp4' },
        data: Buffer.from('not really a video'),
      });
      expect(up.status()).toBe(200);
    }

    const mine = await reels();
    expect(mine.clips.filter((c) => c.mapNumber === 1).every((c) => c.status === 'done')).toBe(
      true
    );
    // Map 1 gets its reel; the series waits for map 0.
    expect(mine.reels.map((r) => r.mapNumber)).toContain(1);
    expect(mine.reels.map((r) => r.mapNumber)).not.toContain(-1);
    expect(
      (await request.delete(`/api/game/cs2/recorders/${encodeURIComponent(name)}`)).status()
    ).toBe(200);
  }
);
