import { test, expect } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { createServer, deleteServer } from '../helpers/servers';

/**
 * End Match must settle MAT's own record, not just poke the server.
 *
 * Reported on Discord: "When the match is live and I click 'End Match' in the
 * Admin Controls, it still shows 'LIVE' in the Matches tab."
 *
 * /api/rcon/end-match sent an RCON command and stopped there. MatchZy emits no
 * event when a match is force-ended, so nothing ever told MAT, and the row
 * stayed 'live' indefinitely.
 *
 * Test servers use host 0.0.0.0, which rconService treats as a fake server and
 * answers successfully — so the real path is reachable here: the command
 * "lands", and MAT then has to settle its own record.
 *
 * @tag api
 * @tag matches
 * @tag admin
 */

async function matchStatus(
  request: import('@playwright/test').APIRequestContext,
  slug: string
): Promise<string | undefined> {
  const response = await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() });
  if (!response.ok()) return undefined;
  const body = await response.json();
  return (body.match ?? body)?.status as string | undefined;
}

test.describe.serial('Ending a match', () => {
  test(
    'should mark the match over, not just tell the server to stop',
    { tag: ['@api', '@matches', '@admin'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const setup = await setupTournament(request, { teamCount: 2, serverCount: 1 });
      expect(setup).toBeTruthy();
      const server = setup!.servers[0];

      const matches = await (
        await request.get('/api/matches', { headers: getAuthHeader() })
      ).json();
      const slug = matches.matches?.[0]?.slug as string;
      expect(slug).toBeTruthy();

      await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, status: 'live', serverId: server.id },
      });

      expect(await matchStatus(request, slug), 'match should start out live').toBe('live');

      const response = await request.post('/api/rcon/end-match', {
        headers: getAuthHeader(),
        data: { serverId: server.id },
      });
      expect(response.ok(), 'end-match should succeed against this server').toBe(true);

      // The reported bug: the command went out, the row was never touched, and
      // the Matches tab kept showing LIVE.
      await expect
        .poll(() => matchStatus(request, slug), {
          message: 'End Match should settle the match record, not only the server',
          timeout: 10000,
        })
        .toBe('cancelled');
    }
  );

  test(
    'should settle the record on force cancel even with the server unreachable',
    { tag: ['@api', '@matches', '@admin'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const setup = await setupTournament(request, { teamCount: 2, serverCount: 1 });
      expect(setup).toBeTruthy();
      const server = setup!.servers[0];

      const matches = await (
        await request.get('/api/matches', { headers: getAuthHeader() })
      ).json();
      const slug = matches.matches?.[0]?.slug as string;
      expect(slug).toBeTruthy();

      await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, status: 'live', serverId: server.id },
      });

      const response = await request.post(`/api/matches/${slug}/force-cancel`, {
        headers: getAuthHeader(),
        data: {},
      });
      expect(response.ok(), 'force-cancel should succeed regardless of the server').toBe(true);

      await expect
        .poll(() => matchStatus(request, slug), {
          message: 'force-cancel should settle the match record',
          timeout: 10000,
        })
        .toBe('cancelled');
    }
  );

  test(
    'should warn (not silently claim success) when the server cannot be reached',
    { tag: ['@api', '@matches', '@admin'] },
    async ({ request }) => {
      // Regression test for the bug fixed alongside `css_endmatch`: CS2's
      // `endMatchOnServer` called the private `rconService.executeCommand`
      // with a server id where it expects a server record, so the RCON
      // connect always failed. `executeCommand` resolved `{ success: false }`
      // instead of throwing, and `endMatchOnServer` ignored the result and
      // logged "Successfully sent" regardless — force-cancel never reported
      // a warning, no matter what actually happened on the server.
      //
      // `FAKE_SERVER_HOST` (0.0.0.0) short-circuits to success before
      // rconService even looks at the `enabled` flag, so a disabled fake
      // server can't be used to exercise the failure path here. Instead this
      // points the match at a second, real server whose RCON port nothing is
      // listening on, so the connection is refused immediately (no need to
      // wait out a connect timeout). It's only registered as a bare server
      // row via the test-only `/api/test/match-state` serverId override, so
      // it never has to pass the tournament-start preflight.
      await signInViaRequest(request);
      const setup = await setupTournament(request, { teamCount: 2, serverCount: 1 });
      expect(setup).toBeTruthy();

      const matches = await (
        await request.get('/api/matches', { headers: getAuthHeader() })
      ).json();
      const slug = matches.matches?.[0]?.slug as string;
      expect(slug).toBeTruthy();

      const unreachableId = `unreachable-${Date.now()}`;
      const badServer = await createServer(request, {
        id: unreachableId,
        name: 'Unreachable RCON test server',
        host: '127.0.0.1',
        port: 1, // Nothing listens here; RCON connect is refused immediately.
        password: 'irrelevant',
        enabled: true,
      });
      expect(badServer, 'creating the unreachable test server should succeed').toBeTruthy();

      // Remove it afterwards: an enabled server nothing answers on fails the
      // tournament-start preflight (cs2_outdated_servers) for every later
      // spec on the same shard.
      try {
        await request.post('/api/test/match-state', {
          headers: getAuthHeader(),
          data: { slug, status: 'live', serverId: unreachableId },
        });

        const response = await request.post(`/api/matches/${slug}/force-cancel`, {
          headers: getAuthHeader(),
          data: {},
        });
        expect(response.ok(), 'force-cancel should succeed even when the server refuses it').toBe(
          true
        );

        const body = await response.json();
        expect(
          Array.isArray(body.warnings) && body.warnings.length > 0,
          'force-cancel should surface a warning when the server could not be told'
        ).toBe(true);

        await expect
          .poll(() => matchStatus(request, slug), {
            message: 'force-cancel should settle the match record even after a warning',
            timeout: 10000,
          })
          .toBe('cancelled');
      } finally {
        await deleteServer(request, unreachableId);
      }
    }
  );
});
