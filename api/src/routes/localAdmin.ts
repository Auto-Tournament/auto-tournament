/**
 * First-admin setup and local admin sign-in.
 *
 *  - /api/setup: enter the one-time code the server logged (or reset-admin
 *    printed), create a local admin, get signed in. Answers 404 once an admin
 *    exists, unless a reset-admin code is waiting.
 *  - /api/auth/local: username + password (+ TOTP) sign-in for local admins,
 *    and TOTP enrolment for the signed-in local admin.
 *
 * Every write is same-site JSON (the repo's CSRF rule, utils/accountConnections).
 * Codes and passwords only ever travel in request bodies, never in URLs.
 * Failures are counted per IP and per target (utils/loginThrottle) and
 * answered with one generic message. Sign-ins and code use are audit-logged
 * ([AUDIT]), never with a password or code.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';
import { isSameSiteRequest } from '../utils/accountConnections';
import { LoginThrottle } from '../utils/loginThrottle';
import { normalizeUsername, passwordProblem } from '../utils/localAdminCrypto';
import { totpUri } from '../utils/totp';
import { localAdminService } from '../services/localAdminService';
import { adminAccessSettings } from '../services/adminAccessSettings';
import { settingsService } from '../services/settingsService';
import { requireAuth, requestActorId } from '../middleware/auth';
import { playerService } from '../services/playerService';
import { removesLastAdmin } from '../utils/adminRules';
import { setPlayerSteamCookie } from './auth';
import { markLocalReauth } from '../utils/localReauth';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { playerEmailService } from '../services/playerEmailService';
import { emailService } from '../services/emailService';
import { deletePlayer } from '../services/playerModeration';

export const setupRouter = Router();
export const localAuthRouter = Router();
export const localAccountsRouter = Router();

export const setupThrottle = new LoginThrottle();
export const loginThrottle = new LoginThrottle();

const BAD_CODE = 'That code is not valid or has expired';
const BAD_LOGIN = 'Wrong username, password or code';
const TOO_MANY = 'Too many attempts. Wait a few minutes and try again.';

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

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

function tooMany(res: Response, waitMs: number): Response {
  res.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
  return res.status(429).json({ success: false, error: TOO_MANY });
}

/** Sign `playerId` in: the Passport session and the signed player cookie, like the provider callbacks. */
function signIn(req: Request, res: Response, playerId: string, username: string): Promise<void> {
  const anyReq = req as Request & { login?: (user: unknown, cb: (err: unknown) => void) => void };
  return new Promise((resolve, reject) => {
    if (!anyReq.login) return reject(new Error('Passport is not initialised'));
    anyReq.login({ provider: 'local', steamId: playerId, displayName: username }, (err) => {
      if (err) return reject(err);
      setPlayerSteamCookie(req, res, playerId);
      // Entering the password is a fresh proof (utils/localReauth).
      markLocalReauth(req, playerId);
      resolve();
    });
  });
}

/** 404 unless /setup is open (no admin yet, or a reset code waiting). */
async function setupOpen(res: Response): Promise<'setup' | 'reset' | null> {
  const mode = await localAdminService.setupMode();
  if (!mode) res.status(404).json({ success: false, error: 'Not found' });
  return mode;
}

/**
 * @openapi
 * /api/setup/status:
 *   get:
 *     tags: [Setup]
 *     summary: Whether first-admin setup (or a reset) is open
 *     description: |
 *       `mode` is `setup` while no admin exists, `reset` while a reset-admin
 *       code is waiting. 404 otherwise.
 *     responses:
 *       200:
 *         description: Setup is open
 *       404:
 *         description: Setup is closed
 */
setupRouter.get('/status', async (_req: Request, res: Response) => {
  const mode = await setupOpen(res);
  if (!mode) return;
  return res.json({ success: true, mode });
});

