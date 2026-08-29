import { Page } from '@playwright/test';

/**
 * Shared UI helpers.
 */

/**
 * Close any snackbars currently on screen.
 *
 * Snackbars are anchored bottom-right, which is exactly where dialog "Save"
 * buttons and the tournament wizard's "Next" button sit. A *persistent* snackbar
 * — the "Steam integration unavailable" warning shown whenever STEAM_API_KEY is
 * not configured, as in the sharded test containers — therefore covers those
 * controls indefinitely and swallows clicks aimed at them.
 *
 * Call this before interacting with bottom-right controls. It is a no-op when no
 * snackbar is showing.
 */
export async function dismissSnackbars(page: Page): Promise<void> {
  const closeButtons = page.getByTestId('snackbar-close-button');

  // Bounded loop: each click removes one toast, and notistack caps them at 5.
  for (let attempt = 0; attempt < 10; attempt++) {
    const count = await closeButtons.count();
    if (count === 0) return;

    // Always close the first one; the list re-indexes as toasts disappear.
    await closeButtons
      .first()
      .click({ timeout: 2000 })
      .catch(() => {
        // Toast may have auto-hidden between count() and click(); ignore.
      });
  }
}
