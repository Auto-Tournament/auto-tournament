import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  getAuthHeader,
  impersonatePlayer,
  signInViaRequest,
  stopImpersonating,
} from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';
import { createTeam, type Team } from '../helpers/teams';
import { executeVetoAction, getVetoState } from '../helpers/veto';

/**
 * One player in two tournaments at once (Vikunja 2180): a 2v2 and a 5v5
 * running side by side at a LAN, the player on a team in each. Each match's
 * veto takes that player for the side of the team that plays in it, the
 * other teams' players veto too, and the match room's "your match" of a team
 * in both tournaments answers with the match it is asked about.
 *
 * @tag api
 * @tag veto
 */

const MAPS = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_vertigo',
];

const as = (id: number) => ({ ...getAuthHeader(), 'X-Tournament-Id': String(id) });

const stamp = String(Date.now()).slice(-7);
let next = 0;
const steamId = () => `7656119${String(next++).padStart(3, '0')}${stamp}`;
const roster = (label: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ steamId: steamId(), name: `${label} ${i + 1}` }));

async function startTournament(
  request: APIRequestContext,
  name: string,
  teamIds: string[]
): Promise<number> {
  const created = await request.post('/api/tournaments', {
    headers: getAuthHeader(),
    data: { name, type: 'single_elimination', format: 'bo1', maps: MAPS, teamIds },
  });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const id = (await created.json()).tournament.id as number;
  const started = await request.post('/api/tournament/start', { headers: as(id) });
  expect(started.ok(), await started.text()).toBe(true);
  return id;
}

async function matchSlug(request: APIRequestContext, id: number, a: Team, b: Team) {
  const res = await request.get('/api/matches', { headers: as(id) });
  expect(res.ok(), await res.text()).toBe(true);
  const match = ((await res.json()).matches as Array<Record<string, any>>).find(
    (m) =>
      [m.team1?.id ?? m.team1_id, m.team2?.id ?? m.team2_id].sort().join() ===
      [a.id, b.id].sort().join()
  );
  expect(match, `no match for ${a.id} vs ${b.id} in tournament ${id}`).toBeTruthy();
  return match!.slug as string;
}

/** The side of `slug` whose turn it is, and a map still in play. */
async function turnOf(request: APIRequestContext, slug: string, actAs: string) {
  const veto = await getVetoState(request, slug, actAs);
  expect(veto, `${actAs} should read ${slug}'s full veto`).toBeTruthy();
  return { team: veto.currentTurn as 'team1' | 'team2', map: veto.availableMaps[0] as string };
}

const created: number[] = [];