/**
 * @openapi
 * /api/setup/check:
 *   post:
 *     tags: [Setup]
 *     summary: Check a setup code without using it
 *     description: Same-site JSON. Rate limited per IP and overall; failures answer one generic message.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: The code is valid
 *       400:
 *         description: Not valid or expired
 *       404:
 *         description: Setup is closed
 *       429:
 *         description: Too many attempts
 */
setupRouter.post('/check', guardWrite, async (req: Request, res: Response) => {
  if (!(await setupOpen(res))) return;
  const ip = clientIp(req);
  const wait = setupThrottle.retryAfterMs(ip, 'setup');
  if (wait > 0) return tooMany(res, wait);
  if (!(await localAdminService.checkCode((req.body as { code?: unknown })?.code))) {
    setupThrottle.recordFailure(ip, 'setup');
    log.warn('[AUDIT] Wrong setup code entered', { ip });
    return res.status(400).json({ success: false, error: BAD_CODE });
  }
  return res.json({ success: true });
});

/**
 * @openapi
 * /api/setup/complete:
 *   post:
 *     tags: [Setup]
 *     summary: Use the setup code and create (or reset) a local admin
 *     description: |
 *       Same-site JSON. Uses the code (once), creates the local admin
 *       `username` with `password` (or, with a reset-admin code, sets a new
 *       password on an existing one and removes its TOTP), and signs in.
 *       Username: 3-32 of a-z 0-9 . _ -. Password: 12-256 characters, not
 *       containing the username, not trivially simple.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code: { type: string }
 *               username: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Signed in as the admin
 *       400:
 *         description: Bad username or password (`problem`), or the code is not valid
 *       404:
 *         description: Setup is closed
 *       429:
 *         description: Too many attempts
 */
setupRouter.post('/complete', guardWrite, async (req: Request, res: Response) => {
  if (!(await setupOpen(res))) return;
  const body = (req.body ?? {}) as { code?: unknown; username?: unknown; password?: unknown };
  const username = normalizeUsername(body.username);
  if (!username)
    return res.status(400).json({ success: false, error: 'Invalid username', problem: 'username' });
  const problem = passwordProblem(username, body.password);
  if (problem)
    return res.status(400).json({ success: false, error: 'Password not accepted', problem });

  const ip = clientIp(req);
  const wait = setupThrottle.retryAfterMs(ip, 'setup');
  if (wait > 0) return tooMany(res, wait);
  try {
    const result = await localAdminService.completeSetup(
      body.code,
      username,
      body.password as string,
      ip
    );
    if (!result.ok) {
      if (result.reason === 'closed')
        return res.status(404).json({ success: false, error: 'Not found' });
      setupThrottle.recordFailure(ip, 'setup');
      log.warn('[AUDIT] Wrong setup code entered', { ip });
      return res.status(400).json({ success: false, error: BAD_CODE });
    }
    setupThrottle.recordSuccess('setup');
    await signIn(req, res, result.playerId, username as string);
    return res.json({ success: true, username });
  } catch (error) {
    log.error('[SETUP] Failed to complete setup', error as Error);
    return res.status(500).json({ success: false, error: 'Setup failed' });
  }
});

/**
 * @openapi
 * /api/auth/local/status:
 *   get:
 *     tags: [Authentication]
 *     summary: Whether local admin login is on, and whether setup is open
 *     responses:
 *       200:
 *         description: "`enabled`: the login page shows the Admin login link. `setup`: no admin exists yet and /setup is open. `emailRecovery`: the site sends email, so a forgotten password can be reset by email."
 */
localAuthRouter.get('/status', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    enabled: await adminAccessSettings.isLocalAdminLoginEnabled(),
    // Only a fresh install is announced; a reset code's holder knows where to go.
    setup: (await localAdminService.setupMode()) === 'setup',
    // Password reset by email works: the sign-in page offers "Forgot your password?".
    emailRecovery: await emailService.isReady(),
  });
});

