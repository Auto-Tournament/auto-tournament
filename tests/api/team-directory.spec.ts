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

test.describe('Running a team', () => {
  // A 1x1 PNG.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );

  test(
    'invite, accept, roles, logo, leave, hand over and disband',
    { tag: ['@api', '@teams'] },
    async ({ playwright, baseURL }) => {
      const owner = await playwright.request.newContext({ baseURL });
      const joiner = await playwright.request.newContext({ baseURL });
      const ownerId = steamId();
      const joinerId = steamId();
      expect(await signInAsPlayerViaRequest(owner, ownerId, `Own ${ownerId.slice(-4)}`)).toBe(true);
      expect(await signInAsPlayerViaRequest(joiner, joinerId, `Join ${joinerId.slice(-4)}`)).toBe(
        true
      );

      const team = (
        await (
          await owner.post('/api/team-directory/mine', {
            data: { name: `Run ${ownerId.slice(-5)}`, tag: 'RUN' },
          })
        ).json()
      ).team;
      const base = `/api/team-directory/${team.id}`;

      // Only the owner and captains see the owner view.
      expect((await joiner.get(`${base}/manage`)).status()).toBe(403);

      const code = (await (await owner.post(`${base}/invite`)).json()).inviteCode;
      expect(code).toBeTruthy();
      expect((await joiner.get(`/api/team-directory/invite/${code}`)).ok()).toBe(true);
      expect(await (await joiner.post(`/api/team-directory/invite/${code}`)).json()).toMatchObject({
        status: 'requested',
      });

      let view = await (await owner.get(`${base}/manage`)).json();
      expect(view.viewerRole).toBe('owner');
      expect(view.requests).toHaveLength(1);
      const joinerUid = view.requests[0].uid;
      expect((await owner.post(`${base}/requests/${joinerUid}/accept`)).ok()).toBe(true);
      view = await (await owner.get(`${base}/manage`)).json();
      expect(view.members.map((m: { steamId: string }) => m.steamId).sort()).toEqual(
        [joinerId, ownerId].sort()
      );
      expect(view.requests).toHaveLength(0);

      // Members cannot rename; captains can.
      expect((await joiner.patch(base, { data: { name: 'Hijacked', tag: 'HJK' } })).status()).toBe(
        403
      );
      expect(
        (await owner.patch(`${base}/members/${joinerUid}`, { data: { role: 'captain' } })).ok()
      ).toBe(true);
      expect(
        (
          await joiner.patch(base, { data: { name: `Run ${ownerId.slice(-5)} B`, tag: 'RNB' } })
        ).ok()
      ).toBe(true);

      // Logo: an image is stored and served; anything else is refused.
      expect(
        (
          await owner.put(`${base}/logo`, { data: PNG, headers: { 'Content-Type': 'image/png' } })
        ).ok()
      ).toBe(true);
      const logoUrl = (await (await owner.get(`/api/team-directory/${team.id}`)).json()).team
        .logoUrl;
      expect(logoUrl).toContain(`/api/team-directory/${team.id}/logo?v=`);
      const logo = await owner.get(logoUrl);
      expect(logo.headers()['content-type']).toBe('image/png');
      expect(
        (
          await owner.put(`${base}/logo`, {
            data: Buffer.from('<svg/>'),
            headers: { 'Content-Type': 'image/png' },
          })
        ).status()
      ).toBe(415);

      // The owner cannot leave; a captain can be handed the team.
      const ownerUid = view.members.find((m: { role: string }) => m.role === 'owner').uid;
      expect((await owner.delete(`${base}/members/${ownerUid}`)).status()).toBe(400);
      expect((await owner.post(`${base}/transfer`, { data: { uid: joinerUid } })).ok()).toBe(true);
      expect((await (await joiner.get(`${base}/manage`)).json()).viewerRole).toBe('owner');

      // The old owner leaves; the new owner disbands.
      expect((await owner.delete(`${base}/members/${ownerUid}`)).ok()).toBe(true);
      expect((await owner.delete(base)).status()).toBe(403);
      expect((await joiner.delete(base)).ok()).toBe(true);
      expect((await owner.get(`/api/team-directory/${team.id}`)).status()).toBe(404);

      await owner.dispose();
      await joiner.dispose();
    }
  );
});
