/**
 * The game catalog: one list of every game this instance has or can install,
 * packs and code modules alike, and one set of operations on them
 * (DESIGN-modules §10, `modules/catalogService.ts`).
 *
 * Admin-only, all of it. Every write must also be same-site
 * (`isSameSiteRequest`, the account routes' CSRF check) and JSON, so a page
 * on another site cannot drive an admin's browser to install or remove
 * anything.
 *
 * A code module is never uploaded here. It is installed from a signed release
 * — our GitHub, or the image's offline snapshot — and only if the signature
 * verifies against a key compiled into this platform.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requestActorId } from '../middleware/auth';
import { isSameSiteRequest } from '../utils/accountConnections';
import { log } from '../utils/logger';
import {
  CatalogError,
  catalogIcon,
  disableCatalogModule,
  enableCatalogModule,
  installCatalogModule,
  installCatalogPack,
  listCatalog,
  purgeCatalogModule,
  uninstallCatalogModule,
  uninstallCatalogPack,
  updateAllCatalog,
} from '../modules/catalogService';

const router = Router();

router.use(requireAuth);

/** CSRF: writes come from this site, as JSON. */
function sameSiteJson(req: Request, res: Response, next: NextFunction): void {
  if (!isSameSiteRequest(req)) {
    log.warn('[CATALOG] Refused a cross-site catalog request', { path: req.path });
    res.status(403).json({ success: false, error: 'Request refused' });
    return;
  }
  if (!req.is('application/json')) {
    res.status(415).json({ success: false, error: 'Send this request as JSON' });
    return;
  }
  next();
}

function fail(res: Response, error: unknown, what: string): void {
  if (error instanceof CatalogError) {
    res.status(error.status).json({ success: false, error: error.message, code: error.code });
    return;
  }
  log.error(`[CATALOG] Failed to ${what}`, error);
  res.status(500).json({
    success: false,
    error: error instanceof Error ? error.message : `Failed to ${what}`,
    code: 'error',
  });
}

/**
 * @openapi
 * /api/catalog:
 *   get:
 *     tags: [Catalog]
 *     summary: Every game this instance has or can install
 *     description: |
 *       Packs and code modules in one list, merged from the remote feed
 *       (`catalog.json` in Auto-Tournament/packs), its last cached copy, and
 *       the image's offline snapshot. The answer waits on the feed for about
 *       two seconds at most; a slower fetch continues in the background and
 *       `feed.refreshing` says to list again shortly. `feed.stale` is true
 *       when the listed feed is not a fresh one; `feed.error` then holds a
 *       code (`timeout`, `unreachable`, `bad_response`, `newer_schema`,
 *       `too_large`, `offline` or `http_<status>`) and `feed.fetchedAt` when
 *       the cached copy was fetched. Installing from the snapshot still
 *       works. Each item has a `state` — available,
 *       installed, update-available, disabled, broken, incompatible or
 *       builtin — with a `reason` where there is one, and `restartRequired`
 *       when the running process differs from what is installed.
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: The catalog
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await listCatalog()) });
  } catch (error) {
    fail(res, error, 'read the catalog');
  }
});

async function sendIcon(res: Response, kind: 'pack' | 'module', id: string): Promise<void> {
  try {
    const markup = await catalogIcon(kind, id);
    if (!markup) {
      res.status(404).json({ success: false, error: 'No tile' });
      return;
    }
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(markup);
  } catch (error) {
    fail(res, error, 'read the tile');
  }
}

/**
 * @openapi
 * /api/catalog/packs/{slug}/icon.svg:
 *   get:
 *     tags: [Catalog]
 *     summary: The tile of a game pack in the catalog
 *     description: |
 *       From the installed pack, the offline snapshot, or the feed — fetched
 *       by this server and served from this origin, checked against the same
 *       allowlist an imported tile is.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The tile
 *         content:
 *           image/svg+xml: {}
 *       404:
 *         description: No tile
 */
router.get('/packs/:slug/icon.svg', (req: Request, res: Response) =>
  sendIcon(res, 'pack', req.params.slug)
);

