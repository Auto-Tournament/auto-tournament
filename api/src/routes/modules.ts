/**
 * Code modules: list them, switch them on and off, and serve their client
 * files. See `modules/loader.ts` for what a code module is and how it loads.
 *
 * There is deliberately no way to add a module here. A code module is
 * installed by putting its folder in `DATA_DIR/modules/` (or baking it into
 * the image), which takes the same access as editing `.env`; an admin session
 * alone never gets to run code on the host (DESIGN-module-client-api,
 * decision 2). Game packs, which are data, are uploaded under `/api/packs`.
 *
 * Everything is admin-only except the client files: players render module
 * slots too (the veto, the connect panel), so a module's client code is
 * public, like the app's own bundle, and must never contain a secret.
 */

import fs from 'fs';
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { CLIENT_API_VERSION, SERVER_API_VERSION } from '../modules/version';
import {
  contentTypeFor,
  listModules,
  resolveClientFile,
  setModuleEnabled,
} from '../modules/loader';

const router = Router();

/**
 * @openapi
 * /api/modules/{id}/client/*:
 *   get:
 *     tags: [Modules]
 *     summary: A file from a code module's client folder
 *     description: |
 *       `*` is the file's path under the module's `client/` folder. Served
 *       from `DATA_DIR/modules/<id>/client/` only, for a module that is
 *       enabled and loaded. A path that resolves outside that folder, a file
 *       that is not there, or a module that is not loaded is a JSON 404 —
 *       never the app's index.html. Public: players' browsers load module
 *       slots too.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The file, with its content type (JavaScript as text/javascript)
 *       404:
 *         description: No such file for a loaded, enabled module
 */
router.get('/:id/client/*', async (req: Request, res: Response) => {
  const relative = (req.params as Record<string, string>)[0] ?? '';
  try {
    const file = await resolveClientFile(req.params.id, relative);
    if (!file) {
      res.status(404).json({ success: false, error: 'No such module file' });
      return;
    }
    res.setHeader('Content-Type', contentTypeFor(file));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // No version in the URL yet, so every load revalidates.
    res.setHeader('Cache-Control', 'no-cache');
    const stream = fs.createReadStream(file);
    stream.on('error', (error) => {
      log.error('[MODULES] Failed to read a module client file', error);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Failed to read the file' });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    log.error('[MODULES] Failed to serve a module client file', error);
    res.status(500).json({ success: false, error: 'Failed to read the file' });
  }
});

// Everything below is admin-only.
router.use(requireAuth);

/**
 * @openapi
 * /api/modules:
 *   get:
 *     tags: [Modules]
 *     summary: Every module, built-in and on disk, with its status
 *     description: |
 *       `platform` is the client and server API versions this instance
 *       provides. Each module has a `status`: `ok` (loaded), `disabled`
 *       (found, not loaded), `incompatible` (its API ranges exclude this
 *       platform) or `broken` (it failed to validate or load), with the
 *       `reason`. `enabled` is the stored switch, which takes effect on the
 *       next restart. Built-in modules are always on.
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: The modules
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      platform: { clientApi: CLIENT_API_VERSION, serverApi: SERVER_API_VERSION },
      modules: await listModules(),
    });
  } catch (error) {
    log.error('[MODULES] Failed to list modules', error);
    res.status(500).json({ success: false, error: 'Failed to list modules' });
  }
});

async function switchModule(req: Request, res: Response, enabled: boolean): Promise<void> {
  try {
    const result = await setModuleEnabled(req.params.id, enabled);
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    log.info(`[MODULES] ${req.params.id} ${enabled ? 'enabled' : 'disabled'}; takes effect on restart`);
    res.json({ success: true, module: result.module, restartRequired: result.restartRequired });
  } catch (error) {
    log.error(`[MODULES] Failed to ${enabled ? 'enable' : 'disable'} a module`, error);
    res.status(500).json({ success: false, error: 'Failed to save the module setting' });
  }
}

/**
 * @openapi
 * /api/modules/{id}/enable:
 *   post:
 *     tags: [Modules]
 *     summary: Enable a code module on disk, from the next restart
 *     description: |
 *       Stores the switch. A loaded module cannot be unloaded and a new one
 *       is only loaded at boot, so the change takes effect on the next
 *       restart; `restartRequired` says whether the running process differs
 *       from what was stored. Built-in modules cannot be switched (400).
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Stored
 *       400:
 *         description: Not a valid module id, or a built-in module
 *       404:
 *         description: No such module on disk
 */
router.post('/:id/enable', (req: Request, res: Response) => switchModule(req, res, true));

/**
 * @openapi
 * /api/modules/{id}/disable:
 *   post:
 *     tags: [Modules]
 *     summary: Disable a code module on disk, from the next restart
 *     description: |
 *       The module stays loaded until the process restarts, but stops
 *       serving its client files at once. Built-in modules cannot be
 *       disabled (400).
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Stored
 *       400:
 *         description: Not a valid module id, or a built-in module
 *       404:
 *         description: No such module on disk
 */
router.post('/:id/disable', (req: Request, res: Response) => switchModule(req, res, false));

export default router;
