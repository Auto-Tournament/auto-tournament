import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The highlight recorders (api/src/integrations/cs2/demos/recorders.ts): a
 * claim registers the recorder; a clip whose frame check shows too many
 * repeated frames is turned down and its moment goes back in the queue; three
 * in a row pause the recorder until an admin resumes it; runs and benchmarks
 * are stored for the Recorders page.
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

/** An imported one-map match with five 3-kill moments for one player. */
async function matchWithMoments(request: APIRequestContext): Promise<string> {
  const { slug } = (await (
    await request.post('/api/game/cs2/imports', { data: { maps: 1 } })
  ).json()) as { slug: string };
  const demo = fakeDemo('de_dust2', 2048);
  await request.put(`/api/game/cs2/imports/${slug}/maps/0?offset=0&total=${demo.length}`, {
    headers: { 'Content-Type': 'application/octet-stream' },
    data: demo,
  });
  const stamp = String(Date.now()).slice(-5);
  const a = Array.from({ length: 5 }, (_, i) => `7656119800${stamp}${i}0`);
  const b = Array.from({ length: 5 }, (_, i) => `7656119800${stamp}${i}5`);
  const players = Object.fromEntries(
    [...a, ...b].map((id, i) => [id, { name: `P${i}`, roundsPlayed: 5, kills: 3, deaths: 1 }])
  );
  // a[0] gets three kills in each of five rounds.
  const kills = [1, 2, 3, 4, 5].flatMap((round) =>
    [0, 1, 2].map((k) => ({
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
    map: 'de_dust2',
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
      { name: 'Rec A', startSide: 'CT', score: 5, players: a },
      { name: 'Rec B', startSide: 'T', score: 0, players: b },
    ],
  };
  const res = await request.post(`/api/game/cs2/demo-worker/jobs/${slug}/0/result`, {
    data: { worker: 'spec', analysis },
  });
  expect(res.status()).toBe(200);
  return slug;
}

test(
  'recorders: frame check verdicts, pause and resume, runs and benchmark',
  TAGS,
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await matchWithMoments(request);
    const name = `spec-rec-${Date.now()}`;
    const claim = (version = 6) =>
      request.post('/api/game/cs2/recorder/claim', {
        data: { recorder: name, version, gpu: 'Spec GPU 9000', platform: 'linux/amd64 · docker' },
      });

    // A claim registers the recorder.
    const first = await claim();
    expect(first.status()).toBe(200);
    const job = (await first.json()).job as {
      kind: string;
      players: Array<{ moments: Array<{ id: number }> }>;
    };
    expect(job.kind).toBe('map');
    const ids = job.players.flatMap((p) => p.moments.map((m) => m.id));
    expect(ids.length).toBeGreaterThanOrEqual(3);

    const upload = (id: number, repeatPct: number) =>
      request.put(`/api/game/cs2/recorder/jobs/${id}/clip`, {
        headers: {
          'Content-Type': 'video/mp4',
          'X-AT-Quality': JSON.stringify({ repeatPct, jumpPct: 1, moving: 1500 }),
        },
        data: Buffer.from('not really a video'),
      });

    // A smooth clip is kept.
    expect(await (await upload(ids[0], 0.8)).json()).toMatchObject({ success: true, bytes: 18 });
    // Three stuttering clips in a row are turned down, and the recorder is paused.
    for (const id of ids.slice(1, 4)) {
      expect(await (await upload(id, 9.5)).json()).toMatchObject({ success: true, rejected: true });
    }
    const listed = async () =>
      (
        (await (await request.get('/api/game/cs2/recorders')).json()).recorders as Array<
          Record<string, unknown>
        >
      ).find((r) => r.name === name)!;
    const paused = await listed();
    expect(paused).toMatchObject({
      gpu: 'Spec GPU 9000',
      platform: 'linux/amd64 · docker',
      clipsOk: 1,
      clipsRejected: 3,
      paused: true,
    });
    expect(String(paused.pauseReason)).toContain('repeated frames');
    expect((await claim()).status()).toBe(204);

    // An admin resumes it.
    expect(
      (await request.post(`/api/game/cs2/recorders/${encodeURIComponent(name)}/resume`)).status()
    ).toBe(200);
    expect((await listed()).paused).toBe(false);

    // A run report and its log.
    expect(
      (
        await request.post('/api/game/cs2/recorder/runs', {
          data: {
            recorder: name,
            kind: 'map',
            matchSlug: 'spec',
            mapNumber: 0,
            startedAt: Math.floor(Date.now() / 1000) - 300,
            seconds: 300,
            ok: true,
            clips: 4,
            rejected: 1,
            log: 'line one\nline two\n',
          },
        })
      ).status()
    ).toBe(200);
    const runs = (
      await (await request.get(`/api/game/cs2/recorders/${encodeURIComponent(name)}/runs`)).json()
    ).runs as Array<{ id: number; clips: number; seconds: number; ok: boolean }>;
    expect(runs[0]).toMatchObject({ clips: 4, seconds: 300, ok: true });
    const logText = await (
      await request.get(`/api/game/cs2/recorder-runs/${runs[0].id}/log`)
    ).text();
    expect(logText).toContain('line two');
    expect((await listed()).avgClipSeconds).toBe(75);

    // A benchmark: the fastest smooth try wins.
    const bench = await request.post('/api/game/cs2/recorder/benchmark', {
      data: {
        recorder: name,
        tries: [
          {
            gamescopeHz: 360,
            seconds: 70,
            captureFps: 300,
            repeatPct: 12.2,
            jumpPct: 1.5,
            ok: true,
          },
          {
            gamescopeHz: 240,
            seconds: 83,
            captureFps: 230,
            repeatPct: 0.7,
            jumpPct: 1.8,
            ok: true,
          },
          {
            gamescopeHz: 120,
            seconds: 96,
            captureFps: 118,
            repeatPct: 0.4,
            jumpPct: 1.4,
            ok: true,
          },
        ],
      },
    });
    expect(await bench.json()).toMatchObject({ gamescopeHz: 240 });
    const after = await listed();
    expect(after).toMatchObject({ gamescopeHz: 240, benchmarkWanted: false });

    // Jobs now carry the pick.
    const next = await claim(6);
    if (next.status() === 200) {
      expect((await next.json()).job.settings).toEqual({ gamescopeHz: 240 });
    }

    // Forget it.
    expect(
      (await request.delete(`/api/game/cs2/recorders/${encodeURIComponent(name)}`)).status()
    ).toBe(200);
  }
);

test('recorder admin routes need an admin', TAGS, async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  expect((await anon.get('/api/game/cs2/recorders')).status()).toBe(401);
  expect((await anon.post('/api/game/cs2/recorder/runs', { data: {} })).status()).toBe(401);
  await anon.dispose();
});

