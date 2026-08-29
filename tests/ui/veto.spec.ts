import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest, impersonatePlayer, stopImpersonating } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { performVetoActionsUI, getCSMajorBO1UIActions, viewVetoPageAs } from '../helpers/vetoUI';
import { getVetoState, actingSteamIdFor } from '../helpers/veto';
import type { Team } from '../helpers/teams';

/**
 * Veto UI tests
 *
 * Drives a full BO1 veto through the real interface. Veto lives on a player's own
 * profile page, so each step acts as the player whose turn it is (via admin
 * impersonation) — the UI only enables the board on your own profile and the API
 * authorizes by Steam identity.
 *
 * @tag ui
 * @tag veto
 * @tag maps
 * @tag sides
 */

test.describe.serial('Veto UI', () => {
  test.setTimeout(120000);

  let team1: Team;
  let team2: Team;
  let matchSlug: string;
  const maps = [
    'de_mirage',
    'de_inferno',
    'de_ancient',
    'de_anubis',
    'de_dust2',
    'de_vertigo',
    'de_nuke',
  ];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    // `page` and `request` have separate cookie jars – the API helpers below
    // use `request`, so it needs its own admin session.
    await signInViaRequest(request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamCount: 2,
      serverCount: 1,
      prefix: 'veto-ui',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;

    [team1, team2] = [setup.teams[0], setup.teams[1]];

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match).toBeTruthy();
    matchSlug = match!.slug;
  });

  test.afterEach(async ({ page, request }) => {
    // Never leave an impersonation cookie behind for the next test.
    await stopImpersonating(page.request);
    await stopImpersonating(request);
  });

  test(
    'should show the veto board on your own player page, with every map rendered',
    { tag: ['@ui', '@veto'] },
    async ({ page }) => {
      await viewVetoPageAs(page, actingSteamIdFor(team1));

      // Every map in the pool is rendered as its own card. This also guards the
      // card's `data-testid`, which silently rendered as
      // `veto-map-card-undefined` while the component destructured the wrong
      // prop name — the reason the earlier UI veto tests were deleted as flaky.
      for (const map of maps) {
        await expect(page.getByTestId(`veto-map-card-${map}`)).toBeVisible();
      }
    }
  );

  test(
    "should not expose the veto board on another player's page",
    { tag: ['@ui', '@veto', '@security'] },
    async ({ page }) => {
      // Signed in as a team1 player, but viewing a team2 player's profile.
      const impersonated = await impersonatePlayer(page.request, actingSteamIdFor(team1));
      expect(impersonated).toBe(true);

      await page.goto(`/player/${actingSteamIdFor(team2)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('domcontentloaded');

      // The profile itself is public, but the veto controls are not.
      await expect(page.getByTestId('veto-interface')).toHaveCount(0);
    }
  );

  test(
    'should complete a CS Major BO1 veto through the UI',
    { tag: ['@ui', '@veto', '@cs-major', '@bo1'] },
    async ({ page, request }) => {
      const actions = getCSMajorBO1UIActions(team1, team2);
      await performVetoActionsUI(page, actions);

      // Read the authoritative state back as a team member – spectators get a
      // redacted view without step/ban details.
      const vetoState = await getVetoState(request, matchSlug, actingSteamIdFor(team1));
      expect(vetoState).toBeTruthy();
      expect(vetoState.status).toBe('completed');

      // Six bans leave de_mirage as the decider.
      expect(vetoState.pickedMaps).toHaveLength(1);
      expect(vetoState.pickedMaps[0].mapName).toBe('de_mirage');

      // Team B picked CT, so Team A starts T.
      expect(vetoState.pickedMaps[0].sideTeam2).toBe('CT');
      expect(vetoState.pickedMaps[0].sideTeam1).toBe('T');
    }
  );

  test(
    'should block a team from acting out of turn',
    { tag: ['@ui', '@veto', '@security'] },
    async ({ request }) => {
      // Step 1 belongs to team1. Acting as team2 must be rejected, and the veto
      // must stay untouched.
      const impersonated = await impersonatePlayer(request, actingSteamIdFor(team2));
      expect(impersonated).toBe(true);

      const response = await request.post(`/api/veto/${matchSlug}/action`, {
        data: { mapName: 'de_mirage', teamSlug: team2.id },
      });

      expect(response.status()).toBe(403);
      expect((await response.text()).toLowerCase()).toContain('not your turn');

      await stopImpersonating(request);

      const vetoState = await getVetoState(request, matchSlug, actingSteamIdFor(team1));
      expect(vetoState.bannedMaps).toHaveLength(0);
      expect(vetoState.currentStep).toBe(1);
    }
  );
});
