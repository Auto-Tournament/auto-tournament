import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { goingLive, sendReadyUpEvents } from '../helpers/readyUp';

/**
 * The match response carries the phase the server reports (`liveStatus`), null
 * before any report.
 *
 * @tag api
 * @tag servers
 */
async function liveStatus(request: APIRequestContext, slug: string) {
  const res = await request.get(`/api/matches/${slug}`);
  expect(res.ok()).toBe(true);
  const { match } = (await res.json()) as { match: { liveStatus?: string | null } };
  return match.liveStatus;
}

test(
  'the match response carries the live phase',
  { tag: ['@api', '@servers'] },
  async ({ page, request }) => {
    await setupTestContext(page, request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: [
        'de_mirage',
        'de_inferno',
        'de_ancient',
        'de_anubis',
        'de_dust2',
        'de_vertigo',
        'de_nuke',
      ],
      teamCount: 2,
      serverCount: 1,
      prefix: 'phase',
    });
    expect(setup).toBeTruthy();
    const match = await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id);
    const slug = match!.slug;
    const state = await request.post('/api/test/match-state', {
      data: { slug, status: 'loaded', serverId: setup!.servers[0].id },
    });
    expect(state.ok()).toBe(true);

    expect(await liveStatus(request, slug)).toBeNull();
    await sendReadyUpEvents(request, slug, [goingLive()]);
    expect(await liveStatus(request, slug)).toBe('live');
  }
);
