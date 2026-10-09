/**
 * Email: the SMTP settings (Settings -> Email, admin), a player's own address
 * and tournament emails (account page), and the links emails carry
 * (confirming an address, unsubscribing). Password recovery by email is on
 * /api/auth/local (routes/localAdmin.ts).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requestActorId } from '../middleware/auth';
import { isSameSiteRequest } from '../utils/accountConnections';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { log } from '../utils/logger';
import {
  emailService,
  EmailSettingsError,
  normalizeEmail,
  type EmailSettingsUpdate,
  type SmtpSecurity,
} from '../services/emailService';
import { playerEmailService, PlayerEmailError } from '../services/playerEmailService';

export const emailSettingsRouter = Router();
export const meEmailRouter = Router();
export const emailLinksRouter = Router();

/** Same-site JSON only (a DELETE carries no body: same-site is enough). */
function guardWrite(req: Request, res: Response, next: NextFunction): void {
  if (!isSameSiteRequest(req)) {
    res.status(403).json({ success: false, error: 'Request refused' });
    return;
  }
  if (req.method !== 'DELETE' && !req.is('application/json')) {
    res.status(415).json({ success: false, error: 'Send this request as JSON' });
    return;
  }
  next();
}

/** The request's own origin, for links when no site address is set. */
function originOf(req: Request): string {
  return req.get('origin') || `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

function sendError(res: Response, error: unknown, fallback: string): Response {
  if (error instanceof PlayerEmailError) {
    return res
      .status(error.status)
      .json({ success: false, error: error.message, code: error.code });
  }
  if (error instanceof EmailSettingsError) {
    return res.status(400).json({ success: false, error: error.message });
  }
  log.error(`[EMAIL] ${fallback}`, error as Error);
  return res.status(500).json({ success: false, error: fallback });
}

// ---------------------------------------------------------------------------
// Settings -> Email (admin)
// ---------------------------------------------------------------------------

emailSettingsRouter.use(requireAuth);

/**
 * @openapi
 * /api/email-settings:
 *   get:
 *     tags: [Email]
 *     summary: The SMTP settings (admin)
 *     description: The saved password is never sent back; `passwordSet` says whether there is one.
 *     responses:
 *       200:
 *         description: "`settings`"
 */
emailSettingsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, settings: await emailService.getSettings() });
  } catch (error) {
    return sendError(res, error, 'Could not load the email settings');
  }
});

/**
 * @openapi
 * /api/email-settings:
 *   put:
 *     tags: [Email]
 *     summary: Save the SMTP settings (admin)
 *     description: |
 *       Same-site JSON. Fields left out keep their value; `password` "" clears
 *       the saved password. Applies to the next email.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               host: { type: string }
 *               port: { type: integer, nullable: true }
 *               security: { type: string, enum: [tls, starttls, none] }
 *               username: { type: string }
 *               password: { type: string }
 *               fromAddress: { type: string }
 *               fromName: { type: string }
 *               siteUrl: { type: string }
 *     responses:
 *       200:
 *         description: "`settings`"
 *       400:
 *         description: A value is not accepted
 */
emailSettingsRouter.put('/', guardWrite, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const update: EmailSettingsUpdate = {};
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined);
  if (typeof body.enabled === 'boolean') update.enabled = body.enabled;
  if (str('host') !== undefined) update.host = str('host');
  if (body.port === null || body.port === '') update.port = null;
  else if (body.port !== undefined) update.port = Number(body.port);
  if (str('security') !== undefined) update.security = str('security') as SmtpSecurity;
  if (str('username') !== undefined) update.username = str('username');
  if (str('password') !== undefined) update.password = str('password');
  if (str('fromAddress') !== undefined) update.fromAddress = str('fromAddress');
  if (str('fromName') !== undefined) update.fromName = str('fromName');
  if (str('siteUrl') !== undefined) update.siteUrl = str('siteUrl');
  try {
    return res.json({
      success: true,
      settings: await emailService.saveSettings(update, requestActorId(req)),
    });
  } catch (error) {
    return sendError(res, error, 'Could not save the email settings');
  }
});

/**
 * @openapi
 * /api/email-settings/test:
 *   post:
 *     tags: [Email]
 *     summary: Send a test email with the saved settings (admin)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               to: { type: string }
 *     responses:
 *       200:
 *         description: Sent
 *       400:
 *         description: Not an address, or email is not set up
 *       502:
 *         description: The mail server refused it (`error` is its answer)
 */
emailSettingsRouter.post('/test', guardWrite, async (req: Request, res: Response) => {
  const to = normalizeEmail((req.body ?? {}).to);
  if (!to) return res.status(400).json({ success: false, error: 'That is not an email address' });
  if (!(await emailService.isReady())) {
    return res
      .status(400)
      .json({ success: false, error: 'Turn sending on and save a server and a sender first' });
  }
  try {
    await emailService.sendTest(to);
    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('[EMAIL] Test email failed', { error: message });
    return res.status(502).json({ success: false, error: message.slice(0, 300) });
  }
});

// ---------------------------------------------------------------------------
// The signed-in player's own address (account page)
// ---------------------------------------------------------------------------

/** The signed-in player (not while impersonating), or null with the answer sent. */
async function ownPlayer(req: Request, res: Response): Promise<string | null> {
  const identity = await resolveViewerIdentity(req);
  if (!identity.realSteamId) {
    res.status(401).json({ success: false, error: 'Sign in first' });
    return null;
  }
  if (identity.isImpersonating) {
    res
      .status(403)
      .json({ success: false, error: 'Stop impersonating to manage your own account.' });
    return null;
  }
  return identity.realSteamId;
}

/**
 * @openapi
 * /api/me/email:
 *   get:
 *     tags: [Email]
 *     summary: Your email address and tournament emails
 *     responses:
 *       200:
 *         description: "`email` (null when none), and `canSend`: whether this site sends email"
 */
meEmailRouter.get('/', async (req: Request, res: Response) => {
  const playerId = await ownPlayer(req, res);
  if (!playerId) return;
  try {
    return res.json({
      success: true,
      email: await playerEmailService.get(playerId),
      canSend: await emailService.isReady(),
    });
  } catch (error) {
    return sendError(res, error, 'Could not load your email');
  }
});

/**
 * @openapi
 * /api/me/email:
 *   put:
 *     tags: [Email]
 *     summary: Set your email address and send a confirmation link to it
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *     responses:
 *       200:
 *         description: "`email`, not confirmed until the link is opened"
 *       400:
 *         description: Not an email address
 *       409:
 *         description: This site does not send email
 *       429:
 *         description: A confirmation was just sent
 */
meEmailRouter.put('/', guardWrite, async (req: Request, res: Response) => {
  const playerId = await ownPlayer(req, res);
  if (!playerId) return;
  try {
    return res.json({
      success: true,
      email: await playerEmailService.setEmail(playerId, (req.body ?? {}).email, originOf(req)),
    });
  } catch (error) {
    return sendError(res, error, 'Could not save your email');
  }
});

/**
 * @openapi
 * /api/me/email/notifications:
 *   put:
 *     tags: [Email]
 *     summary: Turn tournament emails on or off
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tournaments: { type: boolean }
 *     responses:
 *       200:
 *         description: "`email`"
 *       404:
 *         description: No email address yet
 */
meEmailRouter.put('/notifications', guardWrite, async (req: Request, res: Response) => {
  const playerId = await ownPlayer(req, res);
  if (!playerId) return;
  const on = (req.body ?? {}).tournaments;
  if (typeof on !== 'boolean')
    return res.status(400).json({ success: false, error: 'tournaments is true or false' });
  try {
    return res.json({
      success: true,
      email: await playerEmailService.setNotifyTournaments(playerId, on),
    });
  } catch (error) {
    return sendError(res, error, 'Could not save that');
  }
});

/**
 * @openapi
 * /api/me/email:
 *   delete:
 *     tags: [Email]
 *     summary: Remove your email address
 *     responses:
 *       200:
 *         description: Removed
 */
meEmailRouter.delete('/', guardWrite, async (req: Request, res: Response) => {
  const playerId = await ownPlayer(req, res);
  if (!playerId) return;
  try {
    await playerEmailService.remove(playerId);
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, 'Could not remove your email');
  }
});

// ---------------------------------------------------------------------------
// Links in emails (no sign-in needed)
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/email/verify:
 *   post:
 *     tags: [Email]
 *     summary: Confirm an email address with the token from its link
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Confirmed
 *       400:
 *         description: The link is wrong, used or expired
 */
emailLinksRouter.post('/verify', guardWrite, async (req: Request, res: Response) => {
  try {
    const playerId = await playerEmailService.verify((req.body ?? {}).token);
    if (!playerId) {
      return res
        .status(400)
        .json({ success: false, error: 'This link does not work any more. Send a new one.' });
    }
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, 'Could not confirm the email');
  }
});

/**
 * @openapi
 * /api/email/unsubscribe:
 *   post:
 *     tags: [Email]
 *     summary: Stop tournament emails with the token from an email's unsubscribe link
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: No more tournament emails
 *       400:
 *         description: Unknown link
 */
emailLinksRouter.post('/unsubscribe', guardWrite, async (req: Request, res: Response) => {
  try {
    if (!(await playerEmailService.unsubscribe((req.body ?? {}).token))) {
      return res.status(400).json({ success: false, error: 'This link is not known.' });
    }
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, 'Could not unsubscribe');
  }
});
