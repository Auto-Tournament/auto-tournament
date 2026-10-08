import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The highlight recorder's routes (api/src/integrations/cs2/routes/highlights.ts).
 * The recorder itself (worker/, Go, `at-worker record`) has its own unit
 * tests; this pins the platform side: who may claim, what bad input answers,
 * and the public lists.
 */
test.describe('Highlight recorder routes', () => {
  test(
    'claiming needs a signed-in admin or an API token',
    { tag: ['@api'] },
    async ({ playwright, baseURL }) => {
      const anonymous = await playwright.request.newContext({ baseURL });
      const res = await anonymous.post('/api/game/cs2/recorder/claim', {
        data: { recorder: 'spec' },
      });
      expect(res.status()).toBe(401);
      const reel = await anonymous.put('/api/game/cs2/recorder/match-reels/m/0', {
        headers: { 'Content-Type': 'video/mp4' },
        data: Buffer.from('x'),
      });
      expect(reel.status()).toBe(401);
      await anonymous.dispose();
    }
  );

  test(
    'an admin can claim: 204, a player job or a match reel',
    { tag: ['@api'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const res = await request.post('/api/game/cs2/recorder/claim', {
        data: { recorder: 'spec' },
      });
      expect([200, 204]).toContain(res.status());
      if (res.status() !== 200) return;
      const { job } = await res.json();
      expect(['player', 'match_reel']).toContain(job.kind);
      expect(typeof job.matchSlug).toBe('string');
      expect(typeof job.watermark).toBe('boolean');
      // Hand it back so a real recorder is not left waiting on this one.
      if (job.kind === 'player') {
        expect(Array.isArray(job.moments)).toBe(true);
        await request.post('/api/game/cs2/recorder/fail', {
          data: {
            ids: job.moments.map((m: { id: number }) => m.id),
            error: 'released by the spec',
          },
        });
      } else {
        await request.post(
          `/api/game/cs2/recorder/match-reels/${encodeURIComponent(job.matchSlug)}/${job.mapNumber}/fail`,
          { data: { error: 'released by the spec' } }
        );
      }
    }
  );

  test('bad input is refused', { tag: ['@api'] }, async ({ request }) => {
    await signInViaRequest(request);
    expect(
      (await request.post('/api/game/cs2/recorder/fail', { data: { ids: [] } })).status()
    ).toBe(400);
    const notMp4 = await request.put('/api/game/cs2/recorder/reels/m/0/76561198000000001', {
      headers: { 'Content-Type': 'text/plain' },
      data: 'x',
    });
    expect(notMp4.status()).toBe(400);
    const badPlayer = await request.put('/api/game/cs2/recorder/reels/m/0/not-a-steam-id', {
      headers: { 'Content-Type': 'video/mp4' },
      data: Buffer.from('x'),
    });
    expect(badPlayer.status()).toBe(400);
    const badMap = await request.put('/api/game/cs2/recorder/match-reels/m/x', {
      headers: { 'Content-Type': 'video/mp4' },
      data: Buffer.from('x'),
    });
    expect(badMap.status()).toBe(400);
  });

  test(
    'the public lists answer empty for an unknown player or match',
    { tag: ['@api'] },
    async ({ request }) => {
      const player = await request.get('/api/game/cs2/players/76561190000000000/highlights');
      expect(player.ok()).toBe(true);
      expect(await player.json()).toMatchObject({ success: true, reels: [], highlights: [] });
      const match = await request.get('/api/game/cs2/matches/no-such-match/reels');
      expect(match.ok()).toBe(true);
      expect(await match.json()).toMatchObject({ success: true, reels: [] });
      expect((await request.get('/api/game/cs2/highlights/reel-..%2F..%2Fetc.mp4')).status()).toBe(
        404
      );
      expect((await request.get('/api/game/cs2/highlights/999999999.mp4')).status()).toBe(404);
    }
  );

  test(
    'a recorder that knows tournament reels may get one',
    { tag: ['@api'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const res = await request.post('/api/game/cs2/recorder/claim', {
        data: { recorder: 'spec', version: 3 },
      });
      expect([200, 204]).toContain(res.status());
      if (res.status() !== 200) return;
      const { job } = await res.json();
      expect(['player', 'match_reel', 'tournament_reel']).toContain(job.kind);
      if (job.kind === 'player') {
        await request.post('/api/game/cs2/recorder/fail', {
          data: {
            ids: job.moments.map((m: { id: number }) => m.id),
            error: 'released by the spec',
          },
        });
      } else {
        // Reels say where they go and where to give up.
        expect(job.upload).toMatch(/^\/api\/game\/cs2\/recorder\//);
        await request.post(job.fail, { data: { error: 'released by the spec' } });
      }
    }
  );

  test(
    'a recorder from version 4 gets a whole map, every player',
    { tag: ['@api'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const res = await request.post('/api/game/cs2/recorder/claim', {
        data: { recorder: 'spec', version: 4 },
      });
      expect([200, 204]).toContain(res.status());
      if (res.status() !== 200) return;
      const { job } = await res.json();
      expect(['map', 'match_reel', 'tournament_reel']).toContain(job.kind);
      if (job.kind === 'map') {
        expect(Array.isArray(job.players)).toBe(true);
        const ids: number[] = [];
        for (const p of job.players) {
          expect(p.matchSlug).toBe(job.matchSlug);
          expect(p.mapNumber).toBe(job.mapNumber);
          ids.push(...p.moments.map((m: { id: number }) => m.id));
        }
        await request.post('/api/game/cs2/recorder/fail', {
          data: { ids, error: 'released by the spec' },
        });
      } else {
        await request.post(job.fail, { data: { error: 'released by the spec' } });
      }
    }
  );

  test(
    'the favourite needs a signed-in player and one of their own highlights',
    { tag: ['@api'] },
    async ({ playwright, baseURL }) => {
      const anonymous = await playwright.request.newContext({ baseURL });
      const res = await anonymous.put('/api/game/cs2/players/me/highlights/favourite', {
        data: { highlightId: 1 },
      });
      expect(res.status()).toBe(401);
      await anonymous.dispose();
    }
  );

  test('tournament highlights and the watch routes', { tag: ['@api'] }, async ({ request }) => {
    const t = await request.get('/api/game/cs2/tournaments/999999/highlights');
    expect(t.ok()).toBe(true);
    expect(await t.json()).toMatchObject({ success: true, reel: null, plays: [], matches: [] });
    expect((await request.get('/api/game/cs2/tournaments/x/highlights')).status()).toBe(400);
    expect((await request.get('/api/game/cs2/watch/clip/999999999')).status()).toBe(404);
    expect(
      (await request.get('/api/game/cs2/watch/reel/no-such/0/76561190000000000')).status()
    ).toBe(404);
    expect((await request.get('/api/game/cs2/watch/match/no-such/0')).status()).toBe(404);
    expect((await request.get('/api/game/cs2/watch/tournament/999999')).status()).toBe(404);
    const player = await request.get('/api/game/cs2/players/76561190000000000/highlights?all=1');
    expect(await player.json()).toMatchObject({ success: true, favourite: null, isOwn: false });
  });

  test(
    'team reels and crowd tracks: their routes answer',
    { tag: ['@api'] },
    async ({ request }) => {
      const match = await request.get('/api/game/cs2/matches/no-such-match/reels');
      expect(await match.json()).toMatchObject({ success: true, reels: [], teams: [] });
      expect((await request.get('/api/game/cs2/watch/team/no-such-match/no-team')).status()).toBe(
        404
      );
      expect((await request.get('/api/game/cs2/highlights/team-no-such.crowd.m4a')).status()).toBe(
        404
      );
      await signInViaRequest(request);
      // A crowd track is audio, and comes after its reel.
      const notAudio = await request.put(
        '/api/game/cs2/recorder/match-reels/no-such-match/0/crowd',
        {
          headers: { 'Content-Type': 'video/mp4' },
          data: Buffer.from('x'),
        }
      );
      expect(notAudio.status()).toBe(400);
      const noReel = await request.put('/api/game/cs2/recorder/team-reels/no-such-match/t1/crowd', {
        headers: { 'Content-Type': 'audio/mp4' },
        data: Buffer.from('x'),
      });
      expect(noReel.status()).toBe(404);
      // A recorder from version 5 may get a team reel; it says where it goes.
      const res = await request.post('/api/game/cs2/recorder/claim', {
        data: { recorder: 'spec', version: 5 },
      });
      expect([200, 204]).toContain(res.status());
      if (res.status() !== 200) return;
      const { job } = await res.json();
      expect(['map', 'match_reel', 'tournament_reel', 'team_reel']).toContain(job.kind);
      if (job.kind === 'map') {
        const ids = job.players.flatMap((p: { moments: { id: number }[] }) =>
          p.moments.map((m) => m.id)
        );
        await request.post('/api/game/cs2/recorder/fail', {
          data: { ids, error: 'released by the spec' },
        });
        return;
      }
      if (job.kind === 'team_reel')
        expect(job.upload).toMatch(/^\/api\/game\/cs2\/recorder\/team-reels\//);
      await request.post(job.fail, { data: { error: 'released by the spec' } });
    }
  );
});
