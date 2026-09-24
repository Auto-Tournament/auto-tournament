import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * One match must only ever take results, configs and demos meant for it.
 *
 * On real servers the final ran on two servers at once (a queued load MAT gave
 * up on, plus the re-allocated copy). MAT applied events from both: map 0 was
 * first recorded Charlie 0-3, then overwritten with Bravo 3-1, and map_number
 * went 1 -> 0. Demos went to the wrong match too: r1m1's last demo uploaded to
 * /api/demos/r2m1/upload because the server's upload URL had been switched to
 * the next match, and after a tournament reset an old match's demo attached to
 * the new match that reused its slug.
 *
 * @tag api
 * @tag regression
 */

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
};

type ListedMatch = {
  id: number;
  slug: string;
  mapNumber?: number;
  mapResults?: Array<{ mapNumber: number; team1Score: number; team2Score: number; winnerTeam: string }>;
};

async function getMatch(request: APIRequestContext, slug: string): Promise<ListedMatch> {
  const res = await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() });
  expect(res.ok(), `GET /api/matches/${slug}`).toBe(true);
  return ((await res.json()) as { match: ListedMatch }).match;
}

async function firstRoundMatches(request: APIRequestContext): Promise<ListedMatch[]> {
  const res = await request.get('/api/matches', { headers: getAuthHeader() });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { matches: Array<ListedMatch & { round?: number }> };
  return body.matches.filter((m) => m.round === 1).sort((a, b) => a.id - b.id);
}

function mapResult(matchId: number, mapNumber: number, t1: number, t2: number, t1Series: number, t2Series: number) {
  return {
    event: 'map_result',
    matchid: matchId,
    map_number: mapNumber,
    team1: { score: t1, series_score: t1Series },
    team2: { score: t2, series_score: t2Series },
    winner: { side: '3', team: t1 > t2 ? 'team1' : 'team2' },
  };
}

