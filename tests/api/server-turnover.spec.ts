import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import {
  DEMO_UPLOAD_GIVE_UP_SECONDS,
  ServerTurnoverTracker,
  SIMULATION_SERIES_END_KICK_DELAY_SECONDS,
  resolveSeriesEndKickDelays,
} from '../../api/src/utils/serverTurnover';

/**
 * Faster server turnover after a series.
 *
 * The next queued match waited ~180 s after series_end: the plugin's GOTV
 * flush + demo upload (~131 s), its series-end kick delay, then MAT's fixed
 * grace window (120 s, 30 s simulated) counted from the idle timestamp. MAT now
 * releases an idle server as soon as it has seen the series end and the demo
 * upload report back, and holds a server whose demo is still uploading however
 * long it has been idle.
 *
 * @tag api
 * @tag allocation
 */

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

type AvailabilityServer = {
  id: string;
  inGraceWindow: boolean;
  notAllocatableReason: string | null;
};

const now = () => Math.floor(Date.now() / 1000);

async function serverEntry(request: APIRequestContext, serverId: string): Promise<AvailabilityServer> {
  const res = await request.get('/api/tournament/server-availability', { headers: getAuthHeader() });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { servers: AvailabilityServer[] };
  const entry = body.servers.find((s) => s.id === serverId);
  expect(entry, `server ${serverId} should be listed`).toBeTruthy();
  return entry!;
}

async function primeIdle(request: APIRequestContext, serverId: string, updatedAt: number) {
  const res = await request.post('/api/test/server-status', {
    headers: getAuthHeader(),
    data: { serverId, status: 'idle', online: true, updatedAt },
  });
  expect(res.ok()).toBe(true);
}

async function sendEvent(request: APIRequestContext, serverId: string, data: Record<string, unknown>) {
  const res = await request.post(`/api/events?server_id=${serverId}`, {
    headers: SERVER_HEADERS,
    data,
  });
  expect(res.ok(), `${String(data.event)} rejected: ${await res.text()}`).toBe(true);
}

test.describe.serial('Server turnover after series end', () => {
  test(
    'an idle server is released once the series ended and its demo upload reported back',
    { tag: ['@api', '@allocation'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const setup = await setupTournament(request, { teamCount: 2, serverCount: 1, prefix: 'turnover' });
      expect(setup).toBeTruthy();
      const serverId = setup!.servers[0].id;

      await sendEvent(request, serverId, {
        event: 'server_configured',
        server_id: serverId,
        hostname: 'turnover-probe',
        plugin_version: '1.4.23',
        remote_log_url: 'http://localhost:3069/api/events',
        timestamp: now(),
        configured_by: 'Startup',
      });

      // Control: idle for 6 s with nothing known about the last series is
      // still inside the grace window.
      await primeIdle(request, serverId, now() - 6);
      expect((await serverEntry(request, serverId)).notAllocatableReason).toBe('grace-window');

      const matches = await (await request.get('/api/matches', { headers: getAuthHeader() })).json();
      const slug = matches.matches?.[0]?.slug as string;
      expect(slug).toBeTruthy();
      const state = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, status: 'live', serverId, loadedAt: now() },
      });
      expect(state.ok()).toBe(true);

      await sendEvent(request, serverId, { event: 'demo_recording_start', matchid: slug, map_number: 0 });
      await sendEvent(request, serverId, {
        event: 'map_result',
        matchid: slug,
        map_number: 0,
        map_name: 'de_mirage',
        team1_score: 13,
        team2_score: 5,
        winner: { team: 'team1' },
      });
      await sendEvent(request, serverId, {
        event: 'series_end',
        matchid: slug,
        team1_series_score: 1,
        team2_series_score: 0,
        winner: { team: 'team1', side: '3' },
        time_until_restore: 10,
      });

      // Upload pending: held even though idle long past the grace window.
      await primeIdle(request, serverId, now() - 3600);
      const whileUploading = await serverEntry(request, serverId);
      expect(whileUploading.notAllocatableReason).toBe('demo-upload');

      await sendEvent(request, serverId, {
        event: 'demo_upload_ended',
        matchid: slug,
        map_number: 0,
        success: true,
      });

      // Idle 6 s after series end with the upload done: no grace window left.
      await primeIdle(request, serverId, now() - 6);
      const released = await serverEntry(request, serverId);
      expect(released.inGraceWindow).toBe(false);
      expect(released.notAllocatableReason).not.toBe('grace-window');
      expect(released.notAllocatableReason).not.toBe('demo-upload');
      expect(released.notAllocatableReason).not.toBe('busy');
    }
  );
});

