import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';

/**
 * A code module put on disk loads into the running app and renders on the
 * host's React (DESIGN-module-client-api.md §1, §3 and §4), end to end
 * against the release image.
 *
 * Each half has its own spec: the server loader (`tests/api/code-modules`)
 * and the client loader (`tests/api/module-client-loader`, in Node). This one
 * joins them. The fixture's `client/index.js` is written by the test-only
 * fixture helper (`moduleFixtureFiles` in `api/src/routes/test.ts`) the way a
 * module build emits it: plain ESM, React, MUI, the router and i18next left as
 * bare imports for the host's import map, and a `ClientGameIntegration` as its
 * default export with two admin routes, `/<id>` and `/<id>/next`.
 *
 * What is pinned:
 * - the page proves there is one React (`useState` works), the host's MUI
 *   theme, the host's router (path, and navigating it) and the host's i18next
 *   (language and resources) reach the module;
 * - a module the server refuses on its client API range is never fetched;
 * - a module built against an export React 18 does not have fails to link,
 *   and only that module is broken;
 * - a route that throws is caught by its slot's boundary;
 * - safe mode, and an instance with no code module, load no module code, no
 *   shims and not the loader chunk.
 *
 * The chunks: shims are `assets/module-shims/<stem>-<hash>.js`
 * (`client/vite-plugins/moduleShims.ts`), and the loader is the lazy
 * `assets/runtime-<hash>.js` chunk (`src/module-loader/runtime.ts`, imported
 * by `boot.ts`), which pulls in the shared-package registry's chunks.
 *
 * @tag ui
 * @tag modules
 */

interface ModuleRow {
  id: string;
  source: 'builtin' | 'disk';
  clientApi: string | null;
  enabled: boolean;
  status: 'ok' | 'incompatible' | 'broken' | 'disabled';
  reason: string | null;
  client: { entry: string } | null;
}

// Unique per run: a module the server loaded stays loaded until it restarts,
// and a retry must not find the previous attempt's fixture.
const RUN = Date.now().toString(36);
const VALID = `fixture-ui-valid-${RUN}`;
const CLIENT_INCOMPATIBLE = `fixture-ui-clientapi-${RUN}`;
const REACT19 = `fixture-ui-react19-${RUN}`;
const RENDER_THROWS = `fixture-ui-throws-${RUN}`;

/** The shims the import map points at, and the lazily loaded loader chunk. */
const SHIM_PATH = /^\/assets\/module-shims\//;
const LOADER_CHUNK = /^\/assets\/runtime-[\w-]+\.js$/;
/** Any code module's files. */
const MODULE_CODE = /^\/api\/modules\/[^/]+\/client\//;

// The Ultraviolet theme's accent (client/src/theme/themes.ts): not the
// default Ember, and not MUI's own default primary, so only the host's
// current theme can give a module this colour.
const HOST_THEME = 'ultraviolet';
const HOST_PRIMARY = '#9D7BFF';
const HOST_PRIMARY_RGB = 'rgb(157, 123, 255)';

async function listModules(request: APIRequestContext): Promise<ModuleRow[]> {
  const response = await request.get('/api/modules');
  expect(response.status(), `listing modules: ${await response.text()}`).toBe(200);
  return (await response.json()).modules;
}

async function moduleRow(request: APIRequestContext, id: string): Promise<ModuleRow> {
  const row = (await listModules(request)).find((module) => module.id === id);
  expect(row, `module ${id} should be listed`).toBeTruthy();
  return row!;
}

/** Writes a fixture, enables it and rescans: what an operator's restart would do. */
async function installEnabled(request: APIRequestContext, id: string, kind: string): Promise<void> {
  const written = await request.post('/api/test/modules/fixture', { data: { id, kind } });
  expect(written.status(), `writing fixture ${id}: ${await written.text()}`).toBe(200);
  const enabled = await request.post(`/api/modules/${id}/enable`);
  expect(enabled.status(), `enabling ${id}: ${await enabled.text()}`).toBe(200);
  const rescanned = await request.post('/api/test/modules/rescan');
  expect(rescanned.status(), `rescanning: ${await rescanned.text()}`).toBe(200);
}

/**
 * Every path this page requests from now on.
 *
 * Leaves the page first: `beforeEach` opened `/`, whose module boot may still
 * be fetching (a module that fails to link is fetched again to say why), and
 * its requests must not be counted as the next page's.
 */
async function recordRequests(page: Page): Promise<string[]> {
  await page.goto('about:blank');
  const paths: string[] = [];
  page.on('request', (req) => paths.push(new URL(req.url()).pathname));
  return paths;
}