/**
 * @openapi
 * /api/auth/local/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Sign in as a local admin
 *     description: |
 *       Same-site JSON. Username and password, plus `totp` when the account
 *       has TOTP (answered `totpRequired: true` after a correct password).
 *       Failures answer one generic message; repeated failures lock the
 *       username with a growing delay and limit the IP (429).
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *               totp: { type: string }
 *     responses:
 *       200:
 *         description: "Signed in. `mustChangePassword`: an admin chose the password, pick your own now (/login/welcome)"
 *       401:
 *         description: Wrong username, password or code; or `totpRequired`
 *       403:
 *         description: Local admin login is turned off
 *       429:
 *         description: Too many attempts
 */
localAuthRouter.post('/login', guardWrite, async (req: Request, res: Response) => {
  if (!(await adminAccessSettings.isLocalAdminLoginEnabled())) {
    return res.status(403).json({ success: false, error: 'Local admin login is turned off' });
  }
  const body = (req.body ?? {}) as { username?: unknown; password?: unknown; totp?: unknown };
  const username = normalizeUsername(body.username);
  const ip = clientIp(req);
  const target = `user:${
    username ??
    String(body.username ?? '')
      .slice(0, 64)
      .toLowerCase()
  }`;
  const wait = loginThrottle.retryAfterMs(ip, target);
  if (wait > 0) {
    log.warn('[AUDIT] Local admin login refused: too many attempts', { username, ip });
    return tooMany(res, wait);
  }
  try {
    const result = await localAdminService.verifyLogin(username, body.password, body.totp);
    if (!result.ok) {
      if (result.reason === 'totp_required') {
        return res
          .status(401)
          .json({
            success: false,
            totpRequired: true,
            error: 'Enter the code from your authenticator app',
          });
      }
      loginThrottle.recordFailure(ip, target);
      log.warn('[AUDIT] Local admin login failed', { username, ip, reason: result.reason });
      return res
        .status(401)
        .json({
          success: false,
          error: BAD_LOGIN,
          totpRequired: result.reason === 'totp_invalid' || undefined,
        });
    }
    loginThrottle.recordSuccess(target);
    await signIn(req, res, result.playerId, username as string);
    log.info('[AUDIT] Local admin signed in', { username, ip });
    // A password an admin chose: the client sends them to the first-sign-in setup.
    const status = await localAdminService.status(result.playerId);
    return res.json({ success: true, mustChangePassword: status?.mustChangePassword === true });
  } catch (error) {
    log.error('[AUTH] Local admin login failed', error as Error);
    return res.status(500).json({ success: false, error: 'Sign-in failed' });
  }
});

/** The signed-in local admin's players id, or null (a 404 is sent). */
function sessionPlayerId(req: Request, res: Response): string | null {
  const user = (req as Request & { user?: { provider?: string; steamId?: string } }).user;
  if (user?.provider !== 'local' || !user.steamId) {
    res.status(404).json({ success: false, error: 'Not signed in with a local admin account' });
    return null;
  }
  return user.steamId;
}

/**
 * @openapi
 * /api/auth/local/me:
 *   get:
 *     tags: [Authentication]
 *     summary: The signed-in local admin's username and whether TOTP is on
 *     responses:
 *       200:
 *         description: "The account: `username`, `totpEnabled`, `mustChangePassword` (an admin chose the password)"
 *       404:
 *         description: Not signed in with a local admin account
 */
localAuthRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const playerId = sessionPlayerId(req, res);
  if (!playerId) return;
  const status = await localAdminService.status(playerId);
  if (!status) return res.status(404).json({ success: false, error: 'Not found' });
  return res.json({ success: true, ...status });
});

/**
 * @openapi
 * /api/auth/local/totp/start:
 *   post:
 *     tags: [Authentication]
 *     summary: Start TOTP enrolment for the signed-in local admin
 *     description: |
 *       Same-site JSON. Returns a new secret and its otpauth:// URI for an
 *       authenticator app. Not active until confirmed.
 *     responses:
 *       200:
 *         description: "`secret` and `uri`"
 */
