import { test, expect } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * "End tournament" (POST /api/tournament/cancel): a running tournament stops
 * without a result. Every match not finished is cancelled, the tournament is
 * `cancelled`, and it can then be archived. The name confirms it.
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

test(
  'an admin ends a running tournament: matches cancelled, tournament cancelled, then archivable',
  { tag: ['@api', '@regression'] },
  async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/settings', { data: { simulateMatches: false } });
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: MAPS,
      teamCount: 4,
      serverCount: 1,
      prefix: 'endt',
    });
    expect(setup, 'tournament setup failed').toBeTruthy();
    const headers = getAuthHeader();
    const current = (await (await request.get('/api/tournament', { headers })).json()) as {
      tournament: { id: number; name: string; status: string };
    };
    const { id, name } = current.tournament;

    // The wrong name is refused.
    const wrong = await request.post(`/api/tournament/cancel?tournamentId=${id}`, {
      headers,
      data: { confirm: 'nope' },
    });
    expect(wrong.status()).toBe(400);

    const res = await request.post(`/api/tournament/cancel?tournamentId=${id}`, {
      headers,
      data: { confirm: name },
    });
    expect(res.ok(), await res.text()).toBe(true);
    expect((await res.json()).cancelled).toBeGreaterThan(0);

    const after = (await (
      await request.get(`/api/tournament?tournamentId=${id}`, { headers })
    ).json()) as {
      tournament: { status: string };
    };
    expect(after.tournament.status).toBe('cancelled');
    const matches = (await (await request.get('/api/matches', { headers })).json()) as {
      matches: Array<{ slug: string; status: string }>;
    };
    for (const m of matches.matches.filter((x) => /^r\d+m\d+$/.test(x.slug))) {
      expect(['cancelled', 'completed']).toContain(m.status);
    }

    // A cancelled tournament can be archived.
    const archived = await request.post(`/api/tournament/archive?tournamentId=${id}`, { headers });
    expect(archived.ok(), await archived.text()).toBe(true);

    // Leave nothing behind: an ended tournament's matches would show on specs
    // that expect an empty Matches page (tests/ui/matches.spec.ts).
    const removed = await request.delete('/api/tournament', {
      headers: { ...headers, 'X-Tournament-Id': String(id) },
    });
    expect(removed.ok(), await removed.text()).toBe(true);
  }
);