/**
 * @openapi
 * /api/catalog/modules/{id}/icon.svg:
 *   get:
 *     tags: [Catalog]
 *     summary: The tile of a code module in the catalog
 *     description: |
 *       From the offline snapshot or the feed — fetched by this server and
 *       served from this origin, checked against the same allowlist an
 *       imported pack tile is.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The tile
 *         content:
 *           image/svg+xml: {}
 *       404:
 *         description: No tile
 */
router.get('/modules/:id/icon.svg', (req: Request, res: Response) =>
  sendIcon(res, 'module', req.params.id)
);

/**
 * @openapi
 * /api/catalog/packs/{slug}/install:
 *   post:
 *     tags: [Catalog]
 *     summary: Install or update a game pack from the catalog
 *     description: |
 *       From the feed when it has the newer copy, else from the offline
 *       snapshot. Validated exactly like an uploaded pack. Same-site JSON
 *       only.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Installed; `item` is its new catalog row
 *       400:
 *         description: The pack is not valid
 *       403:
 *         description: Cross-site request
 *       404:
 *         description: Not in the catalog
 *       409:
 *         description: Another catalog operation is running
 *       502:
 *         description: The feed could not be reached and there is no offline copy
 */
router.post('/packs/:slug/install', sameSiteJson, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await installCatalogPack(req.params.slug, requestActorId(req))) });
  } catch (error) {
    fail(res, error, 'install the game');
  }
});

/**
 * @openapi
 * /api/catalog/packs/{slug}:
 *   delete:
 *     tags: [Catalog]
 *     summary: Remove an installed game pack
 *     description: Refused (409) while a tournament uses the game. Same-site JSON only.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Removed
 *       404:
 *         description: Not installed
 *       409:
 *         description: A tournament uses it, or another operation is running
 */
router.delete('/packs/:slug', sameSiteJson, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await uninstallCatalogPack(req.params.slug, requestActorId(req))) });
  } catch (error) {
    fail(res, error, 'remove the game');
  }
});

/**
 * @openapi
 * /api/catalog/modules/{id}/install:
 *   post:
 *     tags: [Catalog]
 *     summary: Install a code module from a signed release
 *     description: |
 *       Picks the newest release whose API ranges hold this platform,
 *       downloads it from our GitHub (falling back to the offline snapshot
 *       when the download fails), verifies its Ed25519 signature against the
 *       platform's trusted keys before anything is unpacked, unpacks it
 *       strictly into a staging folder, checks `module.json`, moves it into
 *       `DATA_DIR/modules/<id>/`, switches it on and loads it without a
 *       restart. If it does not load (its import, migrations or seed fail),
 *       everything is rolled back. Same-site JSON only.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Installed; `restartRequired` says whether a restart is needed
 *       400:
 *         description: Refused — bad signature, tampered or unsafe archive, bad module.json
 *       404:
 *         description: Not in the catalog
 *       409:
 *         description: Incompatible, already installed, built in, or busy
 *       422:
 *         description: It did not load and was rolled back
 *       502:
 *         description: The download failed and there is no offline copy
 */
router.post('/modules/:id/install', sameSiteJson, async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      ...(await installCatalogModule(req.params.id, { actor: requestActorId(req), update: false })),
    });
  } catch (error) {
    fail(res, error, 'install the module');
  }
});

/**
 * @openapi
 * /api/catalog/modules/{id}/update:
 *   post:
 *     tags: [Catalog]
 *     summary: Update a code module to the newest compatible signed release
 *     description: |
 *       Verified and unpacked exactly like an install. The running version
 *       cannot be unloaded, so a loaded module's update answers
 *       `restartRequired: true`; the previous version is kept and restored
 *       automatically if the new one fails to load after the restart. A
 *       release older than, or equal to, the installed one is refused (409).
 *       Same-site JSON only.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated
 *       400:
 *         description: Refused — see install
 *       409:
 *         description: Not newer, incompatible, or busy
 */
