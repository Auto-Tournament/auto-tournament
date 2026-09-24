import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { deleteServer, FAKE_SERVER_HOST, type Server } from '../helpers/servers';
import { getIntegration } from '../../api/src/integrations/registry';
import { MANUAL_REPORT_GAME_ID } from '../../api/src/integrations/manual-report/catalog';

/**
 * The webhook URL belongs to the integration that needs it, not to the start
 * route (3.0 phase C left this as the last "start still assumes servers").
 *
 * It is where Auto Tournament CS2 on a CS2 server posts its events, so CS2 asks for it
 * and refuses to start a tournament without one — unchanged, down to the
 * message and the status. A game whose module has no servers has nothing to
 * reach back, so its tournament starts with the setting empty.
 *
 * @tag api
 */

const MANUAL_REPORT_TEST = '/api/test/integration/manual-report';

/** The message CS2 has always failed a start with. It is part of the API. */
const NO_WEBHOOK_MESSAGE = 'Webhook URL is not configured. Update it from the Settings page.';

async function setWebhookUrl(request: APIRequestContext, webhookUrl: string | null) {
  const res = await request.put('/api/settings', {
    headers: getAuthHeader(),
    data: { webhookUrl },
  });
  expect(res.ok(), `setting webhookUrl=${String(webhookUrl)}: ${await res.text()}`).toBe(true);
}

async function createTeams(request: APIRequestContext, prefix: string, count: number) {
  const stamp = `${Date.now()}`.slice(-7);
  const ids: string[] = [];
  for (let t = 0; t < count; t++) {
    const id = `${prefix}-${stamp}-${t}`;
    const players = Array.from({ length: 2 }, (_, p) => ({
      steamId: `76561199${stamp}${t}${p}`,
      name: `${prefix} ${t}.${p}`,
    }));
    const res = await request.post('/api/teams', {
      headers: getAuthHeader(),
      data: { id, name: `${prefix} ${stamp} ${t}`, players },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    ids.push(id);
  }
  return ids;
}

/**
 * Remove leftover test servers with a real host. CS2's start preflight RCONs
 * every enabled server, so one of those would fail the start with
 * `cs2_outdated_servers` before it ever looks at the webhook URL — and this
 * spec is about which failure comes back. Servers we do not recognise are
 * left alone (the suite may be pointed at real infrastructure).
 */
async function removeBlockingTestServers(request: APIRequestContext) {
  const res = await request.get('/api/servers', { headers: getAuthHeader() });
  if (!res.ok()) return;
  const servers = ((await res.json()) as { servers?: Server[] }).servers ?? [];
  for (const server of servers) {
    const isFixture = /-server-\d{10,}$/.test(server.id) || /^ui_test_server_\d{10,}$/.test(server.id);
    if (server.enabled && server.host !== FAKE_SERVER_HOST && isFixture) {
      await deleteServer(request, server.id);
    }
  }
}

test.describe.serial('Tournament start without a webhook URL', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    // The state this spec is about: nothing configured to call back on.
    await setWebhookUrl(request, null);
    await request.delete('/api/tournament', { headers: getAuthHeader() });
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/tournament', { headers: getAuthHeader() });
    // Put the suite's default back for whatever runs next in this shard.
    await setWebhookUrl(request, 'http://localhost:3069');
  });

  test('only a module with servers asks for a base URL', () => {
    // CS2 resolves one (the webhook URL); a module with no servers has no
    // hook at all, so the core passes '' and nothing can fail the start.
    expect(typeof getIntegration('cs2').resolveBaseUrl).toBe('function');
    expect(getIntegration(MANUAL_REPORT_GAME_ID).resolveBaseUrl).toBeUndefined();
  });

  test('a manual-report tournament starts with none set', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'start-nohook-mr', 2);
    const created = await request.post(`${MANUAL_REPORT_TEST}/tournament`, {
      headers: getAuthHeader(),
      data: {
        name: 'Chess Cup',
        type: 'single_elimination',
        format: 'bo1',
        game: 'chess',
        teamIds,
        settings: { manualReport: { gameLabel: 'Chess' } },
      },
    });
    expect(created.status(), `creating: ${await created.text()}`).toBe(200);

    const settings = await request.get('/api/settings', { headers: getAuthHeader() });
    expect(settings.ok()).toBe(true);
    expect(
      ((await settings.json()) as { settings?: { webhookConfigured?: boolean } }).settings
        ?.webhookConfigured
    ).toBe(false);

    const started = await request.post('/api/tournament/start', {
      headers: getAuthHeader(),
      data: {},
    });
    expect(started.status(), `starting: ${await started.text()}`).toBe(200);

    // And it really ran: with no server to load it onto, allocation puts the
    // match straight to live.
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/matches', { headers: getAuthHeader() });
          const matches =
            ((await res.json()) as { matches?: Array<{ round: number; status: string }> })
              .matches ?? [];
          return matches.filter((m) => m.round >= 1 && m.status === 'live').length;
        },
        { message: 'the match should go live with no webhook URL', timeout: 20_000 }
      )
      .toBe(1);
  });

  test('a CS2 tournament still refuses', { tag: ['@api'] }, async ({ request }) => {
    await removeBlockingTestServers(request);
    const teamIds = await createTeams(request, 'start-nohook-cs2', 2);
    const created = await request.post('/api/tournament', {
      headers: getAuthHeader(),
      data: {
        name: 'CS2 Cup',
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_vertigo'],
        teamIds,
      },
    });
    expect(created.ok(), `creating: ${await created.text()}`).toBe(true);

    const started = await request.post('/api/tournament/start', {
      headers: getAuthHeader(),
      data: {},
    });
    expect(started.status()).toBe(500);
    expect(((await started.json()) as { error?: string }).error).toBe(NO_WEBHOOK_MESSAGE);

    // Nothing started: the tournament is still in setup.
    const after = await request.get('/api/tournament', { headers: getAuthHeader() });
    expect(((await after.json()) as { tournament?: { status?: string } }).tournament?.status).toBe(
      'setup'
    );

    // With the URL back, the same start is accepted.
    await setWebhookUrl(request, 'http://localhost:3069');
    const retried = await request.post('/api/tournament/start', {
      headers: getAuthHeader(),
      data: {},
    });
    expect(retried.status(), `restarting: ${await retried.text()}`).toBe(200);
  });
});
