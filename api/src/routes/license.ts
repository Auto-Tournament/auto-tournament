/**
 * The Auto Tournament license key (services/license/licenseService.ts).
 * Admin only, except the public badge. Writes must be same-site JSON, and a
 * read-only API token cannot write. The key is never returned or logged.
 *
 * Nothing here blocks anything: a missing or problematic key is a notice for
 * admins, never a lockout.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { isSameSiteRequest } from '../utils/accountConnections';
import { log } from '../utils/logger';
import { keyInputProblem, licenseService } from '../services/license/licenseService';

const router = Router();

/**
 * Same-site JSON only, like the catalog's and the system routes' writes. A
 * DELETE carries no body, so it only has to be same-site.
 */
function refuseWrite(req: Request, res: Response): boolean {
  if (!isSameSiteRequest(req)) {
    res.status(403).json({ success: false, error: 'Request refused' });
    return true;
  }
  if (req.method !== 'DELETE' && !req.is('application/json')) {
    res.status(415).json({ success: false, error: 'Send this request as JSON' });
    return true;
  }
  return false;
}

function failed(res: Response, what: string, error: unknown) {
  log.error(`[LICENSE] ${what}`, error as Error);
  return res.status(500).json({ success: false, error: what });
}

/**
 * @openapi
 * /api/license/badge:
 *   get:
 *     tags: [License]
 *     summary: The public "Licensed" line
 *     description: |
 *       `badge` is `{ verifyUrl }` when an admin turned the public badge on
 *       and the saved key is a genuine platform license; otherwise null.
 *       Public. Never says anything about an instance without a license:
 *       free non-commercial use needs none.
 *     responses:
 *       200:
 *         description: The badge, or null
 */
router.get('/badge', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, badge: await licenseService.getPublicBadge() });
  } catch (error) {
    // Public and cosmetic: no badge rather than an error on an event page.
    log.warn('[LICENSE] Could not read the public badge', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.json({ success: true, badge: null });
  }
});

router.use(requireAuth);

/**
 * @openapi
 * /api/license:
 *   get:
 *     tags: [License]
 *     summary: The license status
 *     description: |
 *       Checked offline against the embedded public keys. `status` is `none`
 *       (no key: free for non-commercial use), `ok`, `warning` (a genuine key
 *       with something to point out: another product's key, the event window,
 *       updates that ended before this release line, more game servers than
 *       the pack) or `invalid` (not a genuine key). Nothing is ever blocked.
 *       The key itself is never returned; `license.id` identifies it, and
 *       `verifyUrl` is its public check page.
 *     responses:
 *       200:
 *         description: The status
 *   put:
 *     tags: [License]
 *     summary: Save the license key
 *     description: |
 *       Body `{ "key": "ATL1.…" }`. Replaces any saved key. Refused (400) only
 *       when it isn't an `ATL1.` key at all; a key that fails the signature
 *       check is saved and reported as `invalid`. Same-site JSON only.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key]
 *             properties:
 *               key: { type: string }
 *     responses:
 *       200:
 *         description: Saved; the new status
 *       400:
 *         description: Not a license key
 *   delete:
 *     tags: [License]
 *     summary: Remove the license key
 *     description: Same-site only. The status afterwards is `none`.
 *     responses:
 *       200:
 *         description: Removed; the new status
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, license: await licenseService.getStatus() });
  } catch (error) {
    return failed(res, 'Failed to read the license status', error);
  }
});

router.put('/', async (req: Request, res: Response) => {
  if (refuseWrite(req, res)) return;
  const key = (req.body as { key?: unknown } | undefined)?.key;
  const problem = keyInputProblem(key);
  if (problem) return res.status(400).json({ success: false, error: problem });
  try {
    return res.json({ success: true, license: await licenseService.setKey(key as string) });
  } catch (error) {
    return failed(res, 'Failed to save the license key', error);
  }
});

router.delete('/', async (req: Request, res: Response) => {
  if (refuseWrite(req, res)) return;
  try {
    return res.json({ success: true, license: await licenseService.clearKey() });
  } catch (error) {
    return failed(res, 'Failed to remove the license key', error);
  }
});

/**
 * @openapi
 * /api/license/public-badge:
 *   put:
 *     tags: [License]
 *     summary: Turn the public "Licensed" line on or off
 *     description: |
 *       Body `{ "enabled": true }`. Off by default. When on, public event
 *       pages show "Licensed", linking to the license's check page, but only
 *       while the saved key is a genuine platform license. Same-site JSON only.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Saved; the new status
 *       400:
 *         description: enabled is not a boolean
 */
router.put('/public-badge', async (req: Request, res: Response) => {
  if (refuseWrite(req, res)) return;
  const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled must be true or false' });
  }
  try {
    return res.json({ success: true, license: await licenseService.setPublicBadge(enabled) });
  } catch (error) {
    return failed(res, 'Failed to save the public badge setting', error);
  }
});

export default router;
