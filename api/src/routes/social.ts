/**
 * Friends and the bell, for the signed-in player (services/socialService,
 * services/notificationService). Every write is same-site JSON. Party invites
 * live with the party, under /api/matchmaking/party/invites.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { isSameSiteRequest } from '../utils/accountConnections';
import { log } from '../utils/logger';
import { socialService, SocialError } from '../services/socialService';
import { notificationService } from '../services/notificationService';

const router = Router();

type PlayerRequest = Request & { socialPlayerId?: string };

/** A signed-in player, as themselves (not impersonated, not an API token). */
async function requirePlayer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identity = await resolveViewerIdentity(req);
  if (!identity.realSteamId) {
    res.status(401).json({ success: false, error: 'Sign in first' });
    return;
  }
  if (identity.isImpersonating) {
    res.status(403).json({ success: false, error: 'Stop impersonating first' });
    return;
  }
  (req as PlayerRequest).socialPlayerId = identity.realSteamId;
  next();
}

function sameSiteJson(req: Request, res: Response, next: NextFunction): void {
  if (!isSameSiteRequest(req)) {
    res.status(403).json({ success: false, error: 'Request refused' });
    return;
  }
  if (!req.is('application/json')) {
    res.status(415).json({ success: false, error: 'Send this request as JSON' });
    return;
  }
  next();
}

const me = (req: Request) => (req as PlayerRequest).socialPlayerId!;

function handle(what: string, fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      return await fn(req, res);
    } catch (error) {
      if (error instanceof SocialError) {
        return res.status(error.status).json({ success: false, code: error.code, error: error.message });
      }
      log.error(`[SOCIAL] ${what} failed`, error as Error);
      return res.status(500).json({ success: false, error: `Could not ${what}` });
    }
  };
}

/**
 * @openapi
 * /api/social/friends:
 *   get:
 *     tags: [Social]
 *     summary: Your friends, and friend requests to and from you
 *     description: >-
 *       Friends come playing first, then searching, then online, then offline
 *       by when they were last on the site. Each has `online`, `lastSeenAt`
 *       and `activity` (searching in a mode, or playing a match).
 *     responses:
 *       200: { description: Friends, incoming and sent requests }
 *       401: { description: Not signed in }
 */
router.get(
  '/friends',
  requirePlayer,
  handle('load your friends', async (req, res) => res.json({ success: true, ...(await socialService.overview(me(req))) }))
);

/**
 * @openapi
 * /api/social/friends/requests:
 *   post:
 *     tags: [Social]
 *     summary: Send a friend request
 *     description: Same-site JSON. If they already asked you, this accepts their request. Returns how you relate now.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { playerId: { type: string } } }
 *     responses:
 *       200: { description: "`relation`: sent or friend" }
 *       400: { description: Not a player, or yourself }
 *       404: { description: No such player }
 *       409: { description: Too many requests waiting, or too many friends }
 */
router.post(
  '/friends/requests',
  requirePlayer,
  sameSiteJson,
  handle('send the request', async (req, res) => res.json({ success: true, relation: await socialService.request(me(req), req.body?.playerId) }))
);

/**
 * @openapi
 * /api/social/friends/requests/{playerId}/accept:
 *   post:
 *     tags: [Social]
 *     summary: Accept a friend request
 *     parameters:
 *       - { in: path, name: playerId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: You are friends }
 *       404: { description: No request from them }
 */
router.post(
  '/friends/requests/:playerId/accept',
  requirePlayer,
  sameSiteJson,
  handle('accept the request', async (req, res) => {
    await socialService.accept(me(req), req.params.playerId);
    return res.json({ success: true });
  })
);

/**
 * @openapi
 * /api/social/friends/requests/{playerId}/decline:
 *   post:
 *     tags: [Social]
 *     summary: Decline a friend request
 *     parameters:
 *       - { in: path, name: playerId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Declined (they are not told) }
 */
router.post(
  '/friends/requests/:playerId/decline',
  requirePlayer,
  sameSiteJson,
  handle('decline the request', async (req, res) => {
    await socialService.decline(me(req), req.params.playerId);
    return res.json({ success: true });
  })
);

/**
 * @openapi
 * /api/social/friends/requests/{playerId}:
 *   delete:
 *     tags: [Social]
 *     summary: Take back a friend request you sent
 *     parameters:
 *       - { in: path, name: playerId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Cancelled }
 */
router.delete(
  '/friends/requests/:playerId',
  requirePlayer,
  sameSiteJson,
  handle('cancel the request', async (req, res) => {
    await socialService.cancel(me(req), req.params.playerId);
    return res.json({ success: true });
  })
);

/**
 * @openapi
 * /api/social/friends/{playerId}:
 *   delete:
 *     tags: [Social]
 *     summary: Remove a friend
 *     parameters:
 *       - { in: path, name: playerId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Removed, on both sides }
 */