localAuthRouter.post(
  '/totp/start',
  guardWrite,
  requireAuth,
  async (req: Request, res: Response) => {
    const playerId = sessionPlayerId(req, res);
    if (!playerId) return;
    const started = await localAdminService.startTotp(playerId);
    if (!started) return res.status(404).json({ success: false, error: 'Not found' });
    const issuer = await settingsService.getSiteName().catch(() => 'Auto Tournament');
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      success: true,
      secret: started.secret,
      uri: totpUri(issuer, started.username, started.secret),
    });
  }
);

/**
 * @openapi
 * /api/auth/local/totp/confirm:
 *   post:
 *     tags: [Authentication]
 *     summary: Turn TOTP on with a code from the authenticator app
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: TOTP is on; sign-in now asks for a code
 *       400:
 *         description: Wrong code
 */
localAuthRouter.post(
  '/totp/confirm',
  guardWrite,
  requireAuth,
  async (req: Request, res: Response) => {
    const playerId = sessionPlayerId(req, res);
    if (!playerId) return;
    const ip = clientIp(req);
    const target = `totp:${playerId}`;
    const wait = loginThrottle.retryAfterMs(ip, target);
    if (wait > 0) return tooMany(res, wait);
    if (!(await localAdminService.confirmTotp(playerId, (req.body as { code?: unknown })?.code))) {
      loginThrottle.recordFailure(ip, target);
      return res
        .status(400)
        .json({
          success: false,
          error: 'That code is not right. Check the time on your phone and try again.',
        });
    }
    loginThrottle.recordSuccess(target);
    return res.json({ success: true });
  }
);

/**
 * @openapi
 * /api/auth/local/reauth:
 *   post:
 *     tags: [Authentication]
 *     summary: Confirm the local admin password again (step-up)
 *     description: |
 *       Same-site JSON. For a signed-in account that has a local admin login
 *       (signed in with it or with a connected provider). Enter the password,
 *       plus `totp` when TOTP is on. For 10 minutes the account can then
 *       connect sign-in methods, merge a Steam player or remove its password
 *       login. Throttled like sign-in.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password: { type: string }
 *               totp: { type: string }
 *     responses:
 *       200:
 *         description: Confirmed for 10 minutes
 *       401:
 *         description: Wrong password or code; or `totpRequired`
 *       403:
 *         description: Impersonating
 *       404:
 *         description: Not signed in, or the account has no local login
 *       429:
 *         description: Too many attempts
 */
localAuthRouter.post('/reauth', guardWrite, async (req: Request, res: Response) => {
  const identity = await resolveViewerIdentity(req);
  if (!identity.realSteamId) return res.status(404).json({ success: false, error: 'Not found' });
  if (identity.isImpersonating) {
    return res
      .status(403)
      .json({ success: false, error: 'Stop impersonating to manage your own account.' });
  }
  const row = await localAdminService.findByPlayerId(identity.realSteamId);
  if (!row)
    return res.status(404).json({ success: false, error: 'This account has no admin login' });

  const body = (req.body ?? {}) as { password?: unknown; totp?: unknown };
  const ip = clientIp(req);
  const target = `user:${row.username}`;
  const wait = loginThrottle.retryAfterMs(ip, target);
  if (wait > 0) return tooMany(res, wait);
  try {
    const result = await localAdminService.verifyLogin(row.username, body.password, body.totp);
    if (!result.ok || result.playerId !== identity.realSteamId) {
      if (!result.ok && result.reason === 'totp_required') {
        return res
          .status(401)
          .json({
            success: false,
            totpRequired: true,
            error: 'Enter the code from your authenticator app',
          });
      }
      loginThrottle.recordFailure(ip, target);
      log.warn('[AUDIT] Local admin re-confirmation failed', { username: row.username, ip });
      return res.status(401).json({
        success: false,
        error: BAD_LOGIN,
        totpRequired: (!result.ok && result.reason === 'totp_invalid') || undefined,
      });
    }
    loginThrottle.recordSuccess(target);
    markLocalReauth(req, identity.realSteamId);
    log.info('[AUDIT] Local admin re-confirmed their password', { username: row.username, ip });
    return res.json({ success: true });
  } catch (error) {
    log.error('[AUTH] Local admin re-confirmation failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not check your password' });
  }
});

