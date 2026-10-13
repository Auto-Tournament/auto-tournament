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
 * GET /api/game/cs2/players/:playerId/profile: the numbers behind the CS2
 * part of a player's profile. A finished match counts in the player's totals
 * and in everyone's, and its map counts on the player's side of the result.
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

function players(
  team: Team,
  side: 'team1' | 'team2',
  kills: number,
  headshots: number
): ReadyUpPlayer[] {
  return team.players.map((p) => ({
    steamId: p.steamId,
    name: p.name,
    team: side,
    kills,
    deaths: 10,
    assists: 3,
    headshots,
    damage: 1800,
    roundsPlayed: 20,
    kastRounds: 14,
  }));
}

test.describe.serial('CS2 player profile route', () => {
  test(
    'a finished match counts in the totals and on its map',
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
        prefix: 'cs2-profile',
      });
      expect(setup).toBeTruthy();
      if (!setup) return;
      const [team1, team2] = [setup.teams[0], setup.teams[1]];
      const tournament = await createAndStartTournament(request, {
        name: `CS2 Profile ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamIds: [team1.id, team2.id],
      });
      expect(tournament).toBeTruthy();
      const match = await findMatchByTeams(request, team1.id, team2.id);
      const slug = match!.slug;

      await sendReadyUpEvents(request, slug, [
        goingLive(1),
        mapResult({
          mapName: 'de_mirage',
          team1: 13,
          team2: 7,
          series: [1, 0],
          winner: 'team1',
          seriesOver: true,
          players: [...players(team1, 'team1', 20, 8), ...players(team2, 'team2', 10, 2)],
        }),
        seriesEnd({ winner: 'team1', team1: 1, team2: 0 }),
      ]);

      const winner = team1.players[0].steamId;
      const loser = team2.players[0].steamId;
      const read = async (id: string) => {
        const res = await request.get(`/api/game/cs2/players/${id}/profile`);
        expect(res.ok()).toBe(true);
        return res.json();
      };

      await expect
        .poll(async () => (await read(winner)).player.matches, {
          timeout: 20000,
          intervals: [500, 1000],
        })
        .toBe(1);

      const won = await read(winner);
      expect(won.player).toMatchObject({ matches: 1, kills: 20, deaths: 10 });
      expect(won.everyone.matches).toBeGreaterThanOrEqual(1);
      expect(won.everyone.kills).toBeGreaterThanOrEqual(30);
      expect(won.maps).toEqual([
        { map: 'de_mirage', played: 1, won: 1, roundsWon: 13, roundsLost: 7 },
      ]);

      const lost = await read(loser);
      expect(lost.maps).toEqual([
        { map: 'de_mirage', played: 1, won: 0, roundsWon: 7, roundsLost: 13 },
      ]);
    }
  );

  test('a player with no CS2 match has zero totals', { tag: ['@api'] }, async ({ request }) => {
    const res = await request.get('/api/game/cs2/players/76561190000000000/profile');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.player.matches).toBe(0);
    expect(body.maps).toEqual([]);
  });
});
