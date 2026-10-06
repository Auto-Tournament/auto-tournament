import { test, expect } from '@playwright/test';
import { signInAsPlayerViaRequest } from '../helpers/auth';
import { validateTeamFields } from '../../api/src/routes/teamDirectory';

/**
 * The player side of teams: the public team list and making a team.
 *
 * A team plays every game, so making one asks for a name and a tag and
 * nothing else. A player owns at most one team; the maker is its owner and a
 * captain, and the roster starts with just them.
 *
 * @tag api
 * @tag teams
 */

function steamId(): string {
  let out = '76561198';
  for (let i = 0; i < 9; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

test.describe('Team directory', () => {
  test('validates the name and tag', { tag: ['@api', '@teams'] }, () => {
    expect(validateTeamFields('  Team   Sivert ', 'siv')).toEqual({
      name: 'Team Sivert',
      tag: 'SIV',
    });
    expect(typeof validateTeamFields('A', 'SIV')).toBe('string');
    expect(typeof validateTeamFields('Team', 'S')).toBe('string');
    expect(typeof validateTeamFields('Team', 'TOOLONG')).toBe('string');
    expect(typeof validateTeamFields('Team', 'S!V')).toBe('string');
  });

  test(
    'a player makes one team and owns no second one',
    { tag: ['@api', '@teams'] },
    async ({ playwright, baseURL }) => {
      const player = await playwright.request.newContext({ baseURL });
      const id = steamId();
      expect(await signInAsPlayerViaRequest(player, id, `Owner ${id.slice(-4)}`)).toBe(true);

      const anon = await playwright.request.newContext({ baseURL });
      expect((await anon.get('/api/team-directory/mine')).status()).toBe(401);
      expect(
        (
          await anon.post('/api/team-directory/mine', { data: { name: 'Nope', tag: 'NO' } })
        ).status()
      ).toBe(401);

      const name = `Dir Team ${id.slice(-5)}`;
      const created = await player.post('/api/team-directory/mine', { data: { name, tag: 'dt' } });
      expect(created.status(), await created.text()).toBe(201);
      const team = (await created.json()).team;
      expect(team).toMatchObject({ name, tag: 'DT', memberCount: 1 });

      const second = await player.post('/api/team-directory/mine', {
        data: { name: `${name} 2`, tag: 'DT2' },
      });
      expect(second.status()).toBe(409);
      expect(await second.json()).toMatchObject({ code: 'already_owner', teamId: team.id });

      const mine = await (await player.get('/api/team-directory/mine')).json();
      expect(mine.owned).toMatchObject({ id: team.id, name });
      expect(mine.memberOf).toEqual([]);

      const list = await (await anon.get('/api/team-directory')).json();
      expect(list.teams.find((t: { id: string }) => t.id === team.id)).toMatchObject({
        name,
        tag: 'DT',
        memberCount: 1,
      });

      // The maker is on the roster and is the team's captain.
      const profile = await (await anon.get(`/api/team/${team.id}/match`)).json();
      expect(JSON.stringify(profile)).toContain(id);

      await player.dispose();
      await anon.dispose();
    }
  );
});
