import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * Reports from a server with no match must not land on a match it played before.
 *
 * `POST /api/events/report` fell back to any match with the report's server id,
 * whatever its status, and a report from an idle server that still named its
 * last match was applied to that completed match. Only the match currently
 * running on the server (loaded/live) may take a report without a match id, and
 * a report with phase `idle` is never applied. Pure rules: match-report-target.spec.ts.
 *
 * @tag api
 * @tag regression
 */

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
};

type ListedMatch = { id: number; slug: string; round?: number };

function report(phase: string, matchId: number, steamId: string) {
  return {
    match: {
      matchId,
      phase,
      map: { name: 'de_mirage', index: 0, number: 1, total: 1, round: 3 },
      score: { team1: 2, team2: 1, series: { team1: 0, team2: 0 } },
    },
    connections: [{ steamId, name: 'Report Probe', slot: 'team1', connectedAt: 1789549538 }],
  };
}

async function postReport(
  request: APIRequestContext,
  body: { serverId: string; matchSlug?: string; report: unknown }
): Promise<{ status: number; body: { success?: boolean; ignored?: boolean; message?: string } }> {
  const res = await request.post('/api/events/report', { headers: SERVER_HEADERS, data: body });
  return { status: res.status(), body: await res.json() };
}

async function connectedSteamIds(request: APIRequestContext, slug: string): Promise<string[]> {
  const res = await request.get(`/api/events/connections/${slug}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { connectedPlayers?: Array<{ steamId: string }> };
  return (body.connectedPlayers ?? []).map((p) => p.steamId);
}

async function setState(request: APIRequestContext, slug: string, status: string, serverId: string) {
  const res = await request.post('/api/test/match-state', {
    headers: getAuthHeader(),
    data: { slug, status, serverId },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

test.describe.serial('Reports from an idle server', () => {
  let serverId: string;
  let match: ListedMatch;

  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    const setup = await setupTournament(request, { teamCount: 2, serverCount: 1, prefix: 'idlereport' });
    expect(setup, 'tournament setup should succeed').toBeTruthy();
    serverId = setup!.servers[0].id;

    const res = await request.get('/api/matches', { headers: getAuthHeader() });
    expect(res.ok()).toBe(true);
    const { matches } = (await res.json()) as { matches: ListedMatch[] };
    expect(matches.length).toBeGreaterThanOrEqual(1);
    match = matches.sort((a, b) => a.id - b.id)[0];
  });

  test(
    'a report without a match id is not applied to a completed match on that server',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await setState(request, match.slug, 'completed', serverId);
      const steamId = `7656119${Date.now()}`.slice(0, 17);

      const res = await postReport(request, { serverId, report: report('warmup', -1, steamId) });
      expect(res.status, 'answer 200 so the plugin does not retry').toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(await connectedSteamIds(request, match.slug)).not.toContain(steamId);
    }
  );

  test(
    'an idle report naming the previous match is ignored',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await setState(request, match.slug, 'completed', serverId);
      const steamId = `7656118${Date.now()}`.slice(0, 17);

      const byId = await postReport(request, {
        serverId,
        matchSlug: String(match.id),
        report: report('idle', -1, steamId),
      });
      expect(byId.status).toBe(200);
      expect(byId.body.ignored).toBe(true);
      expect(await connectedSteamIds(request, match.slug)).not.toContain(steamId);
    }
  );

  test(
    'the live match on the server still takes reports, with or without a match id',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await setState(request, match.slug, 'live', serverId);
      const steamId = `7656117${Date.now()}`.slice(0, 17);

      const fallback = await postReport(request, { serverId, report: report('live', match.id, steamId) });
      expect(fallback.status).toBe(200);
      expect(fallback.body.ignored).toBeUndefined();
      expect(await connectedSteamIds(request, match.slug)).toContain(steamId);

      const named = await postReport(request, {
        serverId,
        matchSlug: match.slug,
        report: report('live', match.id, steamId),
      });
      expect(named.status).toBe(200);
      expect(named.body.ignored).toBeUndefined();
    }
  );
});
