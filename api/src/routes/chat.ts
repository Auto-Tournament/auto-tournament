/**
 * Chat (services/chatService.ts): your match, your team, your party. A
 * signed-in player, or an admin (who may read and write any match's chat).
 * New messages also arrive over Socket.IO as `chat:message`.
 */

import { Router, type Request, type Response } from 'express';
import { ChatError, chatService, type ChatViewer } from '../services/chatService';
import { log } from '../utils/logger';
import { resolveViewerAccount } from '../utils/viewerIdentity';
import { checkAdminAccess } from '../middleware/auth';

const router = Router();

async function viewerOf(req: Request): Promise<ChatViewer | null> {
  const viewer = await resolveViewerAccount(req);
  // An admin signed in without Steam (another sign-in, an API token) is an admin too.
  const isAdmin = viewer.isAdmin || (await checkAdminAccess(req)).ok;
  if (!viewer.playerId && !isAdmin) return null;
  // Impersonating: read as that player, but never write as them.
  return { steamId: viewer.playerId, isAdmin };
}

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof ChatError) return res.status(error.status).json({ success: false, error: error.message });
  log.error(`[Chat] ${what} failed`, { error });
  return res.status(500).json({ success: false, error: `${what} failed` });
}

/**
 * @openapi
 * /api/chat/channels:
 *   get:
 *     tags: [Chat]
 *     summary: Your chats (your current match, your team, your party) with unread counts
 *     responses:
 *       200: { description: "{ channels }" }
 *       401: { description: Not signed in }
 */
router.get('/channels', async (req: Request, res: Response) => {
  try {
    const viewer = await viewerOf(req);
    if (!viewer) return res.status(401).json({ success: false, error: 'Sign in first' });
    return res.json({ success: true, channels: await chatService.channels(viewer) });
  } catch (error) {
    return fail(res, error, 'Listing chats');
  }
});

/**
 * @openapi
 * /api/chat/{channel}/messages:
 *   get:
 *     tags: [Chat]
 *     summary: A chat's messages, newest page (or the page before `before`), oldest first
 *     parameters:
 *       - { in: path, name: channel, required: true, schema: { type: string }, description: "match:<slug>, team:<id> or party:<id>" }
 *       - { in: query, name: before, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ messages, myTeam }" }
 *       403: { description: Not your chat }
 *       404: { description: No such chat }
 *   post:
 *     tags: [Chat]
 *     summary: Write in a chat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [body], properties: { body: { type: string, maxLength: 500 } } }
 *     responses:
 *       200: { description: "{ message }" }
 *       429: { description: Too many messages }
 */
router.get('/:channel/messages', async (req: Request, res: Response) => {
  try {
    const viewer = await viewerOf(req);
    if (!viewer) return res.status(401).json({ success: false, error: 'Sign in first' });
    const before = Number(req.query.before);
    return res.json({
      success: true,
      ...(await chatService.messages(viewer, req.params.channel, Number.isInteger(before) && before > 0 ? before : undefined)),
    });
  } catch (error) {
    return fail(res, error, 'Reading the chat');
  }
});

router.post('/:channel/messages', async (req: Request, res: Response) => {
  try {
    const account = await resolveViewerAccount(req);
    if (account.isImpersonating) return res.status(403).json({ success: false, error: 'Stop impersonating to write in chat.' });
    const viewer = await viewerOf(req);
    if (!viewer) return res.status(401).json({ success: false, error: 'Sign in first' });
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    return res.json({ success: true, message: await chatService.send(viewer, req.params.channel, body) });
  } catch (error) {
    return fail(res, error, 'Sending the message');
  }
});

/**
 * @openapi
 * /api/chat/{channel}/call-admin:
 *   post:
 *     tags: [Chat]
 *     summary: Call an admin to your match (match chats; a player in the match)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { message: { type: string, maxLength: 200 } } }
 *     responses:
 *       200: { description: Called }
 *       409: { description: Already called and not resolved yet }
 */
router.post('/:channel/call-admin', async (req: Request, res: Response) => {
  try {
    const account = await resolveViewerAccount(req);
    if (account.isImpersonating) return res.status(403).json({ success: false, error: 'Stop impersonating to call an admin.' });
    const viewer = await viewerOf(req);
    if (!viewer) return res.status(401).json({ success: false, error: 'Sign in first' });
    await chatService.callAdmin(viewer, req.params.channel, typeof req.body?.message === 'string' ? req.body.message : '');
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Calling an admin');
  }
});

/**
 * @openapi
 * /api/chat/{channel}/read:
 *   post:
 *     tags: [Chat]
 *     summary: Mark a chat read up to a message
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [lastId], properties: { lastId: { type: integer } } }
 *     responses:
 *       200: { description: Saved }
 */
router.post('/:channel/read', async (req: Request, res: Response) => {
  try {
    const viewer = await viewerOf(req);
    if (!viewer) return res.status(401).json({ success: false, error: 'Sign in first' });
    await chatService.markRead(viewer, req.params.channel, Number(req.body?.lastId));
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Marking the chat read');
  }
});

export default router;
