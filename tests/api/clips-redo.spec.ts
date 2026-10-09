import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The admin's Clips list and Redo (api/src/integrations/cs2/demos/clipsAdmin.ts):
 * a recorder takes no more of a player's moments than "clips per player per
 * map" says, even ones saved before it was lowered; each clip remembers what
 * it was made at; changing the frame rate makes it outdated; Redo puts it back
 * in the queue. The Recorders list says what a busy recorder is recording.
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

/** An imported one-map match where one player has a 4K in each of five rounds. */
async function matchWithMoments(
  request: APIRequestContext
): Promise<{ slug: string; star: string }> {
  const { slug } = (await (
    await request.post('/api/game/cs2/imports', { data: { maps: 1 } })
  ).json()) as { slug: string };
  const demo = fakeDemo('de_inferno', 2048);
  await request.put(`/api/game/cs2/imports/${slug}/maps/0?offset=0&total=${demo.length}`, {
    headers: { 'Content-Type': 'application/octet-stream' },
    data: demo,
  });
  const stamp = String(Date.now()).slice(-5);
  const a = Array.from({ length: 5 }, (_, i) => `7656119801${stamp}${i}0`);
  const b = Array.from({ length: 5 }, (_, i) => `7656119801${stamp}${i}5`);
  const players = Object.fromEntries(
    [...a, ...b].map((id, i) => [id, { name: `C${i}`, roundsPlayed: 5, kills: 4, deaths: 1 }])
  );
  const kills = [1, 2, 3, 4, 5].flatMap((round) =>
    [0, 1, 2, 3].map((k) => ({
      tick: round * 10_000 + k * 64,
      round,
      attacker: a[0],
      victim: b[k],
      attackerSide: 'CT',
      victimSide: 'T',
      weapon: 'ak47',
      headshot: false,
    }))
  );
  const analysis = {
    analyzerVersion: 7,
    map: 'de_inferno',
    rounds: [1, 2, 3, 4, 5].map((n) => ({
      number: n,
      startTick: (n - 1) * 10_000 + 5_000,
      endTick: n * 10_000 + 5_000,
      winner: 'CT',
      reason: 'ct_win',
    })),
    kills,
    players,
    teams: [
      { name: 'Clip A', startSide: 'CT', score: 5, players: a },
      { name: 'Clip B', startSide: 'T', score: 0, players: b },
    ],
  };
  const res = await request.post(`/api/game/cs2/demo-worker/jobs/${slug}/0/result`, {
    data: { worker: 'spec', analysis },
  });
  expect(res.status()).toBe(200);
  return { slug, star: a[0] };
}

const settings = (request: APIRequestContext, data: Record<string, unknown>) =>
  request.put('/api/settings', { data });