/**
 * Waits until the routes rendered and a path a code module may own has
 * settled. Nothing holds the app back while modules load: the shell renders
 * at once, and a path no route matches yet shows a pending state
 * (`module-route-pending`) until the modules settle, then the module's page
 * or a 404. The boot deadline is 20 seconds. (The admin home has a <main> of
 * its own inside the shell's, hence `first()`.)
 */
async function waitForBoot(page: Page): Promise<void> {
  await expect(page.locator('main').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('module-route-pending')).toHaveCount(0, { timeout: 30_000 });
}

/** Client-side navigation, keeping this page load's loader state. */
async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new window.PopStateEvent('popstate'));
  }, path);
}

function statusChip(page: Page, id: string) {
  return page.getByTestId(`code-module-${id}-status`);
}

test.describe.serial('Code modules in the browser', () => {
  test.setTimeout(120_000);

  test.beforeAll(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await request.delete('/api/test/modules/fixtures');
  });

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/test/modules/fixtures');
  });

  test('with no code module enabled, no shim and no loader chunk is requested', {
    tag: ['@ui', '@modules'],
  }, async ({ page, request }) => {
    // CS2 is a code module on every instance that runs it (CI installs it
    // from the catalog), so the manifest is answered here as an instance with
    // no code module enabled answers it.
    await page.route('**/api/modules/public', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, modules: [] }) })
    );

    // The JavaScript index.html itself loads; anything else would be lazy.
    const html = await (await request.get('/')).text();
    const entryScripts = [
      ...html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*\bhref)="([^"]+\.js)"/g),
    ].map((m) => m[1]);
    expect(entryScripts.length, 'index.html should load an entry script').toBeGreaterThan(0);

    const requested = await recordRequests(page);
    const listed = page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/modules/public'
    );
    await page.goto('/');
    // The boot asked the public manifest, and it listed nothing, so the
    // absence below is the loader deciding, not the loader never running.
    const manifest = await listed;
    expect(manifest.status()).toBe(200);
    expect((await manifest.json()).modules).toEqual([]);
    await waitForBoot(page);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    expect(requested.filter((p) => SHIM_PATH.test(p)), 'shim requests').toEqual([]);
    expect(requested.filter((p) => LOADER_CHUNK.test(p)), 'loader chunk requests').toEqual([]);
    expect(requested.filter((p) => MODULE_CODE.test(p)), 'module code requests').toEqual([]);
    const scripts = requested.filter((p) => p.startsWith('/assets/') && p.endsWith('.js'));
    expect(
      scripts.filter((p) => !entryScripts.includes(p)),
      'no JavaScript beyond what index.html loads'
    ).toEqual([]);
  });

  test('the module is listed from disk, and its client entry is served as JavaScript', {
    tag: ['@ui', '@modules'],
  }, async ({ request }) => {
    await installEnabled(request, VALID, 'valid');

    const row = await moduleRow(request, VALID);
    expect(row).toMatchObject({ source: 'disk', enabled: true, status: 'ok', reason: null });
    expect(row.client?.entry.startsWith(`/api/modules/${VALID}/`)).toBe(true);

    const entry = await request.get(row.client!.entry);
    expect(entry.status()).toBe(200);
    expect(entry.headers()['content-type']).toMatch(/^text\/javascript/);
    const source = await entry.text();
    // Bare imports for the import map, not a bundled React.
    expect(source).toMatch(/from 'react';/);
    expect(source).not.toContain('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED');

    const missing = await request.get(`/api/modules/${VALID}/client/missing.js`);
    expect(missing.status()).toBe(404);
    expect(missing.headers()['content-type']).toMatch(/application\/json/);
    expect(await missing.text()).not.toMatch(/<html/i);
  });

  test('its route renders in the admin shell on the host React, theme, router and language', {
    tag: ['@ui', '@modules'],
  }, async ({ page }) => {
    const requested = await recordRequests(page);
    await page.addInitScript((themeId) => {
      window.localStorage.setItem('at-theme', themeId);
      window.localStorage.setItem('i18nextLng', 'nb');
    }, HOST_THEME);
    await page.goto(`/${VALID}`);
    await waitForBoot(page);

    const root = page.locator('main').getByTestId(`${VALID}-page`);
    await expect(root).toBeVisible({ timeout: 15_000 });

    // The host's router: its current path.
    await expect(page.getByTestId(`${VALID}-path`)).toHaveText(`/${VALID}`);
    // The host's i18next: its language and its resources.
    await expect(page.getByTestId(`${VALID}-language`)).toHaveText('nb');
    await expect(page.getByTestId(`${VALID}-translated`)).toHaveText('Kodemodul');
    // The host's MUI theme, as a value and as the style of a module's button.
    await expect(page.getByTestId(`${VALID}-primary`)).toHaveText(HOST_PRIMARY);
    const counter = page.getByTestId(`${VALID}-clicks`);
    await expect(counter).toHaveCSS('background-color', HOST_PRIMARY_RGB);

    // One React: a hook's state update re-renders the module.
    await expect(counter).toHaveText('Clicked 0');
    await counter.click();
    await expect(counter).toHaveText('Clicked 1');
    await counter.click();
    await expect(counter).toHaveText('Clicked 2');

    // Navigating from inside the module moves the host.
    await page.getByTestId(`${VALID}-navigate`).click();
    await expect(page).toHaveURL(new RegExp(`/${VALID}/next$`));
    await expect(page.getByTestId(`${VALID}-path`)).toHaveText(`/${VALID}/next`);
    await expect(page.locator('main').getByTestId(`${VALID}-page`)).toBeVisible();

    // The positive control for the "nothing requested" checks: this is what
    // loading a module looks like on the wire.
    expect(requested).toContain(`/api/modules/${VALID}/client/index.js`);
    expect(requested.some((p) => LOADER_CHUNK.test(p)), 'the loader chunk was requested').toBe(true);
    expect(requested.some((p) => SHIM_PATH.test(p)), 'the shims were requested').toBe(true);
  });

  test('the Modules page shows it as ok, with no upload for code', {
    tag: ['@ui', '@modules'],
  }, async ({ page, request }) => {
    await page.goto('/modules');
    await waitForBoot(page);
    await expect(page.getByTestId('modules-page')).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId(`code-module-${VALID}`);
    await expect(card).toBeVisible();
    await expect(statusChip(page, VALID)).toHaveAttribute('data-status', 'ok');
    // Listed once, as a code module, not a second time as built in.
    await expect(page.getByTestId(`module-${VALID}`)).toHaveCount(0);

    // Code is installed on disk, never uploaded: nothing on the card takes a
    // file, and the page's only file picker (game packs) takes no JavaScript.
    await expect(card.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByTestId('modules-file-input')).toHaveCount(1);
    for (const picker of await page.locator('input[type="file"]').all()) {
      const accept = (await picker.getAttribute('accept')) ?? '';
      expect(accept, 'a file picker on the Modules page').not.toBe('');
      expect(accept, 'a file picker on the Modules page').not.toMatch(/javascript|\.m?js\b/i);
    }
    // And no API takes one.
    const upload = await request.post('/api/modules', { data: { id: VALID } });
    expect(upload.status(), 'POST /api/modules').toBeGreaterThanOrEqual(400);
  });

  test('disabling removes its route; enabling asks for the id first and brings it back', {
    tag: ['@ui', '@modules'],
  }, async ({ page, request }) => {
    await page.goto('/modules');
    await waitForBoot(page);
    await page.getByTestId(`code-module-${VALID}-disable`).click();
    await expect(page.getByTestId('code-modules-reload')).toBeVisible();

    // The server keeps its code until it restarts; no browser loads it.
    expect(await moduleRow(request, VALID)).toMatchObject({ enabled: false, client: null });

    await page.reload();
    await waitForBoot(page);
    await expect(statusChip(page, VALID)).toHaveAttribute('data-status', 'disabled');

    await page.goto(`/${VALID}`);
    await waitForBoot(page);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`${VALID}-page`)).toHaveCount(0);

    // Enable: through the warning dialog, whose confirm waits for the id.
    await page.goto('/modules');
    await waitForBoot(page);
    await page.getByTestId(`code-module-${VALID}-enable`).click();
    const dialog = page.getByTestId('code-module-enable-dialog');
    await expect(dialog).toBeVisible();
    const confirm = page.getByTestId('code-module-enable-confirm');
    const typed = page.getByTestId('code-module-enable-confirm-id');
    await expect(confirm).toBeDisabled();
    await typed.fill(VALID.slice(0, -1));
    await expect(confirm).toBeDisabled();
    await typed.fill(VALID);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('code-modules-reload')).toBeVisible();

    // Still loaded on the server, so it is served again at once; no rescan.
    expect(await moduleRow(request, VALID)).toMatchObject({ enabled: true, status: 'ok' });

    await page.reload();
    await waitForBoot(page);
    await expect(statusChip(page, VALID)).toHaveAttribute('data-status', 'ok');
    await page.goto(`/${VALID}`);
    await waitForBoot(page);
    await expect(page.locator('main').getByTestId(`${VALID}-page`)).toBeVisible({ timeout: 15_000 });
  });

  test('a module built for another client API is incompatible and its code never fetched', {
    tag: ['@ui', '@modules'],
  }, async ({ page, request }) => {
    await installEnabled(request, CLIENT_INCOMPATIBLE, 'client-incompatible');

    // The server refuses it before loading anything, so nothing is served.
    const row = await moduleRow(request, CLIENT_INCOMPATIBLE);
    expect(row).toMatchObject({ enabled: true, status: 'incompatible', clientApi: '^0.3.0', client: null });
    expect(
      (await request.get(`/api/modules/${CLIENT_INCOMPATIBLE}/client/index.js`)).status()
    ).toBe(404);

    const requested = await recordRequests(page);
    await page.goto('/modules');
    await waitForBoot(page);
    await expect(statusChip(page, CLIENT_INCOMPATIBLE)).toHaveAttribute('data-status', 'incompatible');
    const reason = page.getByTestId(`code-module-${CLIENT_INCOMPATIBLE}-reason`);
    await expect(reason).toContainText('^0.3.0');
    await expect(reason).toContainText('0.2.1');

    expect(
      requested.filter((p) => p.startsWith(`/api/modules/${CLIENT_INCOMPATIBLE}/`)),
      'requests for its code'
    ).toEqual([]);
  });

  test('a module that needs React 19 is broken, and the rest of the app keeps working', {
    tag: ['@ui', '@modules'],
  }, async ({ page, request }) => {
    await installEnabled(request, REACT19, 'client-react19');
    // Its server half is fine: only a browser can find this out.
    expect((await moduleRow(request, REACT19)).status).toBe('ok');

    await page.goto('/modules');
    await waitForBoot(page);
    await expect(statusChip(page, REACT19)).toHaveAttribute('data-status', 'broken');
    const reason = page.getByTestId(`code-module-${REACT19}-reason`);
    await expect(reason).toContainText(/does not provide an export named '?use'?/);

    // The other module loaded in the same boot, and still works.
    await expect(statusChip(page, VALID)).toHaveAttribute('data-status', 'ok');
    await page.goto(`/${VALID}`);
    await waitForBoot(page);
    const counter = page.getByTestId(`${VALID}-clicks`);
    await expect(counter).toBeVisible({ timeout: 15_000 });
    await counter.click();
    await expect(counter).toHaveText('Clicked 1');
  });

  test('a route that throws shows the slot failure, the shell stays up, and the page says why', {
    tag: ['@ui', '@modules'],
  }, async ({ page, request }) => {
    await installEnabled(request, RENDER_THROWS, 'client-render-throws');
    expect((await moduleRow(request, RENDER_THROWS)).status).toBe('ok');

    await page.goto(`/${RENDER_THROWS}`);
    await waitForBoot(page);
    await expect(page.locator('main').getByTestId(`module-slot-failed-${RENDER_THROWS}`)).toBeVisible({
      timeout: 15_000,
    });

    // Same page load, so the loader's findings are still there.
    await spaNavigate(page, '/modules');
    await expect(page.getByTestId('modules-page')).toBeVisible({ timeout: 15_000 });
    await expect(statusChip(page, RENDER_THROWS)).toHaveAttribute('data-status', 'broken');
    const reason = page.getByTestId(`code-module-${RENDER_THROWS}-reason`);
    await expect(reason).toContainText('failed while rendering');
    await expect(reason).toContainText('exploded while rendering');
    // Only that module.
    await expect(statusChip(page, VALID)).toHaveAttribute('data-status', 'ok');
  });

  test('?modules=off loads no module code and says so', {
    tag: ['@ui', '@modules'],
  }, async ({ page }) => {
    const requested = await recordRequests(page);
    await page.goto('/modules?modules=off');
    await waitForBoot(page);
    await expect(page.getByTestId('code-modules-safe-mode')).toBeVisible({ timeout: 15_000 });
    // The modules are still listed, so the culprit can be disabled.
    await expect(page.getByTestId(`code-module-${VALID}`)).toBeVisible();

    await page.goto(`/${VALID}?modules=off`);
    await waitForBoot(page);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible({ timeout: 15_000 });

    expect(requested.filter((p) => MODULE_CODE.test(p)), 'module code requests').toEqual([]);
    expect(requested.filter((p) => SHIM_PATH.test(p)), 'shim requests').toEqual([]);
    expect(requested.filter((p) => LOADER_CHUNK.test(p)), 'loader chunk requests').toEqual([]);
  });
});
