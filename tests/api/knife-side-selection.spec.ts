import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import type { Team } from '../helpers/teams';

/**
 * Knife round → side selection → live.
 *
 * MatchZy emits `knife_round_started`, then `knife_round_ended` carrying the
 * winner, then `going_live` once the winner has chosen a side. It emits nothing
 * for the choice itself, so the gap between the last two events is the whole
 * selection window — `matchzy_side_selection_time`, 60 seconds by default.
 *
 * MAT used to report 'warmup' on `knife_round_ended`, so for that entire window
 * the UI dropped out of the knife round and claimed the match was warming up.
 * Verified against a real CS2 server: the event order below is what a live
 * knife round actually produces.
 *
 * @tag api
 * @tag matchzy
 * @tag regression
 */

const HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

async function sendEvent(request: APIRequestContext, slug: string, payload: object) {
  const res = await request.post(`/api/events/${slug}`, { headers: HEADERS, data: payload });
  expect(res.ok(), `event rejected: ${await res.text()}`).toBe(true);
}

async function liveStatus(request: APIRequestContext, slug: string): Promise<string | undefined> {
  const res = await request.get(`/api/events/live/${slug}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { status?: string }).status;
}

test.describe.serial('Knife round side selection', () => {
  let team1: Team;
  let team2: Team;
  let slug: string;

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
      teamCount: 2,
      serverCount: 1,
      prefix: 'knife-side',
    });
    expect(setup).toBeTruthy();
    [team1, team2] = [setup!.teams[0], setup!.teams[1]];

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();
    slug = match!.slug;
  });

  test(
    'stays on the knife round while the winner picks a side, then goes live',
    { tag: ['@api', '@matchzy', '@regression'] },
    async ({ request }) => {
      await sendEvent(request, slug, {
        event: 'knife_round_started',
        matchid: slug,
        map_number: 0,
      });
      expect(await liveStatus(request, slug)).toBe('knife');

      await sendEvent(request, slug, {
        event: 'knife_round_ended',
        matchid: slug,
        map_number: 0,
        winner: 'team1',
      });

      // The reported bug: this used to report 'warmup', so the board left the
      // knife round for the entire side-selection window.
      expect(
        await liveStatus(request, slug),
        'side selection is still the knife stage, not warmup'
      ).toBe('knife');

      await sendEvent(request, slug, {
        event: 'going_live',
        matchid: slug,
        map_number: 0,
      });

      expect(await liveStatus(request, slug)).toBe('live');
    }
  );
});
