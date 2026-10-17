import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  getAuthHeader,
  impersonatePlayer,
  signInAsPlayerViaRequest,
  signInViaRequest,
  stopImpersonating,
} from '../helpers/auth';
import { createTeam, type Team } from '../helpers/teams';
import { createTestServer } from '../helpers/servers';
import { createAndStartTournament } from '../helpers/tournaments';

/**
 * "Your match" never picks a draft's match over a running tournament's.
 *
 * A team was still playing a running Swiss (its round-3 match in its veto)
 * when an admin drafted the final (a tournament in `setup`, not started) with
 * the team as a placeholder. The draft's round-1 match sorted first by round,
 * so the team's "your match" links sent its players to "Waiting for the
 * tournament to start" and they missed the veto (NTLAN, 2026-10-17).
 *
 * Here: a running round robin where the team's next match is past round 1, and
 * a draft with the same team. Every resolver answers with the running match;
 * a team in the draft only still gets the draft's match.
 *
 * @tag api
 * @tag regression
 */

const MAPS = [
  'de_mirage',
  'de_inferno',
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_vertigo',
  'de_nuke',
];

type ListedMatch = {
  slug: string;
  round: number;
  status: string;
  tournament_id?: number | null;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

const stamp = Date.now();
const steamIdFor = (n: number) => `7656119${String((stamp + n * 7919) % 1e10).padStart(10, '0')}`;

async function freshTeam(request: APIRequestContext, n: number): Promise<Team> {
  const players = Array.from({ length: 5 }, (_, i) => ({
    steamId: steamIdFor(n * 10 + i),
    name: `Draft Spec ${n}.${i}`,
  }));
  const team = await createTeam(request, {
    id: `yourmatch-team-${n}-${stamp}`,
    name: `YourMatch ${n} ${stamp}`,
    players,
  });
  expect(team, `creating team ${n}`).toBeTruthy();
  return team!;
}

async function matchesOf(request: APIRequestContext, tournamentId: number) {
  const res = await request.get(`/api/matches?tournamentId=${tournamentId}`, {
    headers: getAuthHeader(),
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()).matches ?? []) as ListedMatch[];
}

const plays = (m: ListedMatch, teamId: string) => m.team1?.id === teamId || m.team2?.id === teamId;

test.describe.serial('your match: a draft does not outrank a running tournament', () => {
  test.setTimeout(180_000);

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await stopImpersonating(request);
  });

  test(
    "the running tournament's match wins; a team only in the draft still gets the draft's",
    { tag: ['@api', '@regression'] },
    async ({ request, playwright, baseURL }) => {
      expect(await signInViaRequest(request)).toBe(true);
      await request.put('/api/settings', { data: { simulateMatches: false } });
      await createTestServer(request, 'yourmatch');

      const [mine, other1, other2, draftOnly] = [
        await freshTeam(request, 0),
        await freshTeam(request, 1),
        await freshTeam(request, 2),
        await freshTeam(request, 3),
      ];

      // The running tournament: a round robin, so `mine` has matches past round 1.
      const running = await createAndStartTournament(request, {
        name: `YourMatch running ${stamp}`,
        type: 'round_robin',
        format: 'bo1',
        maps: MAPS,
        teamIds: [mine.id, other1.id, other2.id],
      });
      expect(running, 'starting the running tournament').toBeTruthy();
      const runningMatches = (await matchesOf(request, running!.id))
        .filter((m) => plays(m, mine.id))
        .sort((a, b) => a.round - b.round);
      expect(runningMatches.length, 'the team plays twice').toBeGreaterThanOrEqual(2);
      // Its round-1 match is over, so its next one is round 2 or later.
      for (const m of runningMatches.filter((m) => m.round <= 1)) {
        const res = await request.post('/api/test/match-state', {
          data: { slug: m.slug, status: 'completed' },
        });
        expect(res.ok(), await res.text()).toBe(true);
      }
      const expected = runningMatches.find((m) => m.round > 1)!;
      expect(expected, 'a match past round 1').toBeTruthy();

      // The draft: same team, round 1, not started.
      const created = await request.post('/api/tournaments', {
        headers: getAuthHeader(),
        data: {
          name: `YourMatch draft ${stamp}`,
          type: 'single_elimination',
          format: 'bo1',
          maps: MAPS,
          teamIds: [mine.id, draftOnly.id],
        },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const draftId = ((await created.json()).tournament as { id: number }).id;
      expect(draftId).not.toBe(running!.id);
      const draftMatch = (await matchesOf(request, draftId)).find((m) => plays(m, mine.id));
      expect(draftMatch, "the draft's match is drawn").toBeTruthy();

      // The team page.
      const teamRes = await request.get(`/api/team/${mine.id}/match`);
      expect(teamRes.ok(), await teamRes.text()).toBe(true);
      expect((await teamRes.json()).match?.slug).toBe(expected.slug);
      const draftTeamRes = await request.get(`/api/team/${draftOnly.id}/match`);
      expect((await draftTeamRes.json()).match?.slug).toBe(draftMatch!.slug);

      // The public player page.
      const playerId = mine.players[0].steamId;
      const player = await playwright.request.newContext({ baseURL });
      expect(await signInAsPlayerViaRequest(player, playerId, mine.players[0].name)).toBe(true);
      await player.dispose();
      const current = await request.get(`/api/players/${playerId}/current-match`);
      expect(current.ok(), await current.text()).toBe(true);
      expect((await current.json()).match?.slug).toBe(expected.slug);

      // The player's own links: `/match/now` and the navbar's match status.
      try {
        expect(await impersonatePlayer(request, playerId)).toBe(true);
        const now = await request.get('/api/players/me/match-now');
        expect(now.ok(), await now.text()).toBe(true);
        expect((await now.json()).path).toBe(`/match/${encodeURIComponent(expected.slug)}`);
        const status = await request.get('/api/players/me/match-status');
        expect(status.ok(), await status.text()).toBe(true);
        expect((await status.json()).matchSlug).toBe(expected.slug);
      } finally {
        await stopImpersonating(request);
      }

      await request.delete(`/api/tournament?tournamentId=${draftId}`, { headers: getAuthHeader() });
      await request.delete('/api/tournament', { headers: getAuthHeader() });
    }
  );
});
