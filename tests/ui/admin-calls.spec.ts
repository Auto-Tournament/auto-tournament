import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { signInViaRequest } from '../helpers/auth';
import { adminCalled, createReadyUpServer, sendReadyUpEvents } from '../helpers/readyUp';

/**
 * The admin call toast: a player's `.admin` call (Ready Up `admin_called` on
 * the fleet link) shows on every admin page, stays through navigation and a
 * reload, has no close button, and goes away only when an admin resolves it —
 * here, or anywhere else (live, over the socket).
 *
 * @tag ui
 * @tag admin-calls
 */

function uniqueCallId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The Ready Up server the calls come from (beforeAll). */
let serverId = '';

async function callAdmin(
  request: APIRequestContext,
  callId: string,
  player: string,
  message: string
): Promise<number> {
  await sendReadyUpEvents(
    request,
    `no-match-${callId}`,
    [adminCalled({ callId, steamId: '76561198000000077', name: player, team: 'team1', message })],
    serverId
  );
  let id = 0;
  await expect
    .poll(async () => {
      const res = await request.get('/api/admin-calls');
      const body = (await res.json()) as { open: Array<{ id: number; callId: string }> };
      id = body.open.find((c) => c.callId === callId)?.id ?? 0;
      return id;
    })
    .toBeGreaterThan(0);
  return id;
}

function toastFor(page: Page, callId: string) {
  return page.locator(`[data-testid="admin-call-toast"][data-call-id="${callId}"]`);
}

test.describe.serial('Admin call toast', () => {
  test.beforeAll(async ({ request }) => {
    await signInViaRequest(request);
    serverId = (await createReadyUpServer(request, 'ui-admin-call')).fleetId;
  });

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    // Playwright's Chromium lets any page play sound. A real browser refuses
    // until the person has interacted with the page; behave like one, with
    // an activation flag of our own that every page load starts without.
    await page.addInitScript(() => {
      let active = false;
      const activate = () => {
        active = true;
      };
      window.addEventListener('pointerdown', activate, true);
      window.addEventListener('keydown', activate, true);
      Object.defineProperty(window.navigator, 'userActivation', {
        configurable: true,
        get: () => ({ hasBeenActive: active, isActive: active }),
      });
      const proto = window.HTMLMediaElement.prototype;
      const play = proto.play;
      proto.play = function (this: InstanceType<typeof window.HTMLMediaElement>) {
        if (!active) {
          return Promise.reject(
            new window.DOMException('play() needs a user gesture', 'NotAllowedError')
          );
        }
        return play.call(this);
      };
    });
    // Start from no open calls, so the stack only holds this test's.
    await request.post('/api/admin-calls/resolve-all', { data: {} });
    await page.goto('/manage', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
  });

  // An open call's stack sits over every admin page; leave none for the next spec.
  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.post('/api/admin-calls/resolve-all', { data: {} });
  });

  test(
    'appears live, survives navigation and reload, and goes on resolve',
    { tag: ['@ui', '@admin-calls'] },
    async ({ page, request }) => {
      const callId = uniqueCallId('ui');
      await callAdmin(request, callId, 'Toast Tester', 'Server is lagging');

      const toast = toastFor(page, callId);
      await expect(toast).toBeVisible({ timeout: 15_000 });
      await expect(toast).toContainText('Toast Tester');
      await expect(toast).toContainText('Server is lagging');
      await expect(toast.getByTestId('admin-call-team')).toContainText('CT');
      await expect(toast).toContainText('ui-admin-call');
      // Persistent: nothing on it hides the call without resolving it.
      await expect(toast.getByTestId('snackbar-close-button')).toHaveCount(0);
      await expect(toast.getByRole('button', { name: /close|dismiss/i })).toHaveCount(0);

      // Still there after a while, on another admin page, and after a reload.
      await page.waitForTimeout(6_000);
      await expect(toast).toBeVisible();
      await page.goto('/manage/teams', { waitUntil: 'domcontentloaded' });
      await expect(toastFor(page, callId)).toBeVisible({ timeout: 15_000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(toastFor(page, callId)).toBeVisible({ timeout: 15_000 });

      // Minimize keeps the count, and shows the call again on demand.
      await page.getByTestId('admin-calls-minimize').click();
      await expect(toastFor(page, callId)).toHaveCount(0);
      await expect(page.getByTestId('admin-calls')).toContainText('(1)');
      await page.getByTestId('admin-calls-minimize').click();
      await expect(toastFor(page, callId)).toBeVisible();

      await toastFor(page, callId).getByTestId('admin-call-resolve').click();
      await expect(toastFor(page, callId)).toHaveCount(0);
      await expect(page.getByTestId('admin-calls')).toHaveCount(0);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1_500);
      await expect(toastFor(page, callId)).toHaveCount(0);
    }
  );

  test(
    "another admin's resolve removes it live",
    { tag: ['@ui', '@admin-calls'] },
    async ({ page, request }) => {
      const callId = uniqueCallId('ui-other');
      const id = await callAdmin(request, callId, 'Second Caller', '');
      const toast = toastFor(page, callId);
      await expect(toast).toBeVisible({ timeout: 15_000 });
      await expect(toast.getByTestId('admin-call-message')).toHaveText('No message');

      // Resolved from another session (the `request` context), not this page.
      const res = await request.post(`/api/admin-calls/${id}/resolve`, { data: {} });
      expect(res.ok()).toBe(true);
      await expect(toast).toHaveCount(0, { timeout: 15_000 });
    }
  );

  test(
    'the mute choice is remembered in this browser',
    { tag: ['@ui', '@admin-calls'] },
    async ({ page, request }) => {
      const callId = uniqueCallId('ui-mute');
      await callAdmin(request, callId, 'Mute Tester', 'ping');
      await expect(toastFor(page, callId)).toBeVisible({ timeout: 15_000 });

      // Nobody has interacted with the page yet, so the browser would block
      // the sound: the stack offers to enable it (a click unlocks audio).
      const enable = page.getByTestId('admin-calls-enable-sound');
      await expect(enable).toBeVisible();
      await enable.click();
      const mute = page.getByTestId('admin-calls-mute');
      await expect(mute).toBeVisible();
      await mute.click();
      await expect(mute).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => localStorage.getItem('mat.adminCalls.soundMuted'))).toBe(
        'true'
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('admin-calls-mute')).toHaveAttribute('aria-pressed', 'true', {
        timeout: 15_000,
      });
      await page.getByTestId('admin-calls-mute').click();
      expect(await page.evaluate(() => localStorage.getItem('mat.adminCalls.soundMuted'))).toBe(
        'false'
      );
    }
  );
});
