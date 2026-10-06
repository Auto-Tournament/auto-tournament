import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { createTournament } from '../helpers/tournaments';

/**
 * Teams signing themselves up for a tournament with a lineup, and the lineup
 * checking in. The team's owner signs up; the team joins the tournament's
 * teams; a withdrawal takes it out again.
 *
 * @tag api
 * @tag tournament
 */

function steamId(): string {
  return `7656119${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}

test.describe('Tournament sign-up', () => {
  test(
    'an owner signs a team up with a lineup, and withdraws it',
    { tag: ['@api', '@tournament'] },
    async ({ request, playwright, baseURL }) => {
      await signInViaRequest(request);

      // The owner makes a team, and an admin fills its roster.
      const owner = await playwright.request.newContext({ baseURL });
      const ownerId = steamId();
      const mates = [steamId(), steamId(), steamId(), steamId()];
      expect(await signInAsPlayerViaRequest(owner, ownerId, `Owner ${ownerId.slice(-4)}`)).toBe(true);
      const created = await owner.post('/api/team-directory/mine', {
        data: { name: `Signup ${ownerId.slice(-5)}`, tag: 'SU' },
      });
      expect(created.status(), await created.text()).toBe(201);
      const team = (await created.json()).team as { id: string };
      const roster = await request.put(`/api/teams/${team.id}`, {
        headers: getAuthHeader(),
        data: {
          players: [
            { steamId: ownerId, name: 'Owner' },
            ...mates.map((m, i) => ({ steamId: m, name: `Mate ${i + 1}` })),
          ],
        },
      });
      expect(roster.ok(), await roster.text()).toBe(true);

      const tournament = await createTournament(request, {
        name: `Signup ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [],
        settings: { registrationOpen: true, maxTeams: 4 },
      });
      expect(tournament).toBeTruthy();
      const id = tournament!.id;

      const me = await (await owner.get(`/api/tournament-signup/${id}/me`)).json();
      expect(me.teams.map((t: { id: string }) => t.id)).toContain(team.id);

      const lineup = { teamId: team.id, starters: [ownerId, ...mates], subs: [] };
      const noRules = await owner.post(`/api/tournament-signup/${id}/register`, { data: lineup });
      expect(noRules.status()).toBe(400);

      const tooFew = await owner.post(`/api/tournament-signup/${id}/register`, {
        data: { ...lineup, starters: [ownerId], acceptRules: true },
      });
      expect(tooFew.status()).toBe(400);

      const ok = await owner.post(`/api/tournament-signup/${id}/register`, {
        data: { ...lineup, acceptRules: true },
      });
      expect(ok.status(), await ok.text()).toBe(200);

      const board = await (await request.get(`/api/tournament-signup/${id}`)).json();
      const reg = board.registrations.find((r: { teamId: string }) => r.teamId === team.id);
      expect(reg.lineup.map((p: { steamId: string }) => p.steamId).sort()).toEqual([ownerId, ...mates].sort());
      const after = await (await request.get(`/api/tournament/${id}/leaderboard`)).json();
      expect(after.tournament.teamIds).toContain(team.id);

      // Check-in is not open (no window set).
      expect((await owner.post(`/api/tournament-signup/${id}/check-in`)).status()).toBe(409);

      const out = await owner.delete(`/api/tournament-signup/${id}/registration/${team.id}`);
      expect(out.status()).toBe(200);
      const gone = await (await request.get(`/api/tournament/${id}/leaderboard`)).json();
      expect(gone.tournament.teamIds).not.toContain(team.id);

      await owner.dispose();
    }
  );
});
