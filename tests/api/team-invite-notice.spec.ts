import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInAsPlayerViaRequest } from '../helpers/auth';

/**
 * A team invite reaches the invited player as a notice (the bell), answered
 * there or on the Teams page; taking the invite back takes the notice too.
 *
 * @tag api
 * @tag teams
 */

function steamId(): string {
  let out = '76561198';
  for (let i = 0; i < 9; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

interface Notice {
  kind: string;
  data: Record<string, unknown>;
  read: boolean;
}

async function player(
  playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
  baseURL: string | undefined
) {
  const ctx = await playwright.request.newContext({ baseURL });
  const id = steamId();
  expect(await signInAsPlayerViaRequest(ctx, id, `Inv ${id.slice(-5)}`)).toBe(true);
  return { ctx, id };
}

async function teamNotices(ctx: APIRequestContext, teamId: string): Promise<Notice[]> {
  const res = await ctx.get('/api/social/notifications');
  expect(res.ok(), await res.text()).toBe(true);
  const { items } = (await res.json()) as { items: Notice[] };
  return items.filter((n) => n.kind === 'team_invite' && n.data.teamId === teamId);
}

async function makeTeam(ctx: APIRequestContext, id: string): Promise<string> {
  const res = await ctx.post('/api/team-directory/mine', {
    data: { name: `Invite Team ${id.slice(-5)}`, tag: 'INV' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).team.id;
}

test.describe('Team invite notices', () => {
  test(
    'the invited player gets a notice; accepting answers it and joins the roster',
    { tag: ['@api', '@teams'] },
    async ({ playwright, baseURL }) => {
      const owner = await player(playwright, baseURL);
      const invited = await player(playwright, baseURL);
      const teamId = await makeTeam(owner.ctx, owner.id);

      const sent = await owner.ctx.post(`/api/team-directory/${teamId}/invites`, {
        data: { steamId: invited.id },
      });
      expect(sent.ok(), await sent.text()).toBe(true);

      const [notice] = await teamNotices(invited.ctx, teamId);
      expect(notice).toBeTruthy();
      expect(notice.read).toBe(false);
      expect(notice.data).toMatchObject({ teamId, url: '/community/teams' });
      expect((notice.data.from as { id: string }).id).toBe(owner.id);

      const mine = await (await invited.ctx.get('/api/team-directory/mine')).json();
      expect(mine.invites.map((i: { teamId: string }) => i.teamId)).toContain(teamId);

      const answered = await invited.ctx.post(`/api/team-directory/${teamId}/invites/answer`, {
        data: { accept: true },
      });
      expect(answered.ok(), await answered.text()).toBe(true);
      const [after] = await teamNotices(invited.ctx, teamId);
      expect(after.data.answer).toBe('joinedTeam');
      expect(after.read).toBe(true);

      const memberOf = (await (await invited.ctx.get('/api/team-directory/mine')).json()).memberOf;
      expect(memberOf.map((t: { id: string }) => t.id)).toContain(teamId);
    }
  );

  test(
    'declining marks the notice declined; a taken-back invite takes its notice',
    { tag: ['@api', '@teams'] },
    async ({ playwright, baseURL }) => {
      const owner = await player(playwright, baseURL);
      const a = await player(playwright, baseURL);
      const b = await player(playwright, baseURL);
      const teamId = await makeTeam(owner.ctx, owner.id);

      const uids: Record<string, string> = {};
      for (const p of [a, b]) {
        const sent = await owner.ctx.post(`/api/team-directory/${teamId}/invites`, {
          data: { steamId: p.id },
        });
        expect(sent.ok(), await sent.text()).toBe(true);
        uids[p.id] = (await sent.json()).invite.uid;
      }

      const declined = await a.ctx.post(`/api/team-directory/${teamId}/invites/answer`, {
        data: { accept: false },
      });
      expect(declined.ok(), await declined.text()).toBe(true);
      expect((await teamNotices(a.ctx, teamId))[0].data.answer).toBe('declined');

      expect(await teamNotices(b.ctx, teamId)).toHaveLength(1);
      const cancelled = await owner.ctx.delete(
        `/api/team-directory/${teamId}/invites/${uids[b.id]}`
      );
      expect(cancelled.ok(), await cancelled.text()).toBe(true);
      expect(await teamNotices(b.ctx, teamId)).toHaveLength(0);
    }
  );
});
