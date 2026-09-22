import { test, expect, type Page } from '@playwright/test';
import { signInViaRequest, stopImpersonating } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { updateTeam } from '../helpers/teams';
import { actingSteamIdFor, executeVetoActions } from '../helpers/veto';
import type { Team } from '../helpers/teams';

/**
 * An admin who is also a player can veto for their own team.
 *
 * Every other veto test drives the board through admin *impersonation*, which
 * exercises a different identity path: the acting player is a plain player and
 * the admin is only lending them a session. This covers the reported case
 * instead — one human who is both `is_admin = 1` and on a team roster, acting
 * as themselves, with no impersonation cookie in play.
 *
 * Veto is driven from the player's own profile page. The team page has no veto
 * board for anyone, admin or not.
 *
 * ## Why these two Steam IDs are not the shared fixtures
 *
 * Signing in as an admin permanently sets `is_admin` on that player row, and
 * the database is shared across the whole run. Promoting one of the fixture
 * Steam IDs in `helpers/teams.ts` breaks every later suite that impersonates
 * it, because an admin may not impersonate another admin. These two IDs belong
 * to this spec alone and are added to the rosters here.
 *
 * @tag ui
 * @tag veto
 */
const TEAM1_ADMIN_PLAYER = '76561198900000101';
const TEAM2_ADMIN_PLAYER = '76561198900000102';

test.describe.serial('Veto as an admin who also plays', () => {
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
    await signInViaRequest(request);
    await signInViaRequest(page.request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamCount: 2,
      serverCount: 1,
      prefix: 'veto-admin-player',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;

    [team1, team2] = [setup.teams[0], setup.teams[1]];

    // Put this spec's own players on the rosters. The veto resolver treats the
    // teams table as authoritative, so this is enough to make them members.
    for (const [team, steamId] of [
      [team1, TEAM1_ADMIN_PLAYER],
      [team2, TEAM2_ADMIN_PLAYER],
    ] as const) {
      const updated = await updateTeam(request, team.id, {
        players: [...team.players, { steamId, name: 'Admin Who Plays' }],
      });
      expect(updated, `should add ${steamId} to ${team.id}`).toBeTruthy();
    }

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match).toBeTruthy();
    matchSlug = match!.slug;
  });

  test.afterEach(async ({ page, request }) => {
    await stopImpersonating(page.request);
    await stopImpersonating(request);
  });

  /**
   * Open the veto board on `steamId`'s own profile and ban `mapName`,
   * asserting the resulting action request succeeds.
   */
  async function banAsSelf(page: Page, steamId: string, mapName: string) {
    await page.goto(`/player/${steamId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('veto-interface')).toBeVisible({ timeout: 20000 });

    const actionResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/veto/${matchSlug}/action`) && r.request().method() === 'POST',
      { timeout: 20000 }
    );

    const mapCard = page.getByTestId(`veto-map-card-${mapName}`);
    await expect(mapCard).toBeVisible({ timeout: 20000 });
    await mapCard.click();

    const response = await actionResponse;
    expect(
      response.ok(),
      `Ban of ${mapName} as admin-player ${steamId} failed: ${await response
        .text()
        .catch(() => 'no body')}`
    ).toBe(true);
  }

  test(
    'bans on the first step of the order',
    { tag: ['@ui', '@veto'] },
    async ({ page }) => {
      // Sign in *as* the team1 roster member: the session's real identity is
      // now both admin and player, with nothing impersonated.
      expect(await signInViaRequest(page.request, TEAM1_ADMIN_PLAYER)).toBe(true);

      await banAsSelf(page, TEAM1_ADMIN_PLAYER, 'de_inferno');
    }
  );

  test(
    'bans mid-order, once the other team has acted',
    { tag: ['@ui', '@veto'] },
    async ({ page, request }) => {
      // Team1 takes its two opening bans as an ordinary impersonated player, so
      // the turn has genuinely moved on before the admin-player acts.
      const team1Actor = actingSteamIdFor(team1);
      const played = await executeVetoActions(request, matchSlug, [
        { mapName: 'de_inferno', teamSlug: team1.id, actAsSteamId: team1Actor },
        { mapName: 'de_ancient', teamSlug: team1.id, actAsSteamId: team1Actor },
      ]);
      expect(played, 'team1 should complete its two opening bans').toBeTruthy();

      expect(await signInViaRequest(page.request, TEAM2_ADMIN_PLAYER)).toBe(true);

      await banAsSelf(page, TEAM2_ADMIN_PLAYER, 'de_dust2');
    }
  );
});
