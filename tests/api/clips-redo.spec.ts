import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { io } from 'socket.io-client';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * The admin's Clips list and Redo (api/src/integrations/cs2/demos/clipsAdmin.ts):
 * a recorder takes no more of a player's moments than "clips per player per
 * map" says, even ones saved before it was lowered; each clip remembers what
 * it was made at; changing the frame rate makes it outdated; Redo puts it back
 * in the queue. The Recorders list says what a busy recorder is recording.
 */

const TAGS = { tag: ['@api'] };
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

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

    // The match page counts the clips still being recorded.
    type Progress = { done: number; total: number; waiting: number };
    const progress = async () =>
      (
        (await (await request.get(`/api/game/cs2/matches/${slug}/highlights`)).json()) as {
          progress: Progress;
        }
      ).progress;
    const before = await progress();
    expect(before.total).toBe(2);
    expect(before.done).toBe(0);
    expect(before.waiting).toBe(2);

    // The match page is told over the socket when a clip arrives.
    const socket = io(BASE_URL, { transports: ['polling'], forceNew: true });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const told = new Promise<{ matchSlug: string }>((resolve) =>
      socket.once(`highlights:update:${slug}`, resolve)
    );
    // The clip on its own starts after its caption card's opening: its
    // markers are its clean twin's (a reel's), with where it starts.
    const twin = { duration: 12, kills: [1.6, 5, 7.5], slowmo: [8, 11], start: 2.6 };
    // The player, signed in, is told when their clip is ready.
    const starCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect(await signInAsPlayerViaRequest(starCtx, star, 'C0')).toBe(true);
    for (const m of mine.moments) {
      const up = await request.put(`/api/game/cs2/recorder/jobs/${m.id}/clip`, {
        headers: { 'Content-Type': 'video/mp4', 'X-AT-Markers': JSON.stringify(twin) },
        data: Buffer.from('not really a video'),
      });
      expect(up.status()).toBe(200);
    }
    // The notice opens the clip's own page and shows its still.
    const notices = (await (await starCtx.get('/api/social/notifications')).json()).items as Array<{
      kind: string;
      data: { highlightId?: number; url?: string; video?: string };
    }>;
    const ready = notices.find(
      (n) => n.kind === 'highlight' && n.data.highlightId === mine.moments[0].id
    );
    expect(ready?.data).toMatchObject({
      url: `/watch/clip/${mine.moments[0].id}`,
      video: `/api/game/cs2/highlights/${mine.moments[0].id}.mp4`,
    });
    await starCtx.dispose();
    expect(await told).toEqual({ matchSlug: slug });
    socket.close();
    expect(await progress()).toEqual({ done: 2, total: 2, waiting: 0 });
    const watched = async (id: number) =>
      (await (await request.get(`/api/game/cs2/watch/clip/${id}`)).json()).clip.markers;
    expect(await watched(mine.moments[0].id)).toEqual({
      duration: 9.4,
      kills: [2.4, 4.9],
      slowmo: [5.4, 8.4],
    });
    // Dressed again on its own, it says where it starts now.
    const again = await request.put(`/api/game/cs2/recorder/redress/${mine.moments[0].id}.mp4`, {
      headers: { 'Content-Type': 'video/mp4', 'X-AT-Start': '1.00' },
      data: Buffer.from('not really a video either'),
    });
    expect(again.status(), await again.text()).toBe(200);
    expect(await watched(mine.moments[0].id)).toEqual({
      duration: 11,
      kills: [0.6, 4, 6.5],
      slowmo: [7, 10],
    });
    // Its overlay recipe (JSON) is kept next to it: the app's JSON parser
    // must not leave it an empty file ("The overlay is not JSON").
    const recipe = { version: 1, name: 'C0', kills: [1.5, 2.25] };
    const overlay = await request.put(
      `/api/game/cs2/recorder/jobs/${mine.moments[0].id}/clip/overlay`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: recipe,
      }
    );
    expect(overlay.status(), await overlay.text()).toBe(200);
    expect((await overlay.json()).bytes).toBe(JSON.stringify(recipe).length);
    type Listed = {
      current: string;
      outdated: number;
      matches: Array<{
        slug: string;
        clips: Array<{
          id: number;
          status: string;
          madeWith: string | null;
          outdated: boolean;
          video: string | null;
        }>;
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
    // Each recorded clip comes with its video, to watch from the list.
    for (const c of done) {
      expect(c.video).toBeTruthy();
      expect((await request.get(`/api/game/cs2/highlights/${c.video}`)).status()).toBe(200);
    }
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
    // While it is made again, viewers keep its old video.
    const stillShown = await request.get(`/api/game/cs2/watch/clip/${mine.moments[0].id}`);
    expect((await stillShown.json()).clip.video).toBeTruthy();

    // Stopping the redo puts it back to the video it has, except in a match kept queued.
    expect(((await list()) as Listed & { queued: number }).queued).toBeGreaterThan(0);
    const stop = (keepMatchSlugs?: string[]) =>
      request.post('/api/game/cs2/clips/redo/stop', {
        data: keepMatchSlugs ? { keepMatchSlugs } : {},
      });
    await stop([slug]);
    listed = await list();
    expect(ours().clips.find((c) => c.id === mine.moments[0].id)?.status).toBe('pending');
    expect((await (await stop()).json()).clips).toBeGreaterThanOrEqual(1);
    listed = await list();
    expect(ours().clips.find((c) => c.id === mine.moments[0].id)).toMatchObject({
      status: 'done',
      madeWith: '1080p60',
      outdated: true,
    });
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

test(
  'reviewing clips: approve one, drop another (out of every reel, not recorded again)',
  TAGS,
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const { slug, star } = await matchWithMoments(request);
    const name = `spec-review-${Date.now()}`;
    type Job = {
      kind: string;
      matchSlug: string;
      players: Array<{ playerId: string; moments: Array<{ id: number }> }>;
    };
    let job: Job | null = null;
    for (let i = 0; i < 30 && job?.matchSlug !== slug; i++) {
      const res = await request.post('/api/game/cs2/recorder/claim', {
        data: { recorder: name, version: 7 },
      });
      if (res.status() !== 200) break;
      job = (await res.json()).job as Job;
      // A new recorder benchmarks first, on a clip another spec recorded: say it did.
      if (job?.kind === 'benchmark') {
        await request.post('/api/game/cs2/recorder/benchmark', {
          data: { recorder: name, tries: [] },
        });
      }
    }
    expect(job?.matchSlug).toBe(slug);
    const ids = job!.players.find((p) => p.playerId === star)!.moments.map((m) => m.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids.slice(0, 2)) {
      const up = await request.put(`/api/game/cs2/recorder/jobs/${id}/clip`, {
        headers: { 'Content-Type': 'video/mp4' },
        data: Buffer.from('not really a video'),
      });
      expect(up.status()).toBe(200);
    }
    const review = (id: number, verdict: string, note?: string) =>
      request.post(`/api/game/cs2/clips/${id}/review`, { data: { verdict, note } });
    expect((await review(ids[0], 'approved')).status()).toBe(200);
    expect((await review(ids[1], 'drop', 'wrong round')).status()).toBe(200);
    expect((await review(ids[1], 'approved')).status()).toBe(404); // dropped: not a recorded clip any more
    expect((await review(ids[0], 'maybe')).status()).toBe(400);

    const listed = (await (await request.get('/api/game/cs2/clips')).json()) as {
      matches: Array<{
        slug: string;
        clips: Array<{
          id: number;
          status: string;
          review: string | null;
          reviewNote: string | null;
        }>;
      }>;
    };
    const clips = listed.matches.find((m) => m.slug === slug)!.clips;
    expect(clips.find((c) => c.id === ids[0])).toMatchObject({
      status: 'done',
      review: 'approved',
    });
    expect(clips.find((c) => c.id === ids[1])).toMatchObject({
      status: 'skipped',
      review: 'dropped',
      reviewNote: 'wrong round',
    });
    expect(
      (await request.delete(`/api/game/cs2/recorders/${encodeURIComponent(name)}`)).status()
    ).toBe(200);
  }
);

test(
  'a clip reviewed as "weapon missing" is recorded again without TrueView',
  TAGS,
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const { slug, star } = await matchWithMoments(request);
    const name = `spec-weapon-${Date.now()}`;
    type Job = {
      kind: string;
      matchSlug: string;
      players: Array<{ playerId: string; moments: Array<{ id: number; trueView?: boolean }> }>;
    };
    // A recorder finishes its job before it gets another: the redo is
    // claimed by a second one.
    const claim = async (until: (job: Job) => boolean, recorder = name) => {
      for (let i = 0; i < 30; i++) {
        const res = await request.post('/api/game/cs2/recorder/claim', {
          data: { recorder, version: 7 },
        });
        if (res.status() !== 200) return null;
        const job = (await res.json()).job as Job;
        // A new recorder benchmarks first, on a clip another spec recorded: say it did.
        if (job?.kind === 'benchmark') {
          await request.post('/api/game/cs2/recorder/benchmark', {
            data: { recorder, tries: [] },
          });
          continue;
        }
        if (job && until(job)) return job;
      }
      return null;
    };
    const first = await claim((j) => j.matchSlug === slug);
    expect(first).not.toBeNull();
    const moment = first!.players.find((p) => p.playerId === star)!.moments[0];
    expect(moment.trueView).toBeUndefined(); // recorded with TrueView, as every clip is
    const up = await request.put(`/api/game/cs2/recorder/jobs/${moment.id}/clip`, {
      headers: { 'Content-Type': 'video/mp4' },
      data: Buffer.from('not really a video'),
    });
    expect(up.status()).toBe(200);

    const review = await request.post(`/api/game/cs2/clips/${moment.id}/review`, {
      data: { verdict: 'weapon' },
    });
    expect(review.status()).toBe(200);

    const again = await claim(
      (j) => j.players.some((p) => p.moments.some((m) => m.id === moment.id)),
      `${name}-b`
    );
    expect(again).not.toBeNull();
    const redone = again!.players.flatMap((p) => p.moments).find((m) => m.id === moment.id)!;
    expect(redone.trueView).toBe(false);
  }
);