/**
 * @openapi
 * /api/auth/local/password:
 *   post:
 *     tags: [Authentication]
 *     summary: Change your own password
 *     description: |
 *       Same-site JSON. For a signed-in account with a username and password
 *       login: the current password (and `totp` when two-step is on), then the
 *       new one. Two-step verification stays on. Throttled like sign-in.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string }
 *               totp: { type: string }
 *     responses:
 *       200:
 *         description: Changed
 *       400:
 *         description: The new password is not accepted (`problem` says why)
 *       401:
 *         description: Wrong current password or code; or `totpRequired`
 *       403:
 *         description: Impersonating
 *       404:
 *         description: Not signed in, or the account has no password login
 *       429:
 *         description: Too many attempts
 */
localAuthRouter.post('/password', guardWrite, async (req: Request, res: Response) => {
  const identity = await resolveViewerIdentity(req);
  if (!identity.realSteamId) return res.status(404).json({ success: false, error: 'Not found' });
  if (identity.isImpersonating) {
    return res
      .status(403)
      .json({ success: false, error: 'Stop impersonating to manage your own account.' });
  }
  const row = await localAdminService.findByPlayerId(identity.realSteamId);
  if (!row)
    return res.status(404).json({ success: false, error: 'This account has no password login' });

  const body = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown; totp?: unknown };
  const ip = clientIp(req);
  const target = `user:${row.username}`;
  const wait = loginThrottle.retryAfterMs(ip, target);
  if (wait > 0) return tooMany(res, wait);
  try {
    const result = await localAdminService.verifyLogin(row.username, body.currentPassword, body.totp);
    if (!result.ok || result.playerId !== identity.realSteamId) {
      if (!result.ok && result.reason === 'totp_required') {
        return res.status(401).json({
          success: false,
          totpRequired: true,
          error: 'Enter the code from your authenticator app',
        });
      }
      loginThrottle.recordFailure(ip, target);
      log.warn('[AUDIT] Password change refused: wrong current password', { username: row.username, ip });
      return res.status(401).json({
        success: false,
        error: 'Your current password is not right',
        totpRequired: (!result.ok && result.reason === 'totp_invalid') || undefined,
      });
    }
    loginThrottle.recordSuccess(target);
    const problem = passwordProblem(row.username, body.newPassword);
    if (problem)
      return res.status(400).json({ success: false, error: 'Password not accepted', problem });
    await localAdminService.changeOwnPassword(identity.realSteamId, body.newPassword as string);
    return res.json({ success: true });
  } catch (error) {
    log.error('[AUTH] Changing a password failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not change the password' });
  }
});

/**
 * @openapi
 * /api/auth/local/forgot:
 *   post:
 *     tags: [Authentication]
 *     summary: Email a password reset link
 *     description: |
 *       Same-site JSON. By username or by the account's confirmed email
 *       address. Always answers 200, whether or not an email went out, so it
 *       cannot be used to find accounts. Throttled.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               identifier: { type: string }
 *     responses:
 *       200:
 *         description: If the account has a confirmed address, a link is on its way
 *       429:
 *         description: Too many attempts
 */
localAuthRouter.post('/forgot', guardWrite, async (req: Request, res: Response) => {
  const ip = clientIp(req);
  const identifier = (req.body ?? {}).identifier;
  const target = `forgot:${String(identifier ?? '').slice(0, 254).toLowerCase()}`;
  const wait = loginThrottle.retryAfterMs(ip, target);
  if (wait > 0) return tooMany(res, wait);
  // Counted as a failure every time: a few requests per address, then a pause.
  loginThrottle.recordFailure(ip, target);
  const origin = req.get('origin') || `${req.protocol}://${req.get('host') ?? 'localhost'}`;
  try {
    await playerEmailService.requestPasswordReset(identifier, origin);
  } catch (error) {
    log.error('[AUTH] Password reset request failed', error as Error);
  }
  return res.json({ success: true });
});

