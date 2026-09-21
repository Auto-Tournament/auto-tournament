import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * Newest-first ordering of match events within the same second.
 *
 * match_events.received_at has one-second resolution. Every "latest event"
 * query ordered by received_at alone, so two events stored in the same second
 * tied and Postgres returned either one. The match page could then show the
 * series score from the final round_end (1-1) instead of the series_end that
 * followed it (2-1), and never correct itself. The queries now break ties on
 * the serial id, which follows insertion order.
 *
 * @tag api
 * @tag regression
 */

const MAPS = [
  'de_mirage',
  'de_inferno',
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_vertigo',
  'de_nuke',
];

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

type ListedMatch = {
  id: number;
  slug: string;
  round: number;
  team1?: { id: string };
  team2?: { id: string };
};
type StoredEvent = {
  id: number;
  event_type: string;
  event_data: { round_number: number };
  received_at: number;
};

async function postEvent(request: APIRequestContext, slug: string, data: Record<string, unknown>) {
  const res = await request.post(`/api/events/${slug}`, { headers: SERVER_HEADERS, data });
  expect(res.ok(), `${String(data.event)} rejected: ${await res.text()}`).toBe(true);
}

/** Wait until just after a second boundary so a quick burst lands in one second. */
async function startOfNextSecond() {
  await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 5));
}

test(
  'events stored in the same second come back newest first',
  { tag: ['@api', '@regression'] },
  async ({ request }) => {
    await signInViaRequest(request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo3',
      maps: MAPS,
      teamCount: 2,
      serverCount: 1,
      prefix: 'events-order',
    });
    expect(setup).toBeTruthy();

    const list = await request.get('/api/matches', { headers: getAuthHeader() });
    expect(list.ok()).toBe(true);
    const matches = ((await list.json()) as { matches?: ListedMatch[] }).matches ?? [];
    const match = matches.find((m) => m.round === 1 && m.team1 && m.team2);
    expect(match, 'a round 1 match with both teams').toBeTruthy();
    const slug = match!.slug;

    const state = await request.post('/api/test/match-state', {
      headers: getAuthHeader(),
      data: { slug, status: 'live', serverId: setup!.servers[0].id },
    });
    expect(state.ok()).toBe(true);

    // A burst of round_end events, each carrying its round number.
    await startOfNextSecond();
    const rounds = [1, 2, 3, 4, 5];
    for (const round of rounds) {
      await postEvent(request, slug, {
        event: 'round_end',
        matchid: match!.id,
        map_number: 2,
        round_number: round,
        winner: 'team1',
        team1_score: round,
        team2_score: 0,
        team1_series_score: 1,
        team2_series_score: 1,
      });
    }

    const res = await request.get(`/api/events/${slug}?type=round_end`, {
      headers: getAuthHeader(),
    });
    expect(res.ok(), await res.text()).toBe(true);
    const events = ((await res.json()) as { data?: StoredEvent[] }).data ?? [];
    expect(events).toHaveLength(rounds.length);

    const seconds = new Set(events.map((e) => e.received_at));
    test.info().annotations.push({
      type: 'note',
      description: `burst spanned ${seconds.size} distinct received_at value(s)`,
    });

    // Newest first, even where received_at ties.
    const order = events.map((e) => e.event_data.round_number);
    expect(order).toEqual([...rounds].reverse());

    const latest = await request.get(`/api/events/${slug}?type=round_end&limit=1`, {
      headers: getAuthHeader(),
    });
    expect(latest.ok()).toBe(true);
    const latestEvents = ((await latest.json()) as { data?: StoredEvent[] }).data ?? [];
    expect(latestEvents[0]?.event_data.round_number).toBe(5);
  }
);
