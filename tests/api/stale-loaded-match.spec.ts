import { test, expect } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * A stale 'loaded' match must not pin its server forever.
 *
 * Reported on Discord: "after every server has been assigned once, they don't
 * get assigned again" — four idle servers, two matches waiting. The workaround
 * was deleting and recreating the matches, which is the tell: it was the match
 * rows, not the servers.
 *
 * Availability was `pluginSaysIdle && !dbSaysBusy`. A match left in 'loaded' —
 * abandoned, or a load that only appeared to succeed — kept dbSaysBusy true
 * forever, and nothing ever cleared it.
 *
 * The distinction that matters is time: a match loaded seconds ago while the
 * plugin has yet to update its convar is genuinely busy; one loaded ten minutes
 * ago against an idle plugin is a stale row. Both states are asserted below.
 *
 * @tag api
 * @tag allocation
 * @tag servers
 */

type AvailabilityServer = {
  id: string;
  allocatable: boolean;
  notAllocatableReason: string | null;
  staleMatchSlug: string | null;
};

async function serverEntry(
  request: import('@playwright/test').APIRequestContext,
  serverId: string
): Promise<AvailabilityServer> {
  const response = await request.get('/api/tournament/server-availability', {
    headers: getAuthHeader(),
  });
  expect(response.ok(), 'server-availability should answer for an admin').toBe(true);
  const body = (await response.json()) as { servers: AvailabilityServer[] };
  const entry = body.servers.find((s) => s.id === serverId);
  expect(entry, `server ${serverId} should appear in the availability list`).toBeTruthy();
  return entry!;
}

test.describe.serial('Stale loaded match', () => {
  test(
    'should keep a server busy while a load is fresh, and release it once the row is stale',
    { tag: ['@api', '@allocation', '@servers'] },
    async ({ request }) => {
      await signInViaRequest(request);

      const setup = await setupTournament(request, { teamCount: 2, serverCount: 1 });
      expect(setup, 'tournament setup should succeed').toBeTruthy();
      const server = setup!.servers[0];

      // The availability view only considers servers that have reported in at
      // least once. Send the real server_configured webhook rather than faking
      // lastSeen, so the registration path is exercised too.
      const configured = await request.post(`/api/events/${server.id}`, {
        data: {
          event: 'server_configured',
          server_id: server.id,
          hostname: 'stale-row-probe',
          plugin_version: '1.4.23',
          remote_log_url: 'http://localhost:3069/api/events',
          timestamp: Math.floor(Date.now() / 1000),
          configured_by: 'Startup',
        },
      });
      expect(configured.ok(), 'server_configured should be accepted').toBe(true);

      // CI has no CS2 server to report its status, so stand in for the plugin.
      const seen = await request.post('/api/test/server-status', {
        headers: getAuthHeader(),
        data: { serverId: server.id, status: 'idle', online: true, updatedAt: 1 },
      });
      expect(seen.ok(), 'priming server status should succeed').toBe(true);

      const matches = await (
        await request.get('/api/matches', { headers: getAuthHeader() })
      ).json();
      const slug = matches.matches?.[0]?.slug as string | undefined;
      expect(slug, 'the tournament should have produced a match').toBeTruthy();

      const now = Math.floor(Date.now() / 1000);

      // --- Freshly loaded: genuinely busy, must stay blocked ---
      const fresh = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, status: 'loaded', serverId: server.id, loadedAt: now },
      });
      expect(fresh.ok()).toBe(true);

      const whileFresh = await serverEntry(request, server.id);
      expect(
        whileFresh.allocatable,
        'a server whose match was just loaded must not be handed to another match'
      ).toBe(false);
      expect(whileFresh.notAllocatableReason).toBe('busy');
      expect(whileFresh.staleMatchSlug).toBeNull();

      // --- Loaded long ago with the plugin idle: the row is stale ---
      const stale = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, loadedAt: now - 3600 },
      });
      expect(stale.ok()).toBe(true);

      const whenStale = await serverEntry(request, server.id);
      expect(
        whenStale.notAllocatableReason,
        'an hour-old loaded row against an idle plugin must stop counting as busy — ' +
          'that is the bug: the row pinned the server forever'
      ).not.toBe('busy');
      expect(
        whenStale.staleMatchSlug,
        'the stale row should be named so an admin can cancel it'
      ).toBe(slug);
    }
  );

  test(
    'should never release a server whose match is live, however old the row',
    { tag: ['@api', '@allocation', '@servers'] },
    async ({ request }) => {
      await signInViaRequest(request);

      const setup = await setupTournament(request, { teamCount: 2, serverCount: 1 });
      expect(setup).toBeTruthy();
      const server = setup!.servers[0];

      await request.post(`/api/events/${server.id}`, {
        data: {
          event: 'server_configured',
          server_id: server.id,
          hostname: 'live-row-probe',
          plugin_version: '1.4.23',
          remote_log_url: 'http://localhost:3069/api/events',
          timestamp: Math.floor(Date.now() / 1000),
          configured_by: 'Startup',
        },
      });
      await request.post('/api/test/server-status', {
        headers: getAuthHeader(),
        data: { serverId: server.id, status: 'idle', online: true, updatedAt: 1 },
      });

      const matches = await (
        await request.get('/api/matches', { headers: getAuthHeader() })
      ).json();
      const slug = matches.matches?.[0]?.slug as string | undefined;
      expect(slug).toBeTruthy();

      // An hour old and the plugin claims idle — the same shape that releases a
      // 'loaded' row. A live row must not be released on that basis: the cost of
      // being wrong is handing out a server with a match running on it.
      await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: {
          slug,
          status: 'live',
          serverId: server.id,
          loadedAt: Math.floor(Date.now() / 1000) - 3600,
        },
      });

      const entry = await serverEntry(request, server.id);
      expect(
        entry.notAllocatableReason,
        'a live match must keep its server, even when the plugin reports idle'
      ).toBe('busy');
      expect(entry.staleMatchSlug, 'a live row is never treated as stale').toBeNull();
      expect(entry.allocatable).toBe(false);
    }
  );

  test(
    'should say why a server is unavailable rather than just refusing it',
    { tag: ['@api', '@allocation'] },
    async ({ request }) => {
      await signInViaRequest(request);

      const setup = await setupTournament(request, { teamCount: 2, serverCount: 1 });
      expect(setup).toBeTruthy();
      const server = setup!.servers[0];

      await request.post(`/api/events/${server.id}`, {
        data: {
          event: 'server_configured',
          server_id: server.id,
          hostname: 'reason-probe',
          plugin_version: '1.4.23',
          remote_log_url: 'http://localhost:3069/api/events',
          timestamp: Math.floor(Date.now() / 1000),
          configured_by: 'Startup',
        },
      });
      await request.post('/api/test/server-status', {
        headers: getAuthHeader(),
        data: { serverId: server.id, status: 'idle', online: true, updatedAt: 1 },
      });

      // A server MAT has never version-checked is held back deliberately. The
      // point here is that it now says so — previously the UI showed an idle
      // server and no reason at all, which is what made this cost users hours.
      const entry = await serverEntry(request, server.id);
      if (!entry.allocatable) {
        expect(
          entry.notAllocatableReason,
          'an unallocatable server must carry a reason'
        ).not.toBeNull();
      }
    }
  );
});
