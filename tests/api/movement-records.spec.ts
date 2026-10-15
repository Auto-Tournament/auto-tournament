import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * Surf / bhop / kz records: Ready Up's movement.record runs keep each
 * player's best per map, mode and course, and the public board ranks them.
 *
 * @tag api
 */

test(
  'movement records keep the best run per player and rank the board',
  { tag: ['@api'] },
  async ({ request }) => {
    await signInViaRequest(request);
    const headers = getAuthHeader();
    const map = `surf_test_${Date.now()}`;
    const a = `7656119807${String(Date.now()).slice(-7)}`;
    const b = `7656119808${String(Date.now()).slice(-7)}`;
    const run = (steamid64: string, time_ms: number, course = 0) =>
      request.post('/api/test/fleet/movement-record', {
        headers,
        data: {
          map,
          mode: 'surf',
          course,
          steamid64,
          name: `P${steamid64.slice(-3)}`,
          time_ms,
          teleports: 0,
          finished_at: 1790000000,
        },
      });

    for (const r of [
      await run(a, 65000),
      await run(a, 61000),
      await run(a, 70000),
      await run(b, 63000),
      await run(b, 90000, 1),
    ]) {
      expect(r.ok(), await r.text()).toBe(true);
    }
    const bad = await request.post('/api/test/fleet/movement-record', {
      headers,
      data: { map, mode: 'nope' },
    });
    expect(bad.status()).toBe(400);

    const board = await (
      await request.get(`/api/game/cs2/movement/records?map=${map}&mode=surf&course=0`)
    ).json();
    expect(board.total).toBe(2);
    expect(
      board.records.map((r: { playerId: string; timeMs: number; runs: number; rank: number }) => [
        r.playerId,
        r.timeMs,
        r.runs,
        r.rank,
      ])
    ).toEqual([
      [a, 61000, 3, 1],
      [b, 63000, 1, 2],
    ]);

    const bonus = await (
      await request.get(`/api/game/cs2/movement/records?map=${map}&mode=surf&course=1`)
    ).json();
    expect(bonus.records).toHaveLength(1);

    const maps = (await (await request.get('/api/game/cs2/movement/maps')).json()).maps as Array<{
      map: string;
      courses: number[];
      players: number;
      record: { playerId: string; timeMs: number } | null;
    }>;
    const listed = maps.find((m) => m.map === map);
    expect(listed).toMatchObject({
      courses: [0, 1],
      players: 2,
      record: { playerId: a, timeMs: 61000 },
    });

    expect((await request.get('/api/game/cs2/movement/records?map=x&mode=nope')).status()).toBe(
      400
    );
  }
);