test('clips: the per-player limit, made-with, outdated and redo', TAGS, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const before = (await (await request.get('/api/settings')).json()).settings as Record<
    string,
    unknown
  >;
  try {
    // Saved with six per player, then lowered to two before any is recorded.
    await settings(request, {
      highlightsPerPlayer: 6,
      highlightsResolution: 1080,
      highlightsFps: 60,
    });
    const { slug, star } = await matchWithMoments(request);
    await settings(request, { highlightsPerPlayer: 2 });

    const name = `spec-clips-${Date.now()}`;
    const claim = () =>
      request.post('/api/game/cs2/recorder/claim', {
        data: { recorder: name, version: 7, gpu: 'Spec GPU', platform: 'linux/amd64' },
      });
    type Job = {
      kind: string;
      matchSlug: string;
      players: Array<{ playerId: string; moments: Array<{ id: number }> }>;
    };
    let job: Job | null = null;
    // Other specs' moments may be waiting too: take jobs until ours comes up.
    for (let i = 0; i < 20 && job?.matchSlug !== slug; i++) {
      const res = await claim();
      if (res.status() !== 200) break;
      job = (await res.json()).job as Job;
    }
    expect(job?.matchSlug).toBe(slug);
    const mine = job!.players.find((p) => p.playerId === star)!;
    // Five 4Ks, but only the best two are taken.
    expect(mine.moments.length).toBe(2);

    // A busy recorder says what it is recording.
    const recorder = (
      (await (await request.get('/api/game/cs2/recorders')).json()).recorders as Array<
        Record<string, unknown>
      >
    ).find((r) => r.name === name)!;
    expect(recorder.online).toBe(true);
    expect(recorder.working).toMatchObject({ matchSlug: slug, mapNumber: 0 });

    for (const m of mine.moments) {
      const up = await request.put(`/api/game/cs2/recorder/jobs/${m.id}/clip`, {
        headers: { 'Content-Type': 'video/mp4' },
        data: Buffer.from('not really a video'),
      });
      expect(up.status()).toBe(200);
    }
    type Listed = {
      current: string;
      outdated: number;
      matches: Array<{
        slug: string;
        clips: Array<{ id: number; status: string; madeWith: string | null; outdated: boolean }>;
      }>;
    };
    const list = async (outdated = false) =>
      (await (
        await request.get(`/api/game/cs2/clips${outdated ? '?outdated=1' : ''}`)
      ).json()) as Listed;
    let listed = await list();
    expect(listed.current).toBe('1080p60');
    const ours = () => listed.matches.find((m) => m.slug === slug)!;
    const done = ours().clips.filter((c) => mine.moments.some((m) => m.id === c.id));
    expect(done.map((c) => [c.status, c.madeWith, c.outdated])).toEqual([
      ['done', '1080p60', false],
      ['done', '1080p60', false],
    ]);
    // The skipped ones are not listed.
    expect(ours().clips.filter((c) => c.status === 'skipped')).toEqual([]);

    // A new frame rate makes them outdated.
    await settings(request, { highlightsFps: 120 });
    listed = await list(true);
    expect(listed.current).toBe('1080p120');
    expect(
      ours()
        .clips.filter((c) => c.outdated)
        .map((c) => c.id)
        .sort()
    ).toEqual(mine.moments.map((m) => m.id).sort());

    // Redo one: it is waiting again, the other stays done.
    const redo = await request.post('/api/game/cs2/clips/redo', {
      data: { clipIds: [mine.moments[0].id] },
    });
    expect(await redo.json()).toMatchObject({ success: true, clips: 1 });
    listed = await list();
    expect(ours().clips.find((c) => c.id === mine.moments[0].id)?.status).toBe('pending');
    expect(ours().clips.find((c) => c.id === mine.moments[1].id)?.status).toBe('done');
  } finally {
    await settings(request, {
      highlightsPerPlayer: before.highlightsPerPlayer ?? 6,
      highlightsResolution: before.highlightsResolution ?? 1080,
      highlightsFps: before.highlightsFps ?? 60,
    });
  }
});

test('reel sizes are settings with a range', TAGS, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const before = (await (await request.get('/api/settings')).json()).settings as Record<
    string,
    number
  >;
  try {
    expect(before.highlightsSeriesReelMax).toBeGreaterThanOrEqual(2);
    expect(
      (
        await settings(request, { highlightsSeriesReelMax: 24, highlightsTeamReelPerPlayer: 4 })
      ).status()
    ).toBe(200);
    const after = (await (await request.get('/api/settings')).json()).settings as Record<
      string,
      number
    >;
    expect(after).toMatchObject({ highlightsSeriesReelMax: 24, highlightsTeamReelPerPlayer: 4 });
    expect((await settings(request, { highlightsSeriesReelMax: 99 })).status()).toBe(400);
  } finally {
    await settings(request, {
      highlightsSeriesReelMax: before.highlightsSeriesReelMax,
      highlightsTeamReelPerPlayer: before.highlightsTeamReelPerPlayer,
    });
  }
});
