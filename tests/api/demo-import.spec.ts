import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Importing a match from its demos (api/src/integrations/cs2/demos/demoImport.ts):
 * the match is created, each demo arrives in pieces and is linked to its map,
 * and the worker's analysis (here posted as the worker would) fills in the
 * teams, players, each map's score and the winner, and picks the highlights.
 */

const TAGS = { tag: ['@api'] };

/** A CS2 demo's first bytes: the preamble, then a file header naming `map`. */
function fakeDemo(map: string, size: number): Buffer {
  const name = Buffer.from(map);
  const header = Buffer.concat([Buffer.from([0x2a, name.length]), name]); // field 5, length-delimited
  const command = Buffer.from([0x01, 0x00, header.length]); // DEM_FileHeader, tick 0, size
  const head = Buffer.concat([
    Buffer.from('PBDEMS2\0', 'latin1'),
    Buffer.alloc(8),
    command,
    header,
  ]);
  return Buffer.concat([head, Buffer.alloc(size - head.length, 7)]);
}

const sid = (n: number) => `7656119900${String(Date.now()).slice(-5)}${String(n).padStart(2, '0')}`;

test(
  'a match imported from its demos gets its teams, players and score',
  TAGS,
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);

    expect((await request.post('/api/game/cs2/imports', { data: { maps: 0 } })).status()).toBe(400);
    const created = await request.post('/api/game/cs2/imports', {
      data: { maps: 2, event: 'Spec Cup' },
    });
    expect(created.status()).toBe(201);
    const { slug } = (await created.json()) as { slug: string };

    // Not a demo, and a piece out of order, are refused.
    const put = (map: number, offset: number, total: number, body: Buffer) =>
      request.put(`/api/game/cs2/imports/${slug}/maps/${map}?offset=${offset}&total=${total}`, {
        headers: { 'Content-Type': 'application/octet-stream' },
        data: body,
      });
    expect((await put(0, 0, 4096, Buffer.alloc(4096, 1))).status()).toBe(400);
    expect((await put(0, 2048, 4096, Buffer.alloc(2048, 1))).status()).toBe(409);
    expect((await put(2, 0, 4096, fakeDemo('de_nuke', 4096))).status()).toBe(400);

    // Two maps, the first in two pieces.
    const first = fakeDemo('de_cache', 6000);
    const part = await put(0, 0, first.length, first.subarray(0, 4000));
    expect(await part.json()).toMatchObject({ received: 4000, done: false });
    const last = await put(0, 4000, first.length, first.subarray(4000));
    expect(await last.json()).toMatchObject({ done: true, map: 'de_cache' });
    const second = fakeDemo('de_inferno', 3000);
    expect(await (await put(1, 0, second.length, second)).json()).toMatchObject({
      map: 'de_inferno',
    });

    const status = await request.get(`/api/game/cs2/imports/${slug}`);
    const before = (await status.json()).import;
    expect(before.maps.map((m: { map: string; uploaded: boolean }) => [m.map, m.uploaded])).toEqual(
      [
        ['de_cache', true],
        ['de_inferno', true],
      ]
    );

    // The worker's analysis of each map, as it would post it.
    const alpha = [sid(1), sid(2)];
    const bravo = [sid(3), sid(4)];
    const stats = (name: string) => ({
      name,
      roundsPlayed: 3,
      kills: 3,
      deaths: 1,
      assists: 0,
      damage: 300,
    });
    const players = Object.fromEntries([
      ...alpha.map((id, i) => [id, stats(`Alpha ${i}`)]),
      ...bravo.map((id, i) => [id, stats(`Bravo ${i}`)]),
    ]);
    const kills = (killers: string[], victims: string[]) =>
      [1, 2, 3].map((round, i) => ({
        tick: 1000 * round,
        round,
        attacker: killers[i % killers.length],
        victim: victims[i % victims.length],
        attackerSide: 'CT',
        victimSide: 'T',
        weapon: 'ak47',
        headshot: true,
      }));
    const analysis = (map: string, teams: unknown[], rounds: number) => ({
      analyzerVersion: 7,
      map,
      rounds: Array.from({ length: rounds }, (_, i) => ({
        number: i + 1,
        startTick: i * 1000,
        endTick: (i + 1) * 1000 + 500,
        winner: 'CT',
        reason: 'ct_win',
      })),
      kills: kills(alpha, bravo),
      players,
      teams,
    });
    const result = (map: number, body: unknown) =>
      request.post(`/api/game/cs2/demo-worker/jobs/${slug}/${map}/result`, {
        data: { worker: 'spec', analysis: body },
      });
    // Map 1: Alpha started CT and won 16-13.
    expect(
      (
        await result(
          0,
          analysis(
            'de_cache',
            [
              { name: 'Alpha Spec', startSide: 'CT', score: 16, players: alpha },
              { name: 'Bravo Spec', startSide: 'T', score: 13, players: bravo },
            ],
            3
          )
        )
      ).status()
    ).toBe(200);
    // Map 2: Bravo started CT, Alpha still won; team 1 stays Alpha.
    expect(
      (
        await result(
          1,
          analysis(
            'de_inferno',
            [
              { name: 'Bravo Spec', startSide: 'CT', score: 3, players: bravo },
              { name: 'Alpha Spec', startSide: 'T', score: 13, players: alpha },
            ],
            3
          )
        )
      ).status()
    ).toBe(200);

    const done = (await (await request.get(`/api/game/cs2/imports/${slug}`)).json()).import;
    expect(done.team1).toBe('Alpha Spec');
    expect(done.team2).toBe('Bravo Spec');
    expect(
      done.maps.map((m: { team1Score: number; team2Score: number }) => [m.team1Score, m.team2Score])
    ).toEqual([
      [16, 13],
      [13, 3],
    ]);

    const match = (await (await request.get(`/api/matches/${slug}`)).json()).match;
    expect(match.status).toBe('completed');
    expect(match.winnerSide).toBe('team1');
    expect(match.team1.name).toBe('Alpha Spec');

    // The players are on the platform now, and the match is in the played list as imported.
    const player = await request.get(`/api/players/${alpha[0]}`);
    expect(player.status()).toBe(200);
    // Under the name they play under in the demo, not their Steam name.
    expect(JSON.stringify(await player.json())).toContain(`"name":"${players[alpha[0]].name}"`);
    const played = (await (await request.get('/api/matches/played')).json()).matches as Array<{
      slug: string;
      kind: string;
      tournamentName: string | null;
    }>;
    expect(played.find((m) => m.slug === slug)).toMatchObject({
      kind: 'imported',
      tournamentName: 'Spec Cup',
    });
  }
);
