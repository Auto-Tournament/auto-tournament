/**
 * The admins' bell (services/adminNoticeService.ts): what needs an admin.
 * Admin only. Live updates go to signed-in admins as the Socket.IO events
 * admin:notice and admin:notice:resolved.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requestActorId } from '../middleware/auth';
import { log } from '../utils/logger';
import { adminNoticeService } from '../services/adminNoticeService';

const router = Router();
router.use(requireAuth);

/** Whose "seen" mark: the admin's Steam ID, a service token's label, or the shared local admin. */
const adminKey = (req: Request) => requestActorId(req) ?? 'admin';

/**
 * @openapi
 * /api/admin-notices:
 *   get:
 *     tags: [Admin notices]
 *     summary: Open notices (newest change first) and recently resolved ones, with this admin's unread count
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: The notices }
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const [notices, unread, settings] = await Promise.all([
      adminNoticeService.list(Number(req.query.limit) || 50),
      adminNoticeService.unread(adminKey(req)),
      adminNoticeService.settings(),
    ]);
    return res.json({ success: true, notices, unread, settings });
  } catch (error) {
    log.error('Failed to list admin notices', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to list admin notices' });
  }
});

/**
 * @openapi
 * /api/admin-notices/seen:
 *   post:
 *     tags: [Admin notices]
 *     summary: This admin has seen every notice so far
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Saved }
 */
router.post('/seen', async (req: Request, res: Response) => {
  try {
    await adminNoticeService.markSeen(adminKey(req));
    return res.json({ success: true, unread: 0 });
  } catch (error) {
    log.error('Failed to mark admin notices seen', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

/**
 * @openapi
 * /api/admin-notices/{id}/dismiss:
 *   post:
 *     tags: [Admin notices]
 *     summary: Close an open notice
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Closed }
 *       404: { description: No open notice with that id }
 */
router.post('/:id/dismiss', async (req: Request, res: Response) => {
  try {
    const done = await adminNoticeService.dismiss(Number(req.params.id));
    if (!done)
      return res.status(404).json({ success: false, error: 'No open notice with that id' });
    return res.json({ success: true });
  } catch (error) {
    log.error('Failed to dismiss an admin notice', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to dismiss' });
  }
});

/**
 * @openapi
 * /api/admin-notices/settings:
 *   get:
 *     tags: [Admin notices]
 *     summary: Per kind, off, bell, or bell with a sound
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: The settings }
 *   put:
 *     tags: [Admin notices]
 *     summary: Change how a kind of notice reaches the admins
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: { type: string, enum: [off, bell, sound] } }
 *     responses:
 *       200: { description: The saved settings }
 */
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, settings: await adminNoticeService.settings() });
  } catch (error) {
    log.error('Failed to read admin notice settings', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to read the settings' });
  }
});
router.put('/settings', async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      settings: await adminNoticeService.setSettings(req.body ?? {}),
    });
  } catch (error) {
    log.error('Failed to save admin notice settings', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to save the settings' });
  }
});

export default router;
