import { test, expect } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

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
});