/**
 * @openapi
 * /api/auth/local/reset:
 *   post:
 *     tags: [Authentication]
 *     summary: Set a new password with the token from a reset email
 *     description: Same-site JSON. Two-step verification stays on.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: "Changed; `username` is the account's"
 *       400:
 *         description: The link is wrong, used or expired, or the password is not accepted
 */
localAuthRouter.post('/reset', guardWrite, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { token?: unknown; password?: unknown };
  const problem = passwordProblem('', body.password);
  if (problem) return res.status(400).json({ success: false, error: 'Password not accepted', problem });
  try {
    const username = await playerEmailService.resetPassword(body.token, body.password as string);
    if (!username) {
      return res
        .status(400)
        .json({ success: false, error: 'This link does not work any more. Ask for a new one.', code: 'badToken' });
    }
    return res.json({ success: true, username });
  } catch (error) {
    log.error('[AUTH] Password reset failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not reset the password' });
  }
});

// ---------------------------------------------------------------------------
// Local accounts (Settings -> Sign-in -> Accounts): admins create username +
// password accounts, admin or not, set new passwords and remove them.
// ---------------------------------------------------------------------------

const USERNAME_RULE =
  'Usernames are 3 to 32 characters: lower-case letters, digits, dots, dashes and underscores, starting with a letter or digit';
const LAST_ADMIN =
  'This is the only admin. Make someone else an admin first, so the site is not left without one.';

localAccountsRouter.use(requireAuth);

/**
 * @openapi
 * /api/local-accounts:
 *   get:
 *     tags: [Local accounts]
 *     summary: List local accounts (admin)
 *     responses:
 *       200:
 *         description: "`accounts`: username, playerId, name, isAdmin, totpEnabled, createdAt, lastLoginAt"
 */
localAccountsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, accounts: await localAdminService.listAccounts() });
  } catch (error) {
    log.error('[ACCOUNTS] Listing local accounts failed', error as Error);
    res.status(500).json({ success: false, error: 'Could not load the accounts' });
  }
});

/**
 * @openapi
 * /api/local-accounts:
 *   post:
 *     tags: [Local accounts]
 *     summary: Create a local account (admin)
 *     description: Same-site JSON. The account signs in at /login/admin as the player `local-<username>`.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *               name: { type: string }
 *               isAdmin: { type: boolean }
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Username or password not accepted
 *       409:
 *         description: The username is taken
 */
localAccountsRouter.post('/', guardWrite, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    username?: unknown;
    password?: unknown;
    name?: unknown;
    isAdmin?: unknown;
  };
  const username = normalizeUsername(body.username);
  if (!username) return res.status(400).json({ success: false, error: USERNAME_RULE });
  const problem = passwordProblem(username, body.password);
  if (problem)
    return res.status(400).json({ success: false, error: 'Password not accepted', problem });
  if (body.isAdmin !== undefined && typeof body.isAdmin !== 'boolean') {
    return res.status(400).json({ success: false, error: 'isAdmin must be true or false' });
  }
  const name = typeof body.name === 'string' ? body.name.slice(0, 64) : null;
  try {
    const result = await localAdminService.createAccount(
      username,
      body.password as string,
      { isAdmin: body.isAdmin === true, name },
      requestActorId(req)
    );
    if (!result.ok)
      return res.status(409).json({ success: false, error: 'That username is taken' });
    return res.status(201).json({ success: true, account: result.account });
  } catch (error) {
    log.error('[ACCOUNTS] Creating a local account failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not create the account' });
  }
});

/**
 * @openapi
 * /api/local-accounts/{username}:
 *   put:
 *     tags: [Local accounts]
 *     summary: Make a local account an admin or not (admin)
 *     description: Same-site JSON `{ isAdmin }`. Taking admin from the only admin is refused (409).
 *     responses:
 *       200:
 *         description: Saved
 *       404:
 *         description: No such account
 *       409:
 *         description: It is the only admin
 */