router.delete(
  '/friends/:playerId',
  requirePlayer,
  sameSiteJson,
  handle('remove the friend', async (req, res) => {
    await socialService.remove(me(req), req.params.playerId);
    return res.json({ success: true });
  })
);

/**
 * @openapi
 * /api/social/relation/{playerId}:
 *   get:
 *     tags: [Social]
 *     summary: How you relate to a player
 *     description: "`self`, `friend`, `sent` (you asked), `incoming` (they asked) or `none`. For the buttons on a profile."
 *     parameters:
 *       - { in: path, name: playerId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The relation }
 */
router.get(
  '/relation/:playerId',
  requirePlayer,
  handle('look that up', async (req, res) => res.json({ success: true, relation: await socialService.relation(me(req), req.params.playerId) }))
);

/**
 * @openapi
 * /api/social/people:
 *   get:
 *     tags: [Social]
 *     summary: Find players to add or invite
 *     description: >-
 *       With `q` (two characters or more): players by name, or by Steam id or
 *       profile link. Without: people you played with or against lately who
 *       are not your friends yet. Each with how you relate.
 *     parameters:
 *       - { in: query, name: q, required: false, schema: { type: string } }
 *     responses:
 *       200: { description: Players }
 */
router.get(
  '/people',
  requirePlayer,
  handle('find players', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const people = q.trim() ? await socialService.search(me(req), q) : await socialService.recent(me(req));
    return res.json({ success: true, people });
  })
);

/**
 * @openapi
 * /api/social/settings:
 *   get:
 *     tags: [Social]
 *     summary: Your social settings
 *     description: "`partyInvitesFrom`: who may invite you to a matchmaking party (everyone, friends, nobody)."
 *     responses:
 *       200: { description: The settings }
 *   put:
 *     tags: [Social]
 *     summary: Change your social settings
 *     description: Same-site JSON.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               partyInvitesFrom: { type: string, enum: [everyone, friends, nobody] }
 *     responses:
 *       200: { description: The settings, saved }
 *       400: { description: Not one of the choices }
 */
router.get(
  '/settings',
  requirePlayer,
  handle('load your settings', async (req, res) => res.json({ success: true, ...(await socialService.settings(me(req))) }))
);

router.put(
  '/settings',
  requirePlayer,
  sameSiteJson,
  handle('save your settings', async (req, res) => res.json({ success: true, ...(await socialService.saveSettings(me(req), req.body ?? {})) }))
);

/**
 * @openapi
 * /api/social/notifications:
 *   get:
 *     tags: [Social]
 *     summary: Your notifications (the bell)
 *     description: >-
 *       Newest first, 30 at a time (`before` = the last id you have). Kinds:
 *       party_invite, friend_request, friend_accepted, skin, highlight,
 *       tournament, news. An answered one carries `data.answer`.
 *     parameters:
 *       - { in: query, name: before, required: false, schema: { type: integer } }
 *     responses:
 *       200: { description: "`items`, `unread` and `more`" }
 */
router.get(
  '/notifications',
  requirePlayer,
  handle('load your notifications', async (req, res) => {
    const before = Number(req.query.before);
    return res.json({ success: true, ...(await notificationService.list(me(req), Number.isFinite(before) && before > 0 ? before : undefined)) });
  })
);

/**
 * @openapi
 * /api/social/notifications/read:
 *   post:
 *     tags: [Social]
 *     summary: Mark notifications read
 *     description: Same-site JSON. `ids` marks those; no `ids` marks all. Returns the unread count.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { ids: { type: array, items: { type: integer } } } }
 *     responses:
 *       200: { description: "`unread`" }
 */
router.post(
  '/notifications/read',
  requirePlayer,
  sameSiteJson,
  handle('mark them read', async (req, res) => {
    const raw = req.body?.ids;
    const ids = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200) : undefined;
    return res.json({ success: true, unread: await notificationService.markRead(me(req), ids) });
  })
);

/**
 * @openapi
 * /api/social/news:
 *   post:
 *     tags: [Social]
 *     summary: Send news to every player (admin)
 *     description: A notice in every signed-in player's bell. `url` (optional) is where it leads.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               body: { type: string }
 *               url: { type: string }
 *     responses:
 *       200: { description: "`sent`: how many players got it" }
 *       400: { description: No title }
 */
router.post(
  '/news',
  requireAuth,
  sameSiteJson,
  handle('send the news', async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 140) : '';
    if (!title) return res.status(400).json({ success: false, error: 'Give the news a title' });
    const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 500) : '';
    const url = typeof req.body?.url === 'string' && /^(\/|https:\/\/)/.test(req.body.url.trim()) ? req.body.url.trim().slice(0, 300) : '';
    const sent = await notificationService.broadcast({ title, ...(body ? { body } : {}), ...(url ? { url } : {}) });
    return res.json({ success: true, sent });
  })
);

export default router;