test.describe('Server turnover rules', () => {
  const T = 1_800_000_000;

  function endedSeries(opts: { upload: boolean }) {
    const tracker = new ServerTurnoverTracker();
    tracker.matchLoaded('s1', 42, opts.upload);
    tracker.recordEvent('s1', { event: 'map_result', matchid: 42, map_number: 0 }, T);
    tracker.recordEvent('s1', { event: 'series_end', matchid: 42 }, T + 2);
    return tracker;
  }

  test('releases as soon as idle and the upload is done', () => {
    const tracker = endedSeries({ upload: true });
    tracker.recordEvent('s1', { event: 'demo_upload_ended', matchid: 42, map_number: 0 }, T + 131);
    expect(tracker.evaluate('s1', T + 135, T + 141).releaseEarly).toBe(true);
    // Not in the first seconds of idle: the plugin resets the match 2 s after.
    expect(tracker.evaluate('s1', T + 135, T + 136).releaseEarly).toBe(false);
  });

  test('holds while the upload is pending, even when idle', () => {
    const tracker = endedSeries({ upload: true });
    const decision = tracker.evaluate('s1', T + 60, T + 100);
    expect(decision.demoUploadPending).toBe(true);
    expect(decision.releaseEarly).toBe(false);
    // A failed upload is still over.
    tracker.recordEvent('s1', { event: 'demo_upload_fail', matchid: 42, map_number: 0 }, T + 130);
    expect(tracker.evaluate('s1', T + 60, T + 131).demoUploadPending).toBe(false);
  });

  test('every map of a series must upload', () => {
    const tracker = new ServerTurnoverTracker();
    tracker.matchLoaded('s1', 7, true);
    tracker.recordEvent('s1', { event: 'map_result', matchid: 7, map_number: 0 }, T);
    tracker.recordEvent('s1', { event: 'map_result', matchid: 7, map_number: 1 }, T + 60);
    tracker.recordEvent('s1', { event: 'series_end', matchid: 7 }, T + 62);
    tracker.recordEvent('s1', { event: 'demo_upload_ended', matchid: 7, map_number: 1 }, T + 190);
    expect(tracker.evaluate('s1', T + 195, T + 200).demoUploadPending).toBe(true);
    tracker.recordEvent('s1', { event: 'demo_upload_ended', matchid: 7, map_number: 0 }, T + 201);
    expect(tracker.evaluate('s1', T + 195, T + 202).releaseEarly).toBe(true);
  });

  test('no demo upload configured: released on idle after series end', () => {
    const tracker = endedSeries({ upload: false });
    expect(tracker.evaluate('s1', T + 10, T + 20).releaseEarly).toBe(true);
  });

  test('a lost upload event does not hold the server forever', () => {
    const tracker = endedSeries({ upload: true });
    expect(tracker.evaluate('s1', T + 200, T + DEMO_UPLOAD_GIVE_UP_SECONDS).demoUploadPending).toBe(false);
  });

  test('nothing known (API restart) or an idle stamp from before the series end: no early release', () => {
    expect(new ServerTurnoverTracker().evaluate('s1', T, T + 60).releaseEarly).toBe(false);
    const tracker = endedSeries({ upload: false });
    expect(tracker.evaluate('s1', T - 600, T + 60).releaseEarly).toBe(false);
  });

  test('simulation sends short series-end kick delays; real matches keep the admin values', () => {
    const admin = {
      seriesEndKickDelayNoDemo: 5,
      seriesEndKickDelayDemoNoUpload: 10,
      seriesEndKickDelayDemoUpload: 60,
    };
    expect(resolveSeriesEndKickDelays(admin, false)).toEqual(admin);
    expect(resolveSeriesEndKickDelays(admin, true)).toEqual({
      seriesEndKickDelayNoDemo: SIMULATION_SERIES_END_KICK_DELAY_SECONDS,
      seriesEndKickDelayDemoNoUpload: SIMULATION_SERIES_END_KICK_DELAY_SECONDS,
      seriesEndKickDelayDemoUpload: SIMULATION_SERIES_END_KICK_DELAY_SECONDS,
    });
  });
});
