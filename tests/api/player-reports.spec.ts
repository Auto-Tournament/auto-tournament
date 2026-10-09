import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Player reports (services/playerReports.ts): a signed-in player reports
 * another; the admins list, dismiss, or ban from it; the reporter hears it
 * was reviewed.
 *
 * @tag api
 */

const TAGS = { tag: ['@api'] };

function steamId(): string {
  return `7656119${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}

test(
  'a player reports another; an admin dismisses, then bans from a report',
  TAGS,
  async ({ request, playwright, baseURL }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const reporterId = steamId();
    const targetId = steamId();
    await request.post('/api/players', {
      headers: getAuthHeader(),
      data: { id: targetId, name: 'Reported Player' },
    });
    const reporter = await playwright.request.newContext({ baseURL });
    expect(await signInAsPlayerViaRequest(reporter, reporterId, 'Reporter')).toBe(true);

    // Checks before anything is stored.
    expect(
      (await reporter.post('/api/player-reports', { data: { playerId: targetId } })).status()
    ).toBe(400);
    expect(
      (
        await reporter.post('/api/player-reports', {
          data: { playerId: targetId, reason: 'other' },
        })
      ).status()
    ).toBe(400);
    expect(
      (
        await reporter.post('/api/player-reports', {
          data: { playerId: reporterId, reason: 'toxic' },
        })
      ).status()
    ).toBe(400);
    const anon = await playwright.request.newContext({ baseURL });
    expect(
      (
        await anon.post('/api/player-reports', { data: { playerId: targetId, reason: 'toxic' } })
      ).status()
    ).toBe(401);
    expect((await anon.get('/api/player-reports')).status()).toBe(401);
    await anon.dispose();

    const sent = await reporter.post('/api/player-reports', {
      data: {
        playerId: targetId,
        reason: 'cheating',
        details: 'spun around and one-tapped through smoke',
      },
    });
    expect(sent.status(), await sent.text()).toBe(201);
    const { id: first } = (await sent.json()) as { id: number };
    expect(
      (
        await reporter.post('/api/player-reports', {
          data: { playerId: targetId, reason: 'cheating' },
        })
      ).status()
    ).toBe(409);

    type List = {
      reports: Array<{ id: number; reason: string; status: string; reported: { id: string } }>;
    };
    const open = (await (
      await request.get('/api/player-reports', { headers: getAuthHeader() })
    ).json()) as List;
    expect(open.reports.find((r) => r.id === first)).toMatchObject({
      reason: 'cheating',
      status: 'open',
      reported: { id: targetId },
    });

    // Dismiss: the reporter is told it was reviewed.
    expect(
      (
        await request.post(`/api/player-reports/${first}/dismiss`, {
          headers: getAuthHeader(),
          data: {},
        })
      ).status()
    ).toBe(200);
    const bell = (await (await reporter.get('/api/social/notifications')).json()) as {
      items: Array<{ kind: string; data: { event?: string } }>;
    };
    expect(bell.items.some((n) => n.kind === 'report' && n.data.event === 'reviewed')).toBe(true);

    // A new report, and a ban from it.
    const again = await reporter.post('/api/player-reports', {
      data: { playerId: targetId, reason: 'toxic' },
    });
    expect(again.status(), await again.text()).toBe(201);
    const { id: second } = (await again.json()) as { id: number };
    expect(
      (
        await request.post(`/api/player-reports/${second}/ban`, {
          headers: getAuthHeader(),
          data: {},
        })
      ).status()
    ).toBe(200);
    const pub = (await (await request.get(`/api/players/${targetId}`)).json()) as {
      player: { banned?: boolean };
    };
    expect(pub.player.banned).toBe(true);
    const all = (await (
      await request.get('/api/player-reports?status=all', { headers: getAuthHeader() })
    ).json()) as List;
    expect(all.reports.find((r) => r.id === second)?.status).toBe('actioned');
    await reporter.dispose();
  }
);
