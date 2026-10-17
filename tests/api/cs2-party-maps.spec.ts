import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import type { Team } from '../helpers/teams';
import {
  sendReadyUpEvents,
  goingLive,
  mapResult,
  seriesEnd,
  type ReadyUpPlayer,
} from '../helpers/readyUp';

/**
 * GET /api/game/cs2/party-maps?players=…: a matchmaking party's map strength
 * on /play. Each member's results per map, added up over the party, and the
 * Active Duty maps the radar marks.
 *
 * @tag api
 * @tag stats
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

function players(team: Team, side: 'team1' | 'team2'): ReadyUpPlayer[] {
  return team.players.map((p) => ({
    steamId: p.steamId,
    name: p.name,
    team: side,
    kills: 15,
    deaths: 10,
    assists: 3,
    headshots: 5,
    damage: 1800,
    roundsPlayed: 20,
    kastRounds: 14,
  }));
}

test.describe.serial('CS2 party maps route', () => {
  test(
    "a party's maps add up its members' results",
    { tag: ['@api', '@stats'] },
    async ({ page, request }) => {
      test.setTimeout(120000);
      await ensureSignedIn(page);
      await signInViaRequest(request);

      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamCount: 2,
        serverCount: 1,
        prefix: 'cs2-party-maps',
      });
      expect(setup).toBeTruthy();
      if (!setup) return;
      const [team1, team2] = [setup.teams[0], setup.teams[1]];
      const tournament = await createAndStartTournament(request, {
        name: `CS2 Party Maps ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamIds: [team1.id, team2.id],
      });
      expect(tournament).toBeTruthy();
      const match = await findMatchByTeams(request, team1.id, team2.id);
      const slug = match!.slug;

      // The seeded Steam IDs play in other specs too: compare against each
      // member's own profile (not cached) rather than absolute numbers.
      const [a, b] = [team1.players[0].steamId, team1.players[1].steamId];
      const loser = team2.players[0].steamId;
      type MapRow = {
        map: string;
        played: number;
        won: number;
        roundsWon: number;
        roundsLost: number;
      };
      const profileMaps = async (id: string): Promise<MapRow[]> =>
        (await (await request.get(`/api/game/cs2/players/${id}/profile`)).json()).maps;
      const mirage = async (id: string) =>
        (await profileMaps(id)).find((m) => m.map === 'de_mirage')?.played ?? 0;
      const before = await mirage(a);

      await sendReadyUpEvents(request, slug, [
        goingLive(1),
        mapResult({
          mapName: 'de_mirage',
          team1: 13,
          team2: 7,
          series: [1, 0],
          winner: 'team1',
          seriesOver: true,
          players: [...players(team1, 'team1'), ...players(team2, 'team2')],
        }),
        seriesEnd({ winner: 'team1', team1: 1, team2: 0 }),
      ]);
      await expect
        .poll(() => mirage(a), { timeout: 20000, intervals: [500, 1000] })
        .toBe(before + 1);

      const sum = (lists: MapRow[][]) => {
        const by = new Map<string, MapRow>();
        for (const m of lists.flat()) {
          const t = by.get(m.map) ?? { map: m.map, played: 0, won: 0, roundsWon: 0, roundsLost: 0 };
          t.played += m.played;
          t.won += m.won;
          t.roundsWon += m.roundsWon;
          t.roundsLost += m.roundsLost;
          by.set(m.map, t);
        }
        return [...by.values()].sort((x, y) => x.map.localeCompare(y.map));
      };
      const read = async (ids: string[]) => {
        const res = await request.get(`/api/game/cs2/party-maps?players=${ids.join(',')}`);
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.activeDuty)).toBe(true);
        return body;
      };
      const byMap = (rows: MapRow[]) => [...rows].sort((x, y) => x.map.localeCompare(y.map));

      for (const party of [
        [a, b],
        [a, loser],
      ]) {
        const body = await read(party);
        expect(byMap(body.maps)).toEqual(sum(await Promise.all(party.map(profileMaps))));
        expect(body.maps.find((m: MapRow) => m.map === 'de_mirage').played).toBeGreaterThanOrEqual(
          2
        );
      }
    }
  );

  test('a party with no CS2 match has no maps', { tag: ['@api'] }, async ({ request }) => {
    const res = await request.get(
      '/api/game/cs2/party-maps?players=76561190000000001,76561190000000002'
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.maps).toEqual([]);
    expect(Array.isArray(body.activeDuty)).toBe(true);
  });

  test('refuses anything but one to five Steam IDs', { tag: ['@api'] }, async ({ request }) => {
    for (const q of [
      '',
      '?players=',
      '?players=abc',
      `?players=${Array.from({ length: 6 }, (_, i) => `7656119000000010${i}`).join(',')}`,
    ]) {
      const res = await request.get(`/api/game/cs2/party-maps${q}`);
      expect(res.status(), q).toBe(400);
    }
  });
});
