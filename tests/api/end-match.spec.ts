import { test, expect } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { createServer, deleteServer } from '../helpers/servers';

/**
 * End Match must settle MAT's own record, not just poke the server.
 *
 * Reported on Discord: "When the match is live and I click 'End Match' in the
 * Admin Controls, it still shows 'LIVE' in the Matches tab."
 *
 * /api/rcon/end-match sent the command to the server and stopped there, so the
 * row stayed 'live' indefinitely. The platform settles its own record now,
 * whether or not the server answers (a test server has no Ready Up behind it,
 * so here it does not, and the answer carries a warning).
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

      // This tournament's match: earlier tests leave theirs in the list.
      const slug = (await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id))
        ?.slug as string;
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
      expect(response.ok(), 'end-match should settle the match').toBe(true);
      const body = (await response.json()) as { settled?: boolean; warning?: string };
      expect(body.settled).toBe(true);
      expect(body.warning, 'no server answered, and the answer says so').toBeTruthy();

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

      // This tournament's match: earlier tests leave theirs in the list.
      const slug = (await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id))
        ?.slug as string;
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
      // A server row with no Ready Up server linked to it: force-cancel must
      // still cancel the match, and say the server could not be told.
      await signInViaRequest(request);
      const setup = await setupTournament(request, { teamCount: 2, serverCount: 1 });
      expect(setup).toBeTruthy();

      // This tournament's match: earlier tests leave theirs in the list.
      const slug = (await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id))
        ?.slug as string;
      expect(slug).toBeTruthy();

      const unreachableId = `unreachable-${Date.now()}`;
      const badServer = await createServer(request, {
        id: unreachableId,
        name: 'Unlinked test server',
        host: '127.0.0.1',
        port: 1,
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