test('a redo that fails every attempt keeps the old video', TAGS, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const { slug, star } = await matchWithMoments(request);
  const name = `spec-keep-${Date.now()}`;
  type Job = {
    kind: string;
    matchSlug: string;
    players: Array<{ playerId: string; moments: Array<{ id: number }> }>;
  };
  const claim = async (recorder: string, has: (job: Job) => boolean) => {
    for (let i = 0; i < 30; i++) {
      const res = await request.post('/api/game/cs2/recorder/claim', {
        data: { recorder, version: 7 },
      });
      if (res.status() !== 200) return null;
      const job = (await res.json()).job as Job;
      if (job?.kind === 'benchmark') {
        await request.post('/api/game/cs2/recorder/benchmark', { data: { recorder, tries: [] } });
        continue;
      }
      if (job && has(job)) return job;
    }
    return null;
  };
  const first = await claim(name, (j) => j.matchSlug === slug);
  expect(first).not.toBeNull();
  const id = first!.players.find((p) => p.playerId === star)!.moments[0].id;
  const up = await request.put(`/api/game/cs2/recorder/jobs/${id}/clip`, {
    headers: { 'Content-Type': 'video/mp4' },
    data: Buffer.from('not really a video'),
  });
  expect(up.status()).toBe(200);

  expect((await request.post('/api/game/cs2/clips/redo', { data: { clipIds: [id] } })).ok()).toBe(
    true
  );
  // Three failed attempts: a recorder holding a job gets no other, a failed
  // clip waits for the same recorder once, then avoids it.
  for (const recorder of [`${name}-b`, `${name}-b`, `${name}-c`]) {
    const job = await claim(recorder, (j) =>
      j.players.some((p) => p.moments.some((m) => m.id === id))
    );
    expect(job).not.toBeNull();
    const ids = job!.players.flatMap((p) => p.moments.map((m) => m.id));
    const fail = await request.post('/api/game/cs2/recorder/fail', {
      data: { ids, error: 'no frame near tick 1' },
    });
    expect(fail.ok()).toBe(true);
  }
  const listed = (await (await request.get('/api/game/cs2/clips')).json()) as {
    matches: Array<{
      slug: string;
      clips: Array<{ id: number; status: string; video: string | null }>;
    }>;
  };
  const clip = listed.matches.find((m) => m.slug === slug)!.clips.find((c) => c.id === id)!;
  expect(clip.status).toBe('done');
  expect(clip.video).toBeTruthy();
});

test(
  'a failed clip holds its reels, and the Clips list says so until it is redone',
  TAGS,
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const { slug } = await matchWithMoments(request);
    type Listed = {
      matches: Array<{
        slug: string;
        failedClips: number;
        clips: Array<{ id: number; kind: string }>;
      }>;
    };
    const ours = async () =>
      ((await (await request.get('/api/game/cs2/clips')).json()) as Listed).matches.find(
        (m) => m.slug === slug
      )!;
    const before = await ours();
    expect(before.failedClips).toBe(0);
    const clip = before.clips.find((c) => c.kind !== 'funny')!;

    // A recorder failed it: the match says its reels wait.
    expect(
      (
        await request.post('/api/test/highlights/status', {
          data: { ids: [clip.id], status: 'failed' },
        })
      ).ok()
    ).toBe(true);
    expect((await ours()).failedClips).toBe(1);

    // Redone: it is waiting to be recorded again, and nothing is held by a failure.
    const redo = await request.post('/api/game/cs2/clips/redo', { data: { clipIds: [clip.id] } });
    expect(redo.ok(), await redo.text()).toBe(true);
    expect((await ours()).failedClips).toBe(0);
  }
);
