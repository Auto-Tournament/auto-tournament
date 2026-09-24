import { test, expect, type APIRequestContext, type Page, type Route } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';

/**
 * Code modules never hold back the page (DESIGN-module-client-api §4.2).
 *
 * Every visitor's browser asks `GET /api/modules/public` which code modules to
 * load. The app renders at once regardless; only a slot a module owns waits,
 * showing a small pending state, and turns into the module's component when
 * it arrives, or into what the page shows without it once loading settles.
 *
 * The browser's requests are stubbed here, so the manifest and the module's
 * code arrive exactly when the test says. The module is served from its real
 * place under `/api/modules/<id>/client/` and loads through the real loader,
 * import map and shared packages; it claims the catalogue game
 * `rocket-league`, which manual reporting runs otherwise, and fills the team
 * page's `teamAdminPanel` slot.
 *
 * @tag ui
 * @tag modules
 */

const MR = '/api/test/integration/manual-report';
const MODULE_ID = 'e2e-late-module';
const ENTRY = `/api/modules/${MODULE_ID}/client/index.js`;

const SLOT_TEXT = 'Rendered by the late module';

/**
 * A valid client module: React and i18next from the host (through the import
 * map), one slot, and its own strings, which the slot draws from its first
 * render.
 */
const MODULE_SOURCE = `
import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
const Slot = () => {
  const { t } = useTranslation(${JSON.stringify(MODULE_ID)});
  return createElement('div', { 'data-testid': 'e2e-module-slot' }, t('slot.label'));
};
export default {
  id: ${JSON.stringify(MODULE_ID)},
  locales: { en: { slot: { label: ${JSON.stringify(SLOT_TEXT)} } } },
  capabilities: { servers: false, veto: false, liveEvents: false, demos: false, playerStats: false },
  catalogGames: ['rocket-league'],
  teamAdminPanel: Slot,
  matchPanels: {},
  tournamentSetupSteps: {},
  standaloneMatchSteps: {},
  resourceDialogs: {},
  dashboardWidgets: {},
  routes: [],
  navItems: [],
};
`;

const MANIFEST = {
  success: true,
  modules: [
    { id: MODULE_ID, version: '1.0.0', clientApi: '^0.1.0', client: { entry: ENTRY } },
  ],
};

/** A request held until `release()`: what a slow API looks like to the browser. */
function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

/** Stub the manifest; `hold` keeps it unanswered until released. */
async function stubManifest(page: Page, body: unknown, hold?: Promise<void>): Promise<() => boolean> {
  let asked = false;
  await page.route('**/api/modules/public', async (route: Route) => {
    asked = true;
    if (hold) await hold;
    await route.fulfill({ json: body }).catch(() => undefined);
  });
  return () => asked;
}

