import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * A match that has been played but not settled still belongs to the team
 * (3.0 phase D, PR D8).
 *
 * `GET /api/team/:teamId/match` answered with a **live or upcoming** match and
 * nothing else, so a match parked at `needs_decision` fell out of both queries
 * and the page said `hasMatch: false`. Two ways that is wrong, one per game:
 *
 * - **Manual reporting.** A dispute parks the match, so on a fresh page load
 *   the two captains staring at an open argument were told they had no match,
 *   and the report panel had no slug to render against (D7 shipped with this
 *   as a known hole). Everyone who already had the page open kept it, through
 *   the socket event — which is exactly the kind of bug that survives a demo.
 * - **CS2.** A series that runs out of maps level is parked the same way, and
 *   the team page told both sides "no match right now" while an admin was
 *   still deciding who won it.
 *
 * So this covers both games, and pins the **order** as well as the presence:
 * a played-but-unsettled match outranks one that has not started (the team has
 * nothing to do about the next one yet), and a live match outranks it in turn.
 *
 * @tag api
 * @tag regression
 */

const MR = '/api/test/integration/manual-report';
const API = '/api/game/manual';

type TeamMatchResponse = {
  hasMatch: boolean;
  match?: { slug: string; status: string; opponent?: { name?: string | null } | null } | null;
  tournamentStatus?: string;
};