router.post('/modules/:id/update', sameSiteJson, async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      ...(await installCatalogModule(req.params.id, { actor: requestActorId(req), update: true })),
    });
  } catch (error) {
    fail(res, error, 'update the module');
  }
});

/**
 * @openapi
 * /api/catalog/update-all:
 *   post:
 *     tags: [Catalog]
 *     summary: Update every installed pack and code module that has a compatible newer version
 *     description: |
 *       Runs each update one after another, through the same path as
 *       `/api/catalog/packs/{slug}/install` and
 *       `/api/catalog/modules/{id}/update` — signature checks, the downgrade
 *       guard, disabled-state preservation and restart-required handling all
 *       apply exactly as they do there. An entry that cannot update
 *       (incompatible, a newer major waiting for the admin, a restart
 *       pending) is skipped, with why; one that fails outright (a bad
 *       signature, a download error, and so on) is reported in `failed`.
 *       Neither stops the rest. Same-site JSON only.
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: |
 *           `updated`, `skipped` and `failed` list every entry that had a
 *           compatible newer version; `restartRequired` is true when any
 *           updated module needs a restart to load.
 *       409:
 *         description: Another catalog operation is running
 */
router.post('/update-all', sameSiteJson, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await updateAllCatalog(requestActorId(req))) });
  } catch (error) {
    fail(res, error, 'update the catalog');
  }
});

/**
 * @openapi
 * /api/catalog/modules/{id}/enable:
 *   post:
 *     tags: [Catalog]
 *     summary: Switch an installed code module on, loading it now when possible
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Enabled
 *       404:
 *         description: Not installed
 */
router.post('/modules/:id/enable', sameSiteJson, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await enableCatalogModule(req.params.id, requestActorId(req))) });
  } catch (error) {
    fail(res, error, 'enable the module');
  }
});

/**
 * @openapi
 * /api/catalog/modules/{id}/disable:
 *   post:
 *     tags: [Catalog]
 *     summary: Switch a code module off
 *     description: Its client files stop at once; its server code unloads at the next restart.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Disabled
 *       404:
 *         description: Not installed
 */
router.post('/modules/:id/disable', sameSiteJson, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await disableCatalogModule(req.params.id, requestActorId(req))) });
  } catch (error) {
    fail(res, error, 'disable the module');
  }
});

/**
 * @openapi
 * /api/catalog/modules/{id}:
 *   delete:
 *     tags: [Catalog]
 *     summary: Uninstall a code module, keeping its data
 *     description: |
 *       Removes its files; its tables, migration ledger and settings stay,
 *       so installing it again brings everything back. Refused (409) while
 *       an unfinished tournament uses its game. Same-site JSON only.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Uninstalled
 *       404:
 *         description: Not installed
 *       409:
 *         description: In use, built in, or busy
 */
router.delete('/modules/:id', sameSiteJson, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await uninstallCatalogModule(req.params.id, requestActorId(req))) });
  } catch (error) {
    fail(res, error, 'uninstall the module');
  }
});

/**
 * @openapi
 * /api/catalog/modules/{id}/purge:
 *   post:
 *     tags: [Catalog]
 *     summary: Delete an uninstalled module's data for good
 *     description: |
 *       Drops the tables in the module's namespace (`<id>_…`, never a core
 *       table) and deletes its migration ledger and switches, in one
 *       transaction. Only for a module that is uninstalled and not loaded
 *       in this process, with no tournament or match on its game, and with
 *       `{ "confirm": "<id>" }` in the body. Same-site JSON only.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Purged; `dropped` lists the tables
 *       400:
 *         description: Confirmation missing
 *       409:
 *         description: Still installed or loaded, or in use
 */
router.post('/modules/:id/purge', sameSiteJson, async (req: Request, res: Response) => {
  try {
    const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
    res.json({ success: true, ...(await purgeCatalogModule(req.params.id, confirm, requestActorId(req))) });
  } catch (error) {
    fail(res, error, 'purge the module');
  }
});

export default router;
