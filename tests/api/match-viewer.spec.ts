import { test, expect, request as playwrightRequest } from '@playwright/test';
import { signInViaRequest, impersonatePlayer, stopImpersonating } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { actingSteamIdFor } from '../helpers/veto';

/**
 * The match page's `viewerTeamId`: the signed-in viewer's team in that match
 * (its live roster decides), so the match room can show them their part.
 *
 * @tag api
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api'] };

test.describe.serial('Match viewer team', () => {
  test.setTimeout(120000);

  let slug: string;
  let team1Id: string;
  let team2Id: string;
  let team1Player: string;
  let team2Player: string;

  test.beforeAll(async ({ request }) => {
    await signInViaRequest(request);
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
      prefix: 'mviewer',
    });
    expect(setup).toBeTruthy();
    const [team1, team2] = [setup!.teams[0], setup!.teams[1]];
    team1Id = team1.id;
    team2Id = team2.id;
    team1Player = actingSteamIdFor(team1);
    team2Player = actingSteamIdFor(team2);
    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();
    slug = match!.slug;
  });

  test.afterEach(async ({ request }) => {
    await stopImpersonating(request);
  });

  const viewerTeamId = async (ctx: {
    get: (url: string) => Promise<{ ok(): boolean; json(): Promise<unknown> }>;
  }) => {
    const res = await ctx.get(`/api/matches/${slug}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { match: { viewerTeamId: string | null } };
    return body.match.viewerTeamId;
  };

  test('each team’s player gets their own team', TAGS, async ({ request }) => {
    await signInViaRequest(request);
    expect(await impersonatePlayer(request, team1Player)).toBe(true);
    expect(await viewerTeamId(request)).toBe(team1Id);
    expect(await stopImpersonating(request)).toBe(true);
    expect(await impersonatePlayer(request, team2Player)).toBe(true);
    expect(await viewerTeamId(request)).toBe(team2Id);
  });

  test('an admin on neither team gets null', TAGS, async ({ request }) => {
    await signInViaRequest(request);
    expect(await viewerTeamId(request)).toBeNull();
  });

  test('signed out gets null', TAGS, async () => {
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      expect(await viewerTeamId(anon)).toBeNull();
    } finally {
      await anon.dispose();
    }
  });
});
