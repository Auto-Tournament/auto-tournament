import { test, expect, type Page } from '@playwright/test';
import { openOwnMatchRoom } from '../helpers/matchRoom';
import {
  ensureSignedIn,
  signInViaRequest,
  impersonatePlayer,
  stopImpersonating,
} from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { actingSteamIdFor } from '../helpers/veto';
import type { Team } from '../helpers/teams';
import { sendReadyUpEvents, goingLive } from '../helpers/readyUp';

/**
 * "Copy Console Command" without a secure context.
 *
 * `navigator.clipboard` exists only on HTTPS and localhost. Plenty of MAT
 * instances run over plain HTTP on a LAN, and there the button used to do
 * nothing at all — the reported bug.
 *
 * The suite itself runs on localhost, which *is* a secure context, so these
 * tests remove `navigator.clipboard` before the page loads to reproduce what a
 * LAN user actually gets. `document.execCommand` is stubbed so the assertions
 * do not depend on a real system clipboard, which headless browsers do not
 * reliably provide.
 *
 * @tag ui
 * @tag regression
 */

/** Reproduce a plain-HTTP origin, with execCommand reporting `success`. */
async function withInsecureClipboard(page: Page, success: boolean) {
  await page.addInitScript((execSucceeds) => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    (window as unknown as { __copiedText?: string }).__copiedText = undefined;
    document.execCommand = ((command: string) => {
      if (command !== 'copy') return false;
      const active = document.activeElement as { value?: string } | null;
      (window as unknown as { __copiedText?: string }).__copiedText = active?.value;
      return execSucceeds;
    }) as typeof document.execCommand;
  }, success);
}

test.describe.serial('Copy console command over plain HTTP', () => {
  test.setTimeout(120000);

  let team1: Team;
  let team2: Team;

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
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
      prefix: 'copy-cmd',
    });
    expect(setup).toBeTruthy();
    [team1, team2] = [setup!.teams[0], setup!.teams[1]];

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();

    // The connect panel only appears once a server is actually assigned *and*
    // reporting itself online — otherwise the page sits on "Waiting for Server
    // Assignment" and there is no button to click.
    const serverId = setup!.servers[0].id;
    const state = await request.post('/api/test/match-state', {
      data: { slug: match!.slug, serverId, status: 'loaded' },
    });
    expect(state.ok()).toBe(true);

    // The map goes live on the server (Ready Up's event), so the panel has a
    // live match to show.
    await sendReadyUpEvents(request, match!.slug, [goingLive(1)]);
  });

  test.afterEach(async ({ page, request }) => {
    await stopImpersonating(page.request);
    await stopImpersonating(request);
  });

  test(
    'copies the command even though the Clipboard API is unavailable',
    { tag: ['@ui', '@regression'] },
    async ({ page }) => {
      const steamId = actingSteamIdFor(team1);
      expect(await impersonatePlayer(page.request, steamId)).toBe(true);

      await withInsecureClipboard(page, true);
      await openOwnMatchRoom(page);

      const copyButton = page.getByRole('button', { name: /Copy Console Command/i });
      await expect(copyButton).toBeVisible({ timeout: 20000 });
      await copyButton.click();

      // The button reporting success is the whole point: on a LAN it used to do
      // nothing whatsoever.
      await expect(page.getByRole('button', { name: /Copied/i })).toBeVisible({ timeout: 10000 });

      const copiedText = await page.evaluate(
        () => (window as unknown as { __copiedText?: string }).__copiedText
      );
      expect(copiedText, 'the connect command should be what got copied').toContain('connect ');
    }
  );

  test(
    'shows the command to copy by hand when the browser refuses entirely',
    { tag: ['@ui', '@regression'] },
    async ({ page }) => {
      const steamId = actingSteamIdFor(team1);
      expect(await impersonatePlayer(page.request, steamId)).toBe(true);

      await withInsecureClipboard(page, false);
      await openOwnMatchRoom(page);

      const copyButton = page.getByRole('button', { name: /Copy Console Command/i });
      await expect(copyButton).toBeVisible({ timeout: 20000 });
      await copyButton.click();

      // Last resort, but never silence.
      await expect(page.getByText(/Run in console:/i)).toBeVisible({ timeout: 10000 });
    }
  );
});
