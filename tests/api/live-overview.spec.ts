import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import {
  liveOverviewItem,
  type LiveOverviewRow,
} from '../../api/src/integrations/cs2/routes/liveOverview';
import { sayLines } from '../../api/src/integrations/cs2/fleet/chatBridge';
import type { MatchState } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * The admins' live matches overview (GET /api/game/cs2/live-overview,
 * integrations/cs2/routes/liveOverview.ts): one card per match from its row
 * and the Ready Up live state, admin only. And how the chat bridge cuts a long
 * message into say lines (fleet/chatBridge.ts). The bridge itself, end to end
 * on a fake Ready Up server, is in fleet-driver.spec.ts.
 *
 * @tag api
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

const row = (over: Partial<LiveOverviewRow> = {}): LiveOverviewRow => ({
  slug: 'r1m1',
  status: 'live',
  game: 'cs2',
  config: null,
  source: null,
  round: 1,
  tournament_id: 3,
  tournament_name: 'NTLAN Cup',
  team1_id: 't-a',
  team2_id: 't-b',
  t1: 'Alpha',
  t2: 'Bravo',
  server_id: 'srv-1',
  server_name: 'Server 1',
  call_id: null,
  call_player_name: null,
  call_player_team: null,
  call_message: null,
  call_called_at: null,
  call_claimed_by: null,
  call_claimed_by_name: null,
  ...over,
});

const state = {
  match_id: 'r1m1',
  epoch: 1,
  config_rev: 1,
  live_rev: 9,
  phase: 'paused',
  series: {
    num_maps: 3,
    current_map: 2,
    score: { team1: 1, team2: 0 },
    maps: {
      '1': { name: 'de_mirage', sides: 'knife', status: 'done', score: { team1: 13, team2: 7 } },
      '2': { name: 'de_nuke', sides: 'knife', status: 'live', score: { team1: 4, team2: 6 } },
    },
  },
  teams: {
    team1: {
      name: 'Alpha',
      side: 'ct',
      score: 4,
      players: {
        '76561198000000001': { name: 'alice', connected: true, ready: true },
        '76561198000000002': { name: 'bob', connected: false, ready: false },
        '76561198000000009': { name: 'coach', role: 'coach', connected: true, ready: false },
      },
    },
    team2: {
      name: 'Bravo',
      side: 't',
      score: 6,
      players: { '76561198000000003': { name: 'carol', connected: true, ready: true } },
    },
  },
  ready: { ready: 3, total: 4, required_per_team: 2 },
  pause: {
    active: true,
    type: 'technical',
    by: '76561198000000001',
    started_at: 1790340000,
    unpause: { team1: true },
  },
  round: { number: 11 },
} as unknown as MatchState;

test.describe('Live overview card (pure)', () => {
  test('a live match: map, round, scores, sides, players, pause by name', () => {
    const card = liveOverviewItem(row(), { state, updatedAt: 1790340100 }, true);
    expect(card).toEqual({
      slug: 'r1m1',
      status: 'live',
      source: 'tournament',
      tournament: { id: 3, name: 'NTLAN Cup' },
      team1: {
        id: 't-a',
        name: 'Alpha',
        side: 'ct',
        score: 4,
        seriesScore: 1,
        // The coach does not hold a match up: not listed.
        players: [
          { steamId: '76561198000000001', name: 'alice', connected: true, ready: true },
          { steamId: '76561198000000002', name: 'bob', connected: false, ready: false },
        ],
      },
      team2: {
        id: 't-b',
        name: 'Bravo',
        side: 't',
        score: 6,
        seriesScore: 0,
        players: [{ steamId: '76561198000000003', name: 'carol', connected: true, ready: true }],
      },
      phase: 'paused',
      map: { number: 2, name: 'de_nuke' },
      numMaps: 3,
      round: 11,
      ready: { ready: 3, total: 4, required: 2 },
      pause: {
        active: true,
        type: 'technical',
        by: 'alice',
        since: 1790340000,
        unpause: { team1: true, team2: false },
      },
      call: null,
      server: { id: 'srv-1', name: 'Server 1', online: true },
      updatedAt: 1790340100,
    });
  });

  test('an open call, matchmaking, and no live state yet (roster from the config)', () => {
    const card = liveOverviewItem(
      row({
        status: 'loaded',
        source: 'matchmaking',
        tournament_id: null,
        tournament_name: null,
        config: JSON.stringify({
          team1: { name: 'Alpha', players: { '76561198000000001': 'alice' } },
          team2: { name: 'Bravo', players: { '76561198000000003': 'carol' } },
        }),
        call_id: 7,
        call_player_name: 'alice',
        call_player_team: 'team1',
        call_message: 'smoke bugged',
        call_called_at: 1790340000,
        call_claimed_by: '76561198000000099',
        call_claimed_by_name: 'Sivert',
      }),
      null,
      false
    );
    expect(card).toMatchObject({
      status: 'loaded',
      source: 'matchmaking',
      tournament: null,
      phase: null,
      map: null,
      round: null,
      pause: null,
      updatedAt: null,
      server: { id: 'srv-1', online: false },
      call: {
        id: 7,
        playerName: 'alice',
        playerTeam: 'team1',
        message: 'smoke bugged',
        calledAt: new Date(1790340000 * 1000).toISOString(),
        claimedBy: '76561198000000099',
        claimedByName: 'Sivert',
      },
    });
    expect(card.team1.players).toEqual([
      { steamId: '76561198000000001', name: 'alice', connected: false, ready: false },
    ]);
    expect(card.team2.players.map((p) => p.name)).toEqual(['carol']);
  });
});

test.describe('Chat bridge say lines (pure)', () => {
  test('a short message is one line; a long one is cut at spaces, at most three', () => {
    expect(sayLines('  on my   way ')).toEqual(['on my way']);
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const lines = sayLines(long);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(190);
    expect(lines[0]).toMatch(/^word0 word1 .*word\d+…$/);
    expect(lines[1].startsWith('word')).toBe(true);
    // Multi-byte text stays under the byte limit too.
    for (const line of sayLines('æøå '.repeat(80))) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(190);
    }
  });
});

test.describe('GET /api/game/cs2/live-overview', () => {
  test('admin only; a list of cards', async ({ request, playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: BASE_URL });
    expect((await anonymous.get('/api/game/cs2/live-overview')).status()).toBe(401);
    await anonymous.dispose();

    expect(await signInViaRequest(request)).toBe(true);
    const res = await request.get('/api/game/cs2/live-overview', { headers: getAuthHeader() });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { success: boolean; matches: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.matches)).toBe(true);
  });
});
