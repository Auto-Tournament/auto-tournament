import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Match lineups (services/matchLineups.ts, docs/design/match-lineups.md): a
 * team bigger than the team size (five players in a 2v2) picks who plays each
 * match. The owner or a captain picks; a team with neither lets any member;
 * an admin sets either team's. The match config and the Ready Up assign
 * config carry the lineup as the team; the bench is not on the server at all
 * (not even as spectators: they watch GOTV, no ghosting).
 *
 * @tag api
 * @tag tournament
 */

let counter = 0;
function steamId(): string {
  counter += 1;
  return `7656119${String(Date.now()).slice(-7)}${String(counter).padStart(3, '0')}`;
}

interface TeamLineup {
  side: 'team1' | 'team2';
  teamId: string;
  size: number;
  pool: Array<{ steamId: string }>;
  players: string[];
  source: string;
  canEdit: boolean;
}

async function lineups(ctx: APIRequestContext, slug: string) {
  const res = await ctx.get(`/api/match-lineups/${slug}`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { open: boolean; teams: TeamLineup[] };
}

test.describe('Match lineups', () => {
  test(
    'a captain picks the lineup, others cannot, an admin overrides, the server gets the lineup',
    { tag: ['@api', '@tournament'] },
    async ({ request, playwright, baseURL }) => {
      expect(await signInViaRequest(request)).toBe(true);
      const headers = getAuthHeader();
      await request.delete('/api/tournament', { headers });

      // Team A: a player's own team (they own it), five players.
      const owner = await playwright.request.newContext({ baseURL });
      const ownerId = steamId();
      const mates = [steamId(), steamId(), steamId(), steamId()];
      expect(await signInAsPlayerViaRequest(owner, ownerId, `Owner ${ownerId.slice(-4)}`)).toBe(
        true
      );
      const created = await owner.post('/api/team-directory/mine', {
        data: { name: `Lineup ${ownerId.slice(-5)}`, tag: 'LU' },
      });
      expect(created.status(), await created.text()).toBe(201);
      const teamA = (await created.json()).team as { id: string };
      const rosterA = await request.put(`/api/teams/${teamA.id}`, {
        headers,
        data: {
          players: [
            { steamId: ownerId, name: 'Owner' },
            ...mates.map((m, i) => ({ steamId: m, name: `Mate ${i + 1}` })),
          ],
        },
      });
      expect(rosterA.ok(), await rosterA.text()).toBe(true);

      // Team B: an admin's team with three players and no captain.
      const bIds = [steamId(), steamId(), steamId()];
      const teamB = {
        id: `lineup-b-${Date.now()}`,
        name: 'Lineup B',
        players: bIds.map((id, i) => ({ steamId: id, name: `B ${i + 1}` })),
      };
      expect((await request.post('/api/teams', { headers, data: teamB })).ok()).toBe(true);

      const tournament = await request.post('/api/tournament', {
        headers,
        data: {
          name: `Lineups ${Date.now()}`,
          type: 'single_elimination',
          format: 'bo1',
          teamSize: 2,
          maps: ['de_mirage'],
          teamIds: [teamA.id, teamB.id],
          settings: { cs2: { veto: false } },
        },
      });
      expect(tournament.ok(), await tournament.text()).toBe(true);
      const { matches } = await (await request.get('/api/matches', { headers })).json();
      const match = matches.find((m: { round: number }) => m.round === 1);
      expect(match).toBeTruthy();
      const slug = match.slug as string;

      // The default: the first two of each roster. The owner may edit A, not B.
      const first = await lineups(owner, slug);
      expect(first.open).toBe(true);
      const a = first.teams.find((t) => t.teamId === teamA.id)!;
      const b = first.teams.find((t) => t.teamId === teamB.id)!;
      expect(a.size).toBe(2);
      expect(a.pool).toHaveLength(5);
      expect(a.players).toEqual([ownerId, mates[0]]);
      expect(a.source).toBe('roster');
      expect(a.canEdit).toBe(true);
      expect(b.canEdit).toBe(false);
      expect(b.players).toEqual([bIds[0], bIds[1]]);

      // Not on the team: refused. A member of a team that has an owner: refused.
      const outsider = await playwright.request.newContext({ baseURL });
      expect(await signInAsPlayerViaRequest(outsider, steamId(), 'Outsider')).toBe(true);
      const notMember = await outsider.put(`/api/match-lineups/${slug}/${a.side}`, {
        data: { players: [mates[2], mates[3]] },
      });
      expect(notMember.status()).toBe(403);
      const mate = await playwright.request.newContext({ baseURL });
      expect(await signInAsPlayerViaRequest(mate, mates[0], 'Mate 1')).toBe(true);
      const notCaptain = await mate.put(`/api/match-lineups/${slug}/${a.side}`, {
        data: { players: [mates[2], mates[3]] },
      });
      expect(notCaptain.status()).toBe(403);
      // Pretending to be an admin does not help.
      const fakeAdmin = await outsider.put(`/api/match-lineups/${slug}/${a.side}`, {
        data: { players: [mates[2], mates[3]], asAdmin: true },
      });
      expect(fakeAdmin.status()).toBe(403);

      // The owner from another site: refused.
      const crossSite = await owner.put(`/api/match-lineups/${slug}/${a.side}`, {
        data: { players: [mates[2], mates[3]] },
        headers: { Origin: 'https://elsewhere.example' },
      });
      expect(crossSite.status()).toBe(403);

      // The owner: wrong count and a stranger are rejected; two of the team are saved.
      const tooMany = await owner.put(`/api/match-lineups/${slug}/${a.side}`, {
        data: { players: [mates[1], mates[2], mates[3]] },
      });
      expect(tooMany.status()).toBe(400);
      const stranger = await owner.put(`/api/match-lineups/${slug}/${a.side}`, {
        data: { players: [mates[1], bIds[0]] },
      });
      expect(stranger.status()).toBe(400);
      const picked = await owner.put(`/api/match-lineups/${slug}/${a.side}`, {
        data: { players: [mates[2], mates[3]] },
      });
      expect(picked.ok(), await picked.text()).toBe(true);
      const afterPick = (await picked.json()) as { teams: TeamLineup[] };
      const aNow = afterPick.teams.find((t) => t.teamId === teamA.id)!;
      expect(aNow.players).toEqual([mates[2], mates[3]]);
      expect(aNow.source).toBe('set');

      // The served config: the lineup is the team; the bench is nowhere on it.
      const config = await (await request.get(`/api/matches/${slug}.json`, { headers })).json();
      expect(Object.keys(config[a.side].players).sort()).toEqual([mates[2], mates[3]].sort());
      expect(Object.keys(config.spectators?.players ?? {})).toEqual([]);
      expect(Object.keys(config[b.side].players)).toHaveLength(2);
      expect(config.players_per_team).toBe(2);

      // What Ready Up would be assigned: the same.
      const assign = await request.get(`/api/test/fleet/assign-config/${slug}`, { headers });
      expect(assign.ok(), await assign.text()).toBe(true);
      const sent = (await assign.json()).config as {
        team1: { players: Array<{ steamid64: string; role?: string }> };
        team2: { players: Array<{ steamid64: string; role?: string }> };
        spectators?: string[];
      };
      expect(sent[a.side].players.map((p) => p.steamid64).sort()).toEqual(
        [mates[2], mates[3]].sort()
      );
      expect(sent[a.side].players.every((p) => (p.role ?? 'player') === 'player')).toBe(true);
      // Not whitelisted anywhere: no team, no spectator seat.
      const onServer = new Set([
        ...sent.team1.players.map((p) => p.steamid64),
        ...sent.team2.players.map((p) => p.steamid64),
        ...(sent.spectators ?? []),
      ]);
      for (const benched of [ownerId, mates[0], mates[1], bIds[2]]) {
        expect(onServer.has(benched)).toBe(false);
      }

      // Team B has no owner or captain: any member picks.
      const bMember = await playwright.request.newContext({ baseURL });
      expect(await signInAsPlayerViaRequest(bMember, bIds[2], 'B 3')).toBe(true);
      const bPicked = await bMember.put(`/api/match-lineups/${slug}/${b.side}`, {
        data: { players: [bIds[1], bIds[2]] },
      });
      expect(bPicked.ok(), await bPicked.text()).toBe(true);

      // An admin sets team A's lineup over the captain's.
      const forced = await request.put(`/api/match-lineups/${slug}/${a.side}`, {
        headers,
        data: { players: [ownerId, mates[1]], asAdmin: true },
      });
      expect(forced.ok(), await forced.text()).toBe(true);
      const final = await (await request.get(`/api/matches/${slug}.json`, { headers })).json();
      expect(Object.keys(final[a.side].players).sort()).toEqual([ownerId, mates[1]].sort());
      expect(Object.keys(final[b.side].players).sort()).toEqual([bIds[1], bIds[2]].sort());
      expect(final.expected_players_team1).toBe(2);
      expect(final.expected_players_team2).toBe(2);

      for (const ctx of [owner, outsider, mate, bMember]) await ctx.dispose();
    }
  );
});