test.describe.serial('Match attribution across servers', () => {
  let serverA: string;
  let serverB: string;
  let matchA: ListedMatch;
  let matchB: ListedMatch;

  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    const setup = await setupTournament(request, {
      format: 'bo3',
      teamCount: 4,
      serverCount: 2,
      prefix: 'attribution',
    });
    expect(setup, 'tournament setup should succeed').toBeTruthy();
    expect(setup!.servers.length).toBeGreaterThanOrEqual(2);
    [serverA, serverB] = [setup!.servers[0].id, setup!.servers[1].id];

    const matches = await firstRoundMatches(request);
    expect(matches.length, 'a 4-team bracket has two first-round matches').toBeGreaterThanOrEqual(2);
    [matchA, matchB] = matches;

    for (const [match, serverId] of [
      [matchA, serverA],
      [matchB, serverB],
    ] as const) {
      const set = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug: match.slug, status: 'live', serverId },
      });
      expect(set.ok()).toBe(true);
    }
  });

  test(
    'events for a match from a server it is not assigned to are ignored',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      const fromWrongServer = await request.post(`/api/events?server_id=${serverB}`, {
        headers: SERVER_HEADERS,
        data: mapResult(matchA.id, 0, 3, 13, 0, 1),
      });
      expect(fromWrongServer.status(), 'answer 200 so the plugin does not retry').toBe(200);
      expect((await fromWrongServer.json()).ignored).toBe(true);
      expect((await getMatch(request, matchA.slug)).mapResults ?? []).toHaveLength(0);

      const fromAssigned = await request.post(`/api/events?server_id=${serverA}`, {
        headers: SERVER_HEADERS,
        data: mapResult(matchA.id, 0, 13, 3, 1, 0),
      });
      expect(fromAssigned.ok()).toBe(true);
      expect((await fromAssigned.json()).ignored).toBeUndefined();

      const after = await getMatch(request, matchA.slug);
      expect(after.mapResults?.[0]?.team1Score).toBe(13);
      expect(after.mapResults?.[0]?.winnerTeam).toBe('team1');
    }
  );

  test(
    'a later event for a map already decided does not roll the series back',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      // No server identity: the guard must hold for legacy-configured servers too.
      const first = await request.post('/api/events', {
        headers: SERVER_HEADERS,
        data: mapResult(matchA.id, 0, 0, 3, 0, 1),
      });
      expect(first.ok()).toBe(true);
      expect((await getMatch(request, matchA.slug)).mapNumber).toBe(1);

      const duplicateGoingLive = await request.post('/api/events', {
        headers: SERVER_HEADERS,
        data: { event: 'going_live', matchid: matchA.id, map_number: 0, map_name: 'de_anubis' },
      });
      expect(duplicateGoingLive.ok()).toBe(true);

      const duplicateResult = await request.post('/api/events', {
        headers: SERVER_HEADERS,
        data: mapResult(matchA.id, 0, 3, 1, 1, 0),
      });
      expect(duplicateResult.ok()).toBe(true);

      const after = await getMatch(request, matchA.slug);
      expect(after.mapNumber, 'map_number must not go back to 0').toBe(1);
      const map0 = after.mapResults?.find((r) => r.mapNumber === 0);
      expect(map0?.team1Score).toBe(0);
      expect(map0?.team2Score).toBe(3);
      expect(map0?.winnerTeam).toBe('team2');
    }
  );

  test(
    'a config fetch for a load that no longer applies is refused',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      const ok = await request.get(
        `/api/matches/${matchA.slug}.json?server_id=${serverA}&match_id=${matchA.id}`
      );
      expect(ok.status()).toBe(200);

      const legacy = await request.get(`/api/matches/${matchA.slug}.json`);
      expect(legacy.status(), 'fetches without identity are still served').toBe(200);

      const otherServer = await request.get(
        `/api/matches/${matchA.slug}.json?server_id=${serverB}&match_id=${matchA.id}`
      );
      expect(otherServer.status(), 'the match moved to another server').toBe(409);

      const reusedSlug = await request.get(
        `/api/matches/${matchA.slug}.json?server_id=${serverA}&match_id=${matchA.id + 100000}`
      );
      expect(reusedSlug.status(), 'the slug now belongs to a different match').toBe(409);
    }
  );

  test(
    'a demo is stored on the match its Auto-Tournament-MatchId names, not the URL slug',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      const upload = (urlSlug: string, matchIdHeader: string, filename: string) =>
        request.post(`/api/demos/${urlSlug}/upload`, {
          headers: {
            'X-Auto-Tournament-Token': SERVER_HEADERS['X-Auto-Tournament-Token'],
            'Content-Type': 'application/octet-stream',
            'Auto-Tournament-FileName': filename,
            'Auto-Tournament-MatchId': matchIdHeader,
            'Auto-Tournament-MapNumber': '0',
            'Auto-Tournament-RoundNumber': '4',
          },
          data: Buffer.from('fake demo bytes'),
        });

      // The server's upload URL already points at matchA, but the demo is matchB's.
      const misrouted = await upload(
        matchA.slug,
        String(matchB.id),
        `2026-09-15_17-01-38_${matchB.id}_de_train_A_vs_B.dem`
      );
      expect(misrouted.ok(), await misrouted.text()).toBe(true);
      expect((await misrouted.json()).savedPath).toMatch(new RegExp(`^${matchB.slug}[/\\\\]`));

      // A demo from a match deleted by a reset must not attach to the slug's new owner.
      const deleted = await upload(matchA.slug, String(matchA.id + 100000), 'old_match.dem');
      expect(deleted.status()).toBe(410);

      // No usable id (0): the URL slug is still used.
      const noId = await upload(matchA.slug, '0', 'no_id.dem');
      expect(noId.ok()).toBe(true);
      expect((await noId.json()).savedPath).toMatch(new RegExp(`^${matchA.slug}[/\\\\]`));
    }
  );
});
