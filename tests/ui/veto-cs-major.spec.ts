import { test, expect } from '@playwright/test';
import {
  ensureSignedIn,
  signInViaRequest,
  stopImpersonating,
  impersonatePlayer,
} from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import {
  performVetoActionsUI,
  getCSMajorBO1UIActions,
  getCSMajorBO3UIActions,
  viewVetoPageAs,
} from '../helpers/vetoUI';
import { getVetoState, actingSteamIdFor } from '../helpers/veto';
import type { Team } from '../helpers/teams';

/**
 * CS Major Veto Format UI tests
 *
 * Drives the full CS Major BO1 and BO3 veto sequences through the real
 * interface, then verifies the resulting match config the game servers consume.
 *
 * Each step acts as a player on the team whose turn it is (via admin
 * impersonation): the board only renders on a player's own profile page, and the
 * API authorizes every action by Steam identity.
 *
 * @tag ui
 * @tag veto
 * @tag cs-major
 * @tag e2e-flow
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

/**
 * Open a player's page as that player, without requiring the veto board to be
 * present (it is gone once veto completes).
 */
async function impersonateAndOpenPlayerPage(page: import('@playwright/test').Page, steamId: string) {
  const ok = await impersonatePlayer(page.request, steamId);
  expect(ok, `Failed to impersonate ${steamId}`).toBe(true);
  await page.goto(`/player/${steamId}`, { waitUntil: 'domcontentloaded' });
}

test.describe.serial('CS Major BO1 Veto - UI E2E', () => {
  test.setTimeout(120000);

  let team1: Team;
  let team2: Team;
  let matchSlug: string;

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    // `page` and `request` have separate cookie jars – the API helpers below
    // use `request`, so it needs its own admin session.
    await signInViaRequest(request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: MAPS,
      teamCount: 2,
      serverCount: 1,
      prefix: 'cs-major-bo1-ui',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;

    [team1, team2] = [setup.teams[0], setup.teams[1]];

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match).toBeTruthy();
    matchSlug = match!.slug;
  });

  test.afterEach(async ({ page, request }) => {
    await stopImpersonating(page.request);
    await stopImpersonating(request);
  });

  test(
    'should complete a BO1 veto in the UI and produce a matching server config',
    { tag: ['@ui', '@veto', '@cs-major', '@bo1'] },
    async ({ page, request }) => {
      await performVetoActionsUI(page, getCSMajorBO1UIActions(team1, team2));

      const vetoState = await getVetoState(request, matchSlug, actingSteamIdFor(team1));
      expect(vetoState).toBeTruthy();
      expect(vetoState.status).toBe('completed');
      expect(vetoState.pickedMaps).toHaveLength(1);
      expect(vetoState.pickedMaps[0].mapName).toBe('de_mirage');

      // The config is regenerated on veto completion; poll until it lands.
      await expect
        .poll(
          async () => {
            const response = await request.get(`/api/matches/${matchSlug}.json`);
            if (!response.ok()) return null;
            const config = await response.json();
            return config.maplist?.[0] ?? null;
          },
          { message: 'match config to reflect the veto result', timeout: 10000 }
        )
        .toBe('de_mirage');

      const config = await (await request.get(`/api/matches/${matchSlug}.json`)).json();
      expect(config.num_maps).toBe(1);
      expect(config.maplist).toEqual(['de_mirage']);
      // Team B picked CT on the decider.
      expect(config.map_sides).toEqual(['team2_ct']);
    }
  );

  test(
    'should hand off from the veto board to match details once veto completes',
    { tag: ['@ui', '@veto', '@cs-major', '@bo1'] },
    async ({ page, request }) => {
      const steamId = actingSteamIdFor(team1);

      // Mid-veto the board is up and no match details are shown yet.
      await viewVetoPageAs(page, steamId);
      await expect(page.getByTestId('match-details')).toHaveCount(0);

      await performVetoActionsUI(page, getCSMajorBO1UIActions(team1, team2));

      const state = await getVetoState(request, matchSlug, steamId);
      expect(state?.status).toBe('completed');

      // Once veto is done the board is replaced by the match view, which names
      // the map that survived the veto.
      await impersonateAndOpenPlayerPage(page, steamId);
      await expect(page.getByTestId('match-details')).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId('veto-interface')).toHaveCount(0);
      await expect(page.getByTestId('match-details')).toContainText('Mirage');
    }
  );
});