test('a recorder that keeps sending clips keeps its job', TAGS, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const slug = await matchWithMoments(request);
  const a = `spec-keep-a-${Date.now()}`;
  const b = `spec-keep-b-${Date.now()}`;
  const claim = (recorder: string) =>
    request.post('/api/game/cs2/recorder/claim', { data: { recorder, version: 7 } });
  type Job = { matchSlug: string; players: Array<{ moments: Array<{ id: number }> }> };
  let job: Job | null = null;
  for (let i = 0; i < 20 && job?.matchSlug !== slug; i++) {
    const res = await claim(a);
    if (res.status() !== 200) break;
    job = (await res.json()).job as Job;
  }
  expect(job?.matchSlug).toBe(slug);
  const ids = job!.players.flatMap((p) => p.moments.map((m) => m.id));
  expect(ids.length).toBeGreaterThanOrEqual(2);

  // An hour into the job (claims go stale after 30 minutes), it sends a clip.
  const age = () =>
    request.post('/api/test/highlights/age-claims', { data: { matchSlug: slug, minutes: 60 } });
  expect((await age()).status()).toBe(200);
  const up = await request.put(`/api/game/cs2/recorder/jobs/${ids[0]}/clip`, {
    headers: { 'Content-Type': 'video/mp4' },
    data: Buffer.from('not really a video'),
  });
  expect(up.status()).toBe(200);
  // Another recorder does not take the rest of it.
  for (let i = 0; i < 20; i++) {
    const res = await claim(b);
    if (res.status() !== 200) break;
    expect(((await res.json()).job as Job).matchSlug).not.toBe(slug);
  }

  // Stale again with no clip since: now the other recorder may take it.
  expect((await age()).status()).toBe(200);
  let taken = false;
  for (let i = 0; i < 20 && !taken; i++) {
    const res = await claim(b);
    if (res.status() !== 200) break;
    taken = ((await res.json()).job as Job).matchSlug === slug;
  }
  expect(taken).toBe(true);
});
