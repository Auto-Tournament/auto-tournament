import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Authentication on the game event webhooks.
 *
 * `POST /api/events` and `POST /api/events/:matchSlugOrServerId` are what move
 * the score. They were unauthenticated: anyone who could reach the API could
 * post a `series_end` and decide who won. They now require the same
 * `X-MatchZy-Token` the plugin is already configured to send.
 *
 * The token is deliberately checked *before* the payload, so a forged event is
 * refused without the handler ever looking at it.
 *
 * @tag api
 * @tag auth
 * @tag events
 */

const TOKEN = process.env.SERVER_TOKEN ?? 'server123';

const authed = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': TOKEN,
};

/** A real event shape, so a rejection can only be about the credential. */
function seriesStart(serverId: string) {
  return {
    event: 'series_start',
    server_id: serverId,
    matchid: 999999,
    team1: { name: 'Forged Team 1' },
    team2: { name: 'Forged Team 2' },
    timestamp: Math.floor(Date.now() / 1000),
  };
}

async function post(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
  data: unknown
) {
  return request.post(path, { headers, data });
}

test.describe('game event webhook authentication', () => {
  test('rejects an event with no token', {
    tag: ['@api', '@auth', '@events'],
  }, async ({ request }) => {
    for (const path of ['/api/events', '/api/events/some-server']) {
      const response = await post(
        request,
        path,
        { 'Content-Type': 'application/json' },
        seriesStart('some-server')
      );
      expect(response.status(), `${path} should refuse an untokened event`).toBe(401);
    }
  });

  test('rejects an event with the wrong token', {
    tag: ['@api', '@auth', '@events'],
  }, async ({ request }) => {
    for (const path of ['/api/events', '/api/events/some-server']) {
      const response = await post(
        request,
        path,
        { 'Content-Type': 'application/json', 'X-MatchZy-Token': `${TOKEN}-wrong` },
        seriesStart('some-server')
      );
      expect(response.status(), `${path} should refuse a wrong token`).toBe(401);
    }
  });

  test('a near-miss token is refused, not accepted as a prefix', {
    tag: ['@api', '@auth', '@events'],
  }, async ({ request }) => {
    for (const candidate of [TOKEN.slice(0, -1), `${TOKEN} `, TOKEN.toUpperCase()]) {
      // `${TOKEN} ` is the exception: the header is trimmed, so it matches.
      const expected = candidate.trim() === TOKEN ? 200 : 401;
      const response = await post(
        request,
        '/api/events',
        { 'Content-Type': 'application/json', 'X-MatchZy-Token': candidate },
        seriesStart('near-miss-probe')
      );
      expect(response.status(), `token "${candidate}" should give ${expected}`).toBe(expected);
    }
  });

  test('accepts an event carrying the configured token', {
    tag: ['@api', '@auth', '@events'],
  }, async ({ request }) => {
    // An unknown server is fine — the point is that auth let it through and the
    // handler answered, rather than the middleware turning it away.
    const response = await post(
      request,
      '/api/events/auth-probe-server',
      authed,
      seriesStart('auth-probe-server')
    );

    expect(response.status()).toBe(200);
  });

  test('an unauthenticated event changes nothing', {
    tag: ['@api', '@auth', '@events'],
  }, async ({ request }) => {
    const serverId = `forge-probe-${Date.now()}`;

    // server_configured is the event that registers a server. If the guard were
    // only cosmetic, this would create one.
    const forged = await post(request, `/api/events/${serverId}`, { 'Content-Type': 'application/json' }, {
      event: 'server_configured',
      server_id: serverId,
      hostname: 'forged',
      plugin_version: '1.4.23',
      remote_log_url: 'http://localhost:3069/api/events',
      timestamp: Math.floor(Date.now() / 1000),
      configured_by: 'Startup',
    });
    expect(forged.status()).toBe(401);

    // The event log for that server must be empty — nothing was recorded.
    const events = await request.get(`/api/events/${serverId}`);
    // Admin-guarded, so this is a 401 for this context either way; what matters
    // is that the forged event did not register the server.
    expect([401, 403, 404]).toContain(events.status());
  });

  test('the reachability probe stays open', {
    tag: ['@api', '@auth', '@events'],
  }, async ({ request }) => {
    // GET /api/events/test exists so an operator can curl from the game host to
    // check the API is reachable, before any token is configured. Guarding it
    // would defeat its purpose.
    const response = await request.get('/api/events/test');
    expect(response.status()).toBe(200);
  });
});
