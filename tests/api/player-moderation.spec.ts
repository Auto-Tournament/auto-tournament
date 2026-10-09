import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { createTournament } from '../helpers/tournaments';

/**
 * Banning and deleting players (services/playerModeration.ts): a banned
 * player shows publicly as only their name and "Banned"; a deleted one is a
 * tombstone named "Deleted player", gone from the player list; neither keeps
 * their stats or history in public. Admins cannot be banned.
 *
 * @tag api
 */

const TAGS = { tag: ['@api'] };

test.describe.serial('player moderation', () => {
  const id = `7656119${String(Date.now()).slice(-10)}`;

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test(
    'a banned player shows only their name in public, and a ban can be lifted',
    TAGS,
    async ({ request }) => {
      const created = await request.post('/api/players', {
        headers: getAuthHeader(),
        data: { id, name: 'Moderation Target' },
      });
      expect([200, 201]).toContain(created.status());

      const ban = await request.post(`/api/players/${id}/ban`, {
        headers: getAuthHeader(),
        data: { reason: 'cheating in the e2e suite' },
      });
      expect(ban.status(), await ban.text()).toBe(200);

      const pub = (await (await request.get(`/api/players/${id}`)).json()) as {
        player: Record<string, unknown>;
        restricted?: boolean;
      };
      expect(pub.restricted).toBe(true);
      expect(pub.player).toMatchObject({ name: 'Moderation Target', banned: true });
      expect(pub.player).not.toHaveProperty('currentElo');
      expect(JSON.stringify(pub)).not.toContain('cheating');

      const matches = await request.get(`/api/players/${id}/matches`);
      expect(matches.status()).toBe(404);
      expect(
        (
          (await (await request.get(`/api/players/${id}/summary`)).json()) as {
            restricted?: boolean;
          }
        ).restricted
      ).toBe(true);

      // Admins see why.
      const admin = (await (
        await request.get('/api/players', { headers: getAuthHeader() })
      ).json()) as {
        players: Array<{ id: string; banned?: boolean; banReason?: string | null }>;
      };
      const row = admin.players.find((p) => p.id === id);
      expect(row?.banned).toBe(true);

      expect(
        (await request.delete(`/api/players/${id}/ban`, { headers: getAuthHeader() })).status()
      ).toBe(200);
      const after = (await (await request.get(`/api/players/${id}`)).json()) as {
        player: Record<string, unknown>;
        restricted?: boolean;
      };
      expect(after.restricted).toBeUndefined();
      expect(after.player.banned).toBeUndefined();
    }
  );

  test('an admin cannot be banned', TAGS, async ({ request }) => {
    const me = (await (await request.get('/api/auth/admin/me')).json()) as {
      steamId?: string;
      user?: { steamId?: string };
    };
    const adminId = me.steamId ?? me.user?.steamId;
    test.skip(!adminId, 'no admin id from /api/auth/admin/me');
    const res = await request.post(`/api/players/${adminId}/ban`, {
      headers: getAuthHeader(),
      data: {},
    });
    expect(res.status(), await res.text()).toBe(409);
  });

  test(
    'deleting leaves a tombstone: "Deleted player", not listed, final',
    TAGS,
    async ({ request }) => {
      expect(
        (await request.delete(`/api/players/${id}`, { headers: getAuthHeader() })).status()
      ).toBe(200);
      const pub = (await (await request.get(`/api/players/${id}`)).json()) as {
        player: Record<string, unknown>;
      };
      expect(pub.player).toMatchObject({ name: 'Deleted player', deleted: true });
      const list = (await (
        await request.get('/api/players', { headers: getAuthHeader() })
      ).json()) as {
        players: Array<{ id: string }>;
      };
      expect(list.players.map((p) => p.id)).not.toContain(id);
      // Deleting again is harmless; banning a tombstone is refused.
      expect(
        (await request.delete(`/api/players/${id}`, { headers: getAuthHeader() })).status()
      ).toBe(200);
      expect(
        (
          await request.post(`/api/players/${id}/ban`, { headers: getAuthHeader(), data: {} })
        ).status()
      ).toBe(409);
    }
  );
});

function steamId(): string {
  return `7656119${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}

test.describe('a banned starter leaves the lineup', () => {
  test(
    'the team gets a gap to fill and fills it with its sub',
    TAGS,
    async ({ request, playwright, baseURL }) => {
      expect(await signInViaRequest(request)).toBe(true);
      const owner = await playwright.request.newContext({ baseURL });
      const ownerId = steamId();
      const mates = [steamId(), steamId(), steamId(), steamId()];
      const sub = steamId();
      expect(await signInAsPlayerViaRequest(owner, ownerId, `Owner ${ownerId.slice(-4)}`)).toBe(
        true
      );
      const team = (
        (await (
          await owner.post('/api/team-directory/mine', {
            data: { name: `Ban ${ownerId.slice(-5)}`, tag: 'BN' },
          })
        ).json()) as {
          team: { id: string };
        }
      ).team;
      const roster = [ownerId, ...mates, sub];
      expect(
        (
          await request.put(`/api/teams/${team.id}`, {
            headers: getAuthHeader(),
            data: { players: roster.map((id, i) => ({ steamId: id, name: `P${i}` })) },
          })
        ).ok()
      ).toBe(true);
      const banned = mates[0];
      await request.post('/api/players', {
        headers: getAuthHeader(),
        data: { id: banned, name: 'To Ban' },
      });

      const tournament = await createTournament(request, {
        name: `Ban gap ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [],
        settings: { registrationOpen: true, maxTeams: 4 },
      });
      const id = tournament!.id;
      const reg = await owner.post(`/api/tournament-signup/${id}/register`, {
        data: { teamId: team.id, starters: [ownerId, ...mates], subs: [sub], acceptRules: true },
      });
      expect(reg.status(), await reg.text()).toBe(200);

      expect(
        (
          await request.post(`/api/players/${banned}/ban`, { headers: getAuthHeader(), data: {} })
        ).status()
      ).toBe(200);

      const board = (await (await request.get(`/api/tournament-signup/${id}`)).json()) as {
        registrations: Array<{
          teamId: string;
          lineupGapDeadline: number | null;
          lineup: Array<{ steamId: string }>;
        }>;
      };
      const mine = board.registrations.find((r) => r.teamId === team.id)!;
      expect(mine.lineup.map((p) => p.steamId)).not.toContain(banned);
      expect(mine.lineupGapDeadline).toBeGreaterThan(Date.now() / 1000);

      // The banned player cannot be put back; the sub can step in.
      const back = await owner.put(`/api/tournament-signup/${id}/lineup`, {
        data: { teamId: team.id, starters: [ownerId, ...mates], subs: [sub] },
      });
      expect(back.status()).toBe(400);
      const picked = await owner.put(`/api/tournament-signup/${id}/lineup`, {
        data: { teamId: team.id, starters: [ownerId, ...mates.slice(1), sub], subs: [] },
      });
      expect(picked.status(), await picked.text()).toBe(200);
      const after = (await (
        await request.get(`/api/tournament-signup/${id}`)
      ).json()) as typeof board;
      expect(after.registrations.find((r) => r.teamId === team.id)!.lineupGapDeadline).toBeNull();
      await owner.dispose();
    }
  );
});