type ListedMatch = {
  slug: string;
  round: number;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

async function teamMatch(request: APIRequestContext, teamId: string): Promise<TeamMatchResponse> {
  const res = await request.get(`/api/team/${teamId}/match`);
  expect(res.status(), `reading ${teamId}'s match: ${await res.text()}`).toBe(200);
  return (await res.json()) as TeamMatchResponse;
}

/** Put a match into a status directly, the way the Manage spec does. */
async function forceStatus(request: APIRequestContext, slug: string, status: string) {
  const res = await request.post('/api/test/match-state', { data: { slug, status } });
  expect(res.ok(), `forcing ${slug} to ${status}: ${await res.text()}`).toBe(true);
}

test.describe.serial('A played but unsettled match on the team page', () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/tournament');
  });

  test(
    'CS2: a series parked level is the team\'s current match, and a live one still outranks it',
    { tag: ['@api', '@regression'] },
    async ({ request, baseURL }) => {
      // Round robin, so one team has more than one match and the ordering
      // between them is a real question rather than a hypothetical.
      const setup = await setupTournament(request, {
        type: 'round_robin',
        format: 'bo1',
        teamCount: 3,
        serverCount: 1,
        prefix: 'nd-cs2',
        webhookUrl: baseURL ?? 'http://localhost:3069',
      });
      expect(setup, 'the CS2 tournament should be set up').toBeTruthy();
      const [one, two, three] = setup!.teams;

      const parked = await findMatchByTeams(request, one.id, two.id);
      const other = await findMatchByTeams(request, one.id, three.id);
      expect(parked?.slug, 'team one should play team two').toBeTruthy();
      expect(other?.slug, 'team one should play team three').toBeTruthy();

      // Before: the match is pending like everything else, so the page shows
      // whichever is next. This is the baseline the change must not move.
      const upcoming = await teamMatch(request, one.id);
      expect(upcoming.hasMatch, 'a pending match is still a match').toBe(true);

      await forceStatus(request, parked!.slug, 'needs_decision');

      const now = await teamMatch(request, one.id);
      expect(now.hasMatch, 'a parked match must not read as "no match"').toBe(true);
      expect(now.match?.slug, 'the parked match outranks the one not yet played').toBe(parked!.slug);
      expect(now.match?.status).toBe('needs_decision');
      // The page draws "TEAM vs OPPONENT" off this, so a parked match that
      // arrives without an opponent would render as a broken card.
      expect(now.match?.opponent?.name, 'the card needs an opponent to name').toBeTruthy();

      // And a match actually being played still comes first: a team on a
      // server has somewhere to be, whatever an admin is deciding elsewhere.
      await forceStatus(request, other!.slug, 'live');
      const live = await teamMatch(request, one.id);
      expect(live.match?.slug, 'a live match outranks a parked one').toBe(other!.slug);
      expect(live.match?.status).toBe('live');

      // The opponent of the parked match sees it too — this is not a
      // property of team1 in particular.
      await forceStatus(request, other!.slug, 'pending');
      expect((await teamMatch(request, two.id)).match?.slug).toBe(parked!.slug);
    }
  );

  test(
    'manual reporting: a disputed match is still there after a reload',
    { tag: ['@api', '@regression'] },
    async ({ request, playwright, baseURL }) => {
      const stamp = `${Date.now()}`.slice(-7);
      const teamIds: string[] = [];
      const captains = new Map<string, string>();
      for (let index = 0; index < 2; index++) {
        const id = `nd-mr-${stamp}-${index}`;
        const captain = `76561199${stamp}${index}0`;
        const created = await request.post('/api/teams', {
          data: {
            id,
            name: `Needs decision ${stamp} ${index}`,
            players: [
              { steamId: captain, name: `nd ${index} captain` },
              { steamId: `76561199${stamp}${index}1`, name: `nd ${index}.1` },
            ],
          },
        });
        expect(created.ok(), `creating team ${id}: ${await created.text()}`).toBe(true);
        teamIds.push(id);
        captains.set(id, captain);
      }

      const tournament = await request.post(`${MR}/tournament`, {
        data: {
          name: 'Disputed and reloaded',
          type: 'single_elimination',
          format: 'bo1',
          game: 'rocket-league',
          teamIds,
          settings: { manualReport: { confirmation: 'opponent', confirmTimeoutMin: 60 } },
        },
      });
      expect(tournament.status(), `creating: ${await tournament.text()}`).toBe(200);

      // Both captains, through the real admin route.
      for (const teamId of teamIds) {
        const members = await request.get(`${API}/teams/${teamId}/members`);
        expect(members.status(), await members.text()).toBe(200);
        const list = ((await members.json()) as {
          members: Array<{ accountUid: string; playerId: string | null }>;
        }).members;
        const uid = list.find((m) => m.playerId === captains.get(teamId))?.accountUid;
        expect(uid, `${teamId} should have its captain in the membership mirror`).toBeTruthy();
        const promoted = await request.post(`${API}/teams/${teamId}/captain`, { data: { uid } });
        expect(promoted.status(), await promoted.text()).toBe(200);
      }

      const started = await request.post('/api/tournament/start', { data: {} });
      expect(started.ok(), `starting: ${await started.text()}`).toBe(true);

      let live: ListedMatch[] = [];
      await expect
        .poll(
          async () => {
            const res = await request.get('/api/matches');
            const all = ((await res.json()) as { matches?: ListedMatch[] }).matches ?? [];
            live = all.filter((m) => m.round >= 1 && m.team1 && m.team2 && m.status === 'live');
            return live.length;
          },
          { message: 'the first round should go live', timeout: 30_000 }
        )
        .toBe(1);
      const match = live[0];

      const reporter = await playwright.request.newContext({ baseURL });
      const opponent = await playwright.request.newContext({ baseURL });
      try {
        expect(await signInAsPlayerViaRequest(reporter, captains.get(match.team1!.id)!)).toBe(true);
        expect(await signInAsPlayerViaRequest(opponent, captains.get(match.team2!.id)!)).toBe(true);

        const reported = await reporter.post(`${API}/matches/${match.slug}/report`, {
          data: { result: { maps: [{ team1Score: 3, team2Score: 1 }] } },
        });
        expect(reported.status(), await reported.text()).toBe(200);

        const disputed = await opponent.post(`${API}/matches/${match.slug}/dispute`, {
          data: { revision: 1, reason: 'That was our goal' },
        });
        expect(disputed.status(), await disputed.text()).toBe(200);

        // The whole point: a *fresh* read, with no socket event to rely on.
        // This is what a reloaded team page asks for, and what decides whether
        // the report panel gets a slug at all.
        for (const teamId of teamIds) {
          const answer = await teamMatch(reporter, teamId);
          expect(answer.hasMatch, `${teamId} should still have this match`).toBe(true);
          expect(answer.match?.slug).toBe(match.slug);
          expect(answer.match?.status).toBe('needs_decision');
        }

        // Once an admin settles it the match is over, and the page goes back
        // to having nothing current — the fix does not strand a decided match
        // on the page forever.
        const resolved = await request.post(`${API}/matches/${match.slug}/resolve`, {
          data: { result: { maps: [{ team1Score: 1, team2Score: 3 }] } },
        });
        expect(resolved.status(), await resolved.text()).toBe(200);
        await expect
          .poll(async () => (await teamMatch(reporter, teamIds[0])).match?.status ?? 'gone', {
            message: 'a settled match leaves the current-match slot',
            timeout: 15_000,
          })
          .not.toBe('needs_decision');
      } finally {
        await reporter.dispose();
        await opponent.dispose();
      }
    }
  );
});