test.describe.serial('A player in two tournaments at once', () => {
  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await stopImpersonating(request);
    for (const id of created) await request.delete('/api/tournament', { headers: as(id) });
  });

  test(
    'vetoes each match for the team that plays in it, and so do the others',
    { tag: ['@api', '@veto'] },
    async ({ request }) => {
      await signInViaRequest(request);
      expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);

      const shared = { steamId: steamId(), name: 'Both Cups' };
      const make = async (key: string, players: Array<{ steamId: string; name: string }>) => {
        const team = await createTeam(request, {
          id: `two-cups-${key}-${stamp}`,
          name: `Two Cups ${key.toUpperCase()} ${stamp}`,
          players,
        });
        expect(team, `team ${key}`).toBeTruthy();
        return team!;
      };
      // The 2v2: duo (with the shared player) against pair. The 5v5: five (with
      // the shared player) against stack.
      const duo = await make('duo', [shared, ...roster('Duo', 1)]);
      const pair = await make('pair', roster('Pair', 2));
      const five = await make('five', [shared, ...roster('Five', 4)]);
      const stack = await make('stack', roster('Stack', 5));

      const cup2 = await startTournament(request, `Two Cups 2v2 ${stamp}`, [duo.id, pair.id]);
      created.push(cup2);
      const cup5 = await startTournament(request, `Two Cups 5v5 ${stamp}`, [five.id, stack.id]);
      created.push(cup5);

      // The duo also plays a second 2v2 at the same time.
      const rivals = await make('rivals', roster('Rivals', 2));
      const cupB = await startTournament(request, `Two Cups 2v2 B ${stamp}`, [duo.id, rivals.id]);
      created.push(cupB);

      const slug2 = await matchSlug(request, cup2, duo, pair);
      const slug5 = await matchSlug(request, cup5, five, stack);
      const slugB = await matchSlug(request, cupB, duo, rivals);

      // A team in two tournaments has two open matches: the match room asks for
      // its own, and gets it (the room of the other showed no veto at all).
      for (const slug of [slug2, slugB]) {
        const res = await request.get(
          `/api/team/${duo.id}/match?match=${encodeURIComponent(slug)}`
        );
        expect(res.ok(), await res.text()).toBe(true);
        const body = await res.json();
        expect(body.hasMatch).toBe(true);
        expect(body.match.slug, `duo's match asked for as ${slug}`).toBe(slug);
      }
      // Without one, still one of the team's open matches.
      const any = await (await request.get(`/api/team/${duo.id}/match`)).json();
      expect([slug2, slugB]).toContain(any.match?.slug);

      // The match page names the viewer's team in each match.
      for (const [slug, team] of [
        [slug2, duo],
        [slug5, five],
      ] as const) {
        expect(await impersonatePlayer(request, shared.steamId)).toBe(true);
        const page = await (await request.get(`/api/matches/${slug}`)).json();
        expect(page.match.viewerTeamId, `viewer's team in ${slug}`).toBe(team.id);
        // The match room's "your match" is this match, though the team's
        // player also has the other tournament's match open.
        const mine = await (
          await request.get(`/api/team/${team.id}/match?match=${encodeURIComponent(slug)}`)
        ).json();
        expect(mine.hasMatch).toBe(true);
        expect(mine.match.slug).toBe(slug);
        await stopImpersonating(request);
      }

      // Each match, step by step until both teams have acted: the shared player
      // for the side their team is on, the opponents' player for the other.
      for (const [slug, mineTeam, mineFirst, theirsFirst] of [
        [slug2, duo, shared.steamId, pair.players[0].steamId],
        [slug5, five, shared.steamId, stack.players[0].steamId],
      ] as const) {
        const page = await (
          await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() })
        ).json();
        const sharedSide =
          (page.match.team1?.id ?? page.match.team1_id) === mineTeam.id ? 'team1' : 'team2';
        const acted = new Set<string>();
        for (let step = 0; step < 4 && acted.size < 2; step++) {
          const turn = await turnOf(request, slug, mineFirst);
          const actor = turn.team === sharedSide ? mineFirst : theirsFirst;
          const done = await executeVetoAction(request, slug, {
            mapName: turn.map,
            teamSlug: turn.team,
            actAsSteamId: actor,
          });
          await stopImpersonating(request);
          expect(done, `${actor} bans ${turn.map} in ${slug} for ${turn.team}`).toBeTruthy();
          acted.add(turn.team);
        }
        expect(acted.size, `both sides of ${slug} vetoed`).toBe(2);

        // And out of turn the shared player is refused as the side they are on,
        // not as "on both teams".
        const turn = await turnOf(request, slug, mineFirst);
        if (turn.team !== sharedSide) {
          expect(await impersonatePlayer(request, mineFirst)).toBe(true);
          const refused = await request.post(`/api/veto/${slug}/action`, {
            data: { mapName: turn.map },
          });
          await stopImpersonating(request);
          expect(refused.status()).toBe(403);
          expect(await refused.text()).toContain('not your turn');
        }
      }

      // Neither match is stuck on the other's state.
      const a = await getVetoState(request, slug2, shared.steamId);
      const b = await getVetoState(request, slug5, shared.steamId);
      expect(a.bannedMaps.length).toBeGreaterThan(0);
      expect(b.bannedMaps.length).toBeGreaterThan(0);
    }
  );
});
