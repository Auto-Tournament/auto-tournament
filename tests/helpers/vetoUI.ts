import { Page, expect } from '@playwright/test';
import { impersonatePlayer, stopImpersonating } from './auth';
import { actingSteamIdFor } from './veto';
import type { Team } from './teams';

/**
 * UI helper functions for veto interactions.
 *
 * Performs veto actions by clicking real UI elements rather than calling the API.
 *
 * ## Acting as a team
 *
 * Veto is driven from a player's **own** profile page (`/player/:steamId`): the
 * page only enables the board when the signed-in Steam ID matches the profile
 * being viewed, and the API authorizes each action from the caller's Steam
 * identity. An admin therefore cannot drive the veto directly. These helpers use
 * admin impersonation to become a player on the acting team, which is what makes
 * an end-to-end UI veto testable at all.
 */

export interface VetoUIAction {
  action: 'ban' | 'pick' | 'side_pick';
  mapName?: string;
  side?: 'CT' | 'T';
  /** Team acting on this step. */
  teamSlug: string;
  /** Steam ID of a player on `teamSlug`; the browser acts as this player. */
  actAsSteamId: string;
}

/**
 * Switch the browser session to a given player and open their own player page.
 *
 * `page.request` shares the browser context's cookie jar, so impersonating
 * through it applies to subsequent page navigations.
 */
export async function viewVetoPageAs(page: Page, steamId: string): Promise<void> {
  const ok = await impersonatePlayer(page.request, steamId);
  expect(ok, `Failed to impersonate ${steamId}`).toBe(true);

  await page.goto(`/player/${steamId}`, { waitUntil: 'domcontentloaded' });

  // The veto interface is rendered only after the player's current match resolves.
  await expect(page.getByTestId('veto-interface')).toBeVisible({ timeout: 20000 });
}

/**
 * Perform a single veto action via the UI.
 *
 * Waits on the action's own network response rather than fixed sleeps, which is
 * what made the previous version of these tests flaky.
 */
export async function performVetoActionUI(page: Page, action: VetoUIAction): Promise<void> {
  await viewVetoPageAs(page, action.actAsSteamId);

  const actionResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/veto/`) &&
      response.url().endsWith('/action') &&
      response.request().method() === 'POST',
    { timeout: 20000 }
  );

  if (action.action === 'side_pick') {
    const sideTestId = action.side === 'CT' ? 'veto-side-ct-button' : 'veto-side-t-button';
    const sideButton = page.getByTestId(sideTestId);

    await expect(sideButton).toBeVisible({ timeout: 20000 });
    await expect(sideButton).toBeEnabled({ timeout: 10000 });
    await sideButton.click();
  } else {
    if (!action.mapName) {
      throw new Error(`Map name is required for a ${action.action} action`);
    }

    const mapCard = page.getByTestId(`veto-map-card-${action.mapName}`);
    await expect(mapCard).toBeVisible({ timeout: 20000 });
    await mapCard.click();
  }

  const response = await actionResponse;
  expect(
    response.ok(),
    `Veto ${action.action} (${action.mapName ?? action.side}) failed: ${await response
      .text()
      .catch(() => 'no body')}`
  ).toBe(true);
}

/**
 * Perform multiple veto actions via the UI, switching identity per step.
 *
 * Impersonation is always cleared afterwards, including on failure.
 */
export async function performVetoActionsUI(page: Page, actions: VetoUIAction[]): Promise<void> {
  try {
    for (const action of actions) {
      await performVetoActionUI(page, action);
    }
  } finally {
    await stopImpersonating(page.request);
  }
}

/**
 * CS Major BO1 veto, expressed as UI actions.
 *
 * Bans every map except de_mirage, which becomes the decider.
 */
export function getCSMajorBO1UIActions(team1: Team, team2: Team): VetoUIAction[] {
  const a = { teamSlug: team1.id, actAsSteamId: actingSteamIdFor(team1) };
  const b = { teamSlug: team2.id, actAsSteamId: actingSteamIdFor(team2) };

  return [
    { action: 'ban', mapName: 'de_inferno', ...a },
    { action: 'ban', mapName: 'de_ancient', ...a },
    { action: 'ban', mapName: 'de_dust2', ...b },
    { action: 'ban', mapName: 'de_nuke', ...b },
    { action: 'ban', mapName: 'de_anubis', ...b },
    { action: 'ban', mapName: 'de_vertigo', ...a },
    { action: 'side_pick', side: 'CT', ...b }, // Team B picks CT on remaining map (Mirage)
  ];
}

/**
 * CS Major BO3 veto, expressed as UI actions.
 *
 * Picks de_anubis (map 1) and de_dust2 (map 2); de_ancient is the decider.
 */
export function getCSMajorBO3UIActions(team1: Team, team2: Team): VetoUIAction[] {
  const a = { teamSlug: team1.id, actAsSteamId: actingSteamIdFor(team1) };
  const b = { teamSlug: team2.id, actAsSteamId: actingSteamIdFor(team2) };

  return [
    { action: 'ban', mapName: 'de_inferno', ...a },
    { action: 'ban', mapName: 'de_mirage', ...b },
    { action: 'pick', mapName: 'de_anubis', ...a },
    { action: 'side_pick', side: 'CT', ...b },
    { action: 'pick', mapName: 'de_dust2', ...b },
    { action: 'side_pick', side: 'T', ...a },
    { action: 'ban', mapName: 'de_vertigo', ...b },
    { action: 'ban', mapName: 'de_nuke', ...a },
    { action: 'side_pick', side: 'CT', ...b }, // Team B picks CT on decider (Ancient)
  ];
}