/** A rocket-league tournament (manual reporting runs it) with two teams, not started. */
async function rocketLeagueTournament(admin: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}`.slice(-7);
  const teamIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const id = `modload-${stamp}-${index}`;
    const res = await admin.post('/api/teams', {
      data: {
        id,
        name: `Module loading ${stamp} ${index}`,
        players: [{ steamId: `76561199${stamp}${index}5`, name: `Loader ${index}` }],
      },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    teamIds.push(id);
  }
  const created = await admin.post(`${MR}/tournament`, {
    data: {
      name: 'Module loading',
      type: 'single_elimination',
      format: 'bo1',
      game: 'rocket-league',
      teamIds,
    },
  });
  expect(created.status(), `creating: ${await created.text()}`).toBe(200);
  return teamIds[0];
}

test.describe('Code modules load without holding the page back', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test(
    'the page renders while the manifest is still unanswered, and draws no loading state',
    { tag: ['@ui', '@modules'] },
    async ({ page }) => {
      await ensureSignedIn(page);
      const held = gate();
      const asked = await stubManifest(page, { success: true, modules: [] }, held.wait);

      try {
        // An admin page, with the manifest unanswered the whole time.
        await page.goto('/modules');
        await expect(page.getByTestId('modules-page')).toBeVisible();
        await expect(page.getByTestId('module-cs2')).toBeVisible();
        expect(asked(), 'the manifest was asked for, and is still unanswered').toBe(true);
        // Nothing listed yet, so nothing is drawn as "loading".
        await expect(page.getByTestId('module-pending')).toHaveCount(0);
        await expect(page.getByTestId('module-route-pending')).toHaveCount(0);
      } finally {
        held.release();
      }
    }
  );

  test(
    'a signed-out visitor gets the page while the manifest is still unanswered',
    { tag: ['@ui', '@modules'] },
    async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const held = gate();
      try {
        const asked = await stubManifest(page, { success: true, modules: [] }, held.wait);
        await page.goto('/login');
        // The login page set its own title: it rendered.
        await expect(page).toHaveTitle(/Login/i);
        expect(asked(), 'the manifest was asked for, and is still unanswered').toBe(true);
      } finally {
        held.release();
        await context.close();
      }
    }
  );

  test.describe.serial('a slot a code module owns', () => {
    test.setTimeout(90_000);
    let teamId = '';

    test.beforeEach(async ({ page, request }) => {
      expect(await signInViaRequest(request)).toBe(true);
      await request.delete('/api/tournament');
      teamId = await rocketLeagueTournament(request);
      await ensureSignedIn(page);
    });

    test.afterEach(async ({ request }) => {
      await signInViaRequest(request);
      await request.delete('/api/tournament');
    });

    test(
      'is pending while its module loads, then the module',
      { tag: ['@ui', '@modules'] },
      async ({ page }) => {
        // Every text the slot is ever drawn with, from its first frame.
        await page.addInitScript(() => {
          const seen: string[] = [];
          (window as unknown as { __slotTexts: string[] }).__slotTexts = seen;
          new window.MutationObserver(() => {
            const slot = document.querySelector('[data-testid="e2e-module-slot"]');
            const text = slot?.textContent ?? null;
            if (text !== null && seen[seen.length - 1] !== text) seen.push(text);
          }).observe(document, { childList: true, subtree: true, characterData: true });
        });
        await stubManifest(page, MANIFEST);
        const code = gate();
        await page.route(`**${ENTRY}`, async (route) => {
          await code.wait;
          await route
            .fulfill({ status: 200, contentType: 'text/javascript', body: MODULE_SOURCE })
            .catch(() => undefined);
        });

        try {
          await page.goto(`/team/${teamId}`);
          // The page itself is there; only the module's slot waits.
          await expect(page.getByTestId('team-match-view-profile-link')).toBeVisible();
          await expect(page.getByTestId('module-pending')).toBeVisible();
          await expect(page.getByTestId('e2e-module-slot')).toHaveCount(0);
          // Not manual reporting's panel in the meantime: the code module
          // claims this game, and may yet arrive.
          await expect(page.getByTestId('team-captains-card')).toHaveCount(0);
          await expect(page.getByTestId('module-not-installed')).toHaveCount(0);
        } finally {
          code.release();
        }

        // It arrives: the same page, now with the module's component, no reload.
        await expect(page.getByTestId('e2e-module-slot')).toHaveText(SLOT_TEXT);
        await expect(page.getByTestId('module-pending')).toHaveCount(0);
        // Its strings were registered before it first drew: never the bare key.
        const texts = await page.evaluate(
          () => (window as unknown as { __slotTexts: string[] }).__slotTexts
        );
        expect(texts).toEqual([SLOT_TEXT]);
      }
    );

    test(
      'whose module never arrives ends as the page without it, within the timeouts',
      { tag: ['@ui', '@modules'] },
      async ({ page }) => {
        await stubManifest(page, MANIFEST);
        // The code never answers: the loader's 10-second import timeout, then
        // its diagnosis of the URL, bounded by the 20-second boot deadline,
        // settle it.
        await page.route(`**${ENTRY}`, () => new Promise<void>(() => undefined));

        await page.goto(`/team/${teamId}`);
        await expect(page.getByTestId('team-match-view-profile-link')).toBeVisible();
        await expect(page.getByTestId('module-pending')).toBeVisible();

        // Within the timeouts, the slot is what it is without code modules:
        // manual reporting runs rocket-league, so its captains card.
        await expect(page.getByTestId('module-pending')).toHaveCount(0, { timeout: 30_000 });
        await expect(page.getByTestId('team-captains-card')).toBeVisible();
        await expect(page.getByTestId('e2e-module-slot')).toHaveCount(0);
      }
    );
  });
});