localAccountsRouter.put('/:username', guardWrite, async (req: Request, res: Response) => {
  const username = normalizeUsername(req.params.username);
  const isAdmin = (req.body ?? {}).isAdmin;
  if (typeof isAdmin !== 'boolean')
    return res.status(400).json({ success: false, error: 'isAdmin must be true or false' });
  try {
    const row = username ? await localAdminService.findByUsername(username) : null;
    if (!row) return res.status(404).json({ success: false, error: 'No such account' });
    const player = await playerService.getPlayerById(row.player_id);
    if (
      player?.isAdmin &&
      !isAdmin &&
      removesLastAdmin({ targetIsAdmin: true, adminCount: await playerService.countAdmins() })
    ) {
      return res.status(409).json({ success: false, error: LAST_ADMIN });
    }
    await playerService.updatePlayer(row.player_id, { isAdmin });
    log.warn(`[AUDIT] Local account ${isAdmin ? 'made admin' : 'admin removed'}`, {
      username,
      by: requestActorId(req),
    });
    return res.json({
      success: true,
      account: (await localAdminService.listAccounts()).find((a) => a.username === username),
    });
  } catch (error) {
    log.error('[ACCOUNTS] Updating a local account failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not save the account' });
  }
});

/**
 * @openapi
 * /api/local-accounts/{username}/password:
 *   put:
 *     tags: [Local accounts]
 *     summary: Set a new password for a local account (admin)
 *     description: Same-site JSON `{ password }`. The account's two-step verification is removed.
 *     responses:
 *       200:
 *         description: Saved
 *       400:
 *         description: Password not accepted
 *       404:
 *         description: No such account
 */
localAccountsRouter.put('/:username/password', guardWrite, async (req: Request, res: Response) => {
  const username = normalizeUsername(req.params.username);
  const password = (req.body ?? {}).password;
  if (!username) return res.status(404).json({ success: false, error: 'No such account' });
  const problem = passwordProblem(username, password);
  if (problem)
    return res.status(400).json({ success: false, error: 'Password not accepted', problem });
  try {
    if (!(await localAdminService.setPassword(username, password as string, requestActorId(req)))) {
      return res.status(404).json({ success: false, error: 'No such account' });
    }
    return res.json({ success: true });
  } catch (error) {
    log.error('[ACCOUNTS] Setting a password failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not set the password' });
  }
});

/**
 * @openapi
 * /api/local-accounts/{username}:
 *   delete:
 *     tags: [Local accounts]
 *     summary: Remove a local account's login (admin)
 *     description: Same-site. The player and their history stay. Your own login cannot be removed here (409).
 *     responses:
 *       200:
 *         description: Removed
 *       404:
 *         description: No such account
 *       409:
 *         description: It is your own login
 */
localAccountsRouter.delete('/:username', guardWrite, async (req: Request, res: Response) => {
  const username = normalizeUsername(req.params.username);
  try {
    const row = username ? await localAdminService.findByUsername(username) : null;
    if (!row) return res.status(404).json({ success: false, error: 'No such account' });
    if (row.player_id === requestActorId(req)) {
      return res
        .status(409)
        .json({ success: false, error: 'You cannot remove the login you are signed in with' });
    }
    const player = await playerService.getPlayerById(row.player_id);
    if (removesLastAdmin({ targetIsAdmin: !!player?.isAdmin, adminCount: await playerService.countAdmins() })) {
      return res.status(409).json({ success: false, error: LAST_ADMIN });
    }
    // Removing an account deletes the person (services/playerModeration.ts):
    // a tombstone keeps their match rows, the username is free again.
    const actor = requestActorId(req) ?? 'admin';
    await deletePlayer(row.player_id, { userId: actor, name: actor });
    return res.json({ success: true });
  } catch (error) {
    log.error('[ACCOUNTS] Removing a local account failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not remove the account' });
  }
});