test.describe.serial('CS Major BO3 Veto - UI E2E', () => {
  // 9 veto steps, each a page load plus an API round trip.
  test.setTimeout(180000);

  let team1: Team;
  let team2: Team;
  let matchSlug: string;

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    // `page` and `request` have separate cookie jars – the API helpers below
    // use `request`, so it needs its own admin session.
    await signInViaRequest(request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo3',
      maps: MAPS,
      teamCount: 2,
      serverCount: 1,
      prefix: 'cs-major-bo3-ui',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;

    [team1, team2] = [setup.teams[0], setup.teams[1]];

    let match: Awaited<ReturnType<typeof findMatchByTeams>> = null;
    await expect
      .poll(
        async () => {
          match = await findMatchByTeams(request, team1.id, team2.id);
          return Boolean(match);
        },
        { message: 'BO3 match to be created', timeout: 10000, intervals: [500, 1000] }
      )
      .toBe(true);

    expect(match).toBeTruthy();
    matchSlug = match!.slug;
  });

  test.afterEach(async ({ page, request }) => {
    await stopImpersonating(page.request);
    await stopImpersonating(request);
  });

  test(
    'should complete all 9 BO3 veto steps in the UI with correct sides per map',
    { tag: ['@ui', '@veto', '@cs-major', '@bo3'] },
    async ({ page, request }) => {
      await performVetoActionsUI(page, getCSMajorBO3UIActions(team1, team2));

      const vetoState = await getVetoState(request, matchSlug, actingSteamIdFor(team1));
      expect(vetoState).toBeTruthy();
      expect(vetoState.status).toBe('completed');
      expect(vetoState.pickedMaps).toHaveLength(3);

      // Map 1: team1's pick, team2 chose CT.
      expect(vetoState.pickedMaps[0].mapName).toBe('de_anubis');
      expect(vetoState.pickedMaps[0].sideTeam2).toBe('CT');
      expect(vetoState.pickedMaps[0].sideTeam1).toBe('T');

      // Map 2: team2's pick, team1 chose T.
      expect(vetoState.pickedMaps[1].mapName).toBe('de_dust2');
      expect(vetoState.pickedMaps[1].sideTeam1).toBe('T');
      expect(vetoState.pickedMaps[1].sideTeam2).toBe('CT');

      // Map 3: the decider, team2 chose CT — sides are picked, so no knife round.
      expect(vetoState.pickedMaps[2].mapName).toBe('de_ancient');
      expect(vetoState.pickedMaps[2].sideTeam2).toBe('CT');
      expect(vetoState.pickedMaps[2].sideTeam1).toBe('T');
      expect(vetoState.pickedMaps[2].knifeRound).toBe(false);
    }
  );

  test(
    'should produce a BO3 server config in veto order',
    { tag: ['@ui', '@veto', '@cs-major', '@bo3', '@verification'] },
    async ({ page, request }) => {
      const state = await getVetoState(request, matchSlug, actingSteamIdFor(team1));
      if (state?.status !== 'completed') {
        await performVetoActionsUI(page, getCSMajorBO3UIActions(team1, team2));
      }

      await expect
        .poll(
          async () => {
            const response = await request.get(`/api/matches/${matchSlug}.json`);
            if (!response.ok()) return null;
            const config = await response.json();
            return config.maplist?.length ?? null;
          },
          { message: 'BO3 match config to be generated', timeout: 10000 }
        )
        .toBe(3);

      const config = await (await request.get(`/api/matches/${matchSlug}.json`)).json();
      expect(config.num_maps).toBe(3);
      expect(config.maplist).toEqual(['de_anubis', 'de_dust2', 'de_ancient']);
      // team2 CT on maps 1 and 3, team1 T on map 2 (so team2 is CT there too).
      expect(config.map_sides).toEqual(['team2_ct', 'team2_ct', 'team2_ct']);
    }
  );
});
