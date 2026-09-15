import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { applyMatchReport, type MatchReport } from '../services/connectionSnapshotService';
import { db } from '../config/database';
import { playerService } from '../services/playerService';
import { signPlayerSteamId } from '../utils/signedPlayerCookie';
import { primeServerStatusForTests, ServerStatus } from '../services/serverStatusService';
import { authIdentityService, type AuthProvider } from '../services/authIdentityService';
import { completePendingSteamLink, setPendingSteamLinkCookie } from './auth';
import { PENDING_STEAM_LINK_PROVIDERS } from '../utils/signedPendingSteamLink';

const router = Router();

function isE2eTestHelperEnabled(): boolean {
  const enabled = (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase();
  return enabled === '1' || enabled === 'true' || enabled === 'yes';
}

/**
 * @openapi
 * /api/test/marker:
 *   post:
 *     tags:
 *       - Testing
 *     summary: Write a sanitized test marker to the API logs
 *     description: >
 *       Helper endpoint for E2E tests to label log output with the current test name or context.
 *       The message is sanitized (length-limited and restricted to safe characters) before logging.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 description: Free-form test marker (will be sanitized)
 *                 example: "Shuffle Tournament API - should update player ELO after match completion"
 *               scope:
 *                 type: string
 *                 description: Optional scope or shard identifier
 *                 example: "shard-1"
 *     responses:
 *       200:
 *         description: Marker written to logs
 *       400:
 *         description: Invalid request payload
 */
router.post('/marker', requireAuth, (req: Request, res: Response): void => {
  const { message, scope } = req.body as { message?: unknown; scope?: unknown };

  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: 'Field "message" is required and must be a non-empty string',
    });
    return;
  }

  // Sanitize message for logs:
  // - keep full Unicode content (including non-Latin characters)
  // - strip only control characters
  const trimmed = message.trim().slice(0, 300); // limit length
  // Strip ASCII control characters while preserving non‑Latin content.
  // eslint-disable-next-line no-control-regex
  const sanitized = trimmed.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

  const scopeValue = typeof scope === 'string' ? scope.slice(0, 100) : undefined;

  log.info('[TEST-MARKER]', {
    message: sanitized,
    scope: scopeValue,
  });

  res.json({
    success: true,
    message: 'Test marker logged',
  });
});

/**
 * @openapi
 * /api/test/reset-database:
 *   post:
 *     tags:
 *       - Testing
 *     summary: Reset database (development only)
 *     description: >
 *       Drops and recreates the entire database schema and re-initializes default data.
 *       This endpoint is **development only** and is disabled when NODE_ENV=production.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Database was reset and reinitialized successfully
 *       403:
 *         description: Disabled in production environments
 *       500:
 *         description: Failed to reset database
 */
router.post('/reset-database', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({
      success: false,
      error: 'Database reset endpoint is disabled in production',
    });
    return;
  }

  try {
    log.warn('[DEV-TOOLS] Full database reset requested via /api/test/reset-database');
    await db.resetDatabase();
    log.warn('[DEV-TOOLS] Database reset completed successfully');

    res.json({
      success: true,
      message: 'Database reset and reinitialized successfully',
    });
  } catch (err) {
    const error = err as Error;
    log.error('[DEV-TOOLS] Failed to reset database', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset database',
      details: error.message,
    });
  }
});

/**
 * Test-only helper: stand in for a CS2 server's reported status.
 *
 * POST /api/test/server-status  { serverId, status, updatedAt?, online?, matchSlug? }
 *
 * Allocation decisions hinge on what the MatchZy plugin reports through its
 * convars, and CI has no CS2 server to report anything — so without this the
 * idle/busy paths cannot be exercised at all.
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/server-status', requireAuth, (req: Request, res: Response): void => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }

  const { serverId, status, updatedAt, online, matchSlug } = (req.body || {}) as {
    serverId?: string;
    status?: string;
    updatedAt?: number;
    online?: boolean;
    matchSlug?: string;
  };

  if (!serverId) {
    res.status(400).json({ success: false, error: 'serverId is required' });
    return;
  }

  const allowed = Object.values(ServerStatus) as string[];
  if (status !== undefined && status !== null && !allowed.includes(status)) {
    res.status(400).json({ success: false, error: `status must be one of: ${allowed.join(', ')}` });
    return;
  }

  primeServerStatusForTests(serverId, {
    status: (status as ServerStatus) ?? null,
    updatedAt: updatedAt ?? null,
    online: online ?? true,
    matchSlug: matchSlug ?? null,
  });

  log.warn(`[DEV-TOOLS] Primed server status for ${serverId}: ${status ?? 'null'}`);
  res.json({ success: true });
});

/**
 * Test-only helper: put a match into a given state.
 *
 * POST /api/test/match-state  { slug, status?, serverId?, loadedAt? }
 *
 * Reaching states like "assigned to a server and loaded ten minutes ago"
 * through the real flow needs a live CS2 server to allocate against. This lets
 * a test set that state directly and then assert on how MAT reacts to it.
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/match-state', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }

  const { slug, status, serverId, loadedAt } = (req.body || {}) as {
    slug?: string;
    status?: string;
    serverId?: string;
    loadedAt?: number;
  };

  if (!slug) {
    res.status(400).json({ success: false, error: 'slug is required' });
    return;
  }

  const sets: string[] = [];
  const params: Array<string | number> = [];
  if (typeof status === 'string') {
    sets.push('status = ?');
    params.push(status);
  }
  if (typeof serverId === 'string') {
    sets.push('server_id = ?');
    params.push(serverId);
  }
  if (typeof loadedAt === 'number') {
    sets.push('loaded_at = ?');
    params.push(loadedAt);
  }

  if (sets.length === 0) {
    res.status(400).json({ success: false, error: 'nothing to set' });
    return;
  }

  params.push(slug);
  await db.runAsync(`UPDATE matches SET ${sets.join(', ')} WHERE slug = ?`, params);
  log.warn(`[DEV-TOOLS] Set match state for ${slug}: ${sets.join(', ')}`);
  res.json({ success: true });
});

/**
 * Test-only helper: apply a MatchZy match report as if it arrived from a server.
 *
 * POST /api/test/match-report  { slug, report }
 *
 * Match reports reach MAT over RCON, and `rconService` short-circuits fake test
 * servers (host 0.0.0.0) with a canned non-JSON response — so the whole
 * `applyMatchReport` path, including the plugin-phase mapping that decides
 * whether a match reads as WARMUP or LIVE, is otherwise unreachable from the
 * suite. This injects a report directly.
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/match-report', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }

  const { slug, report } = (req.body || {}) as { slug?: string; report?: unknown };

  if (!slug || !report || typeof report !== 'object') {
    res.status(400).json({ success: false, error: 'slug and report are required' });
    return;
  }

  await applyMatchReport(slug, report as MatchReport);
  log.warn(`[DEV-TOOLS] Applied injected match report for ${slug}`);
  res.json({ success: true });
});

/**
 * Test-only helper: create an admin session for Playwright tests.
 *
 * POST /api/test/login-admin
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/login-admin', async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({
      success: false,
      error: 'login-admin test helper is disabled in production',
    });
    return;
  }

  const anyReq = req as Request & {
    login?: (user: unknown, cb: (err: unknown) => void) => void;
  };

  if (!anyReq.login) {
    res.status(500).json({
      success: false,
      error: 'Passport login function is not available on request object',
    });
    return;
  }

  try {
    const { steamId } = req.body as { steamId?: string };
    const testSteamId = steamId && steamId.trim().length > 0 ? steamId.trim() : '76561198000000001';

    // Ensure a player exists and is marked as admin for this Steam ID.
    await playerService.getOrCreatePlayer(testSteamId, `Test Admin ${testSteamId}`);
    await playerService.updatePlayer(testSteamId, { isAdmin: true });

    const user = {
      provider: 'steam' as const,
      steamId: testSteamId,
    };

    anyReq.login(user, (err) => {
      if (err) {
        log.error('Failed to create admin session via /api/test/login-admin', err as Error);
        res.status(500).json({
          success: false,
          error: 'Failed to create admin session',
        });
        return;
      }

      // Also set the signed player_steam_id cookie so that auth can fall back to
      // cookie-based admin resolution in environments where the session cookie
      // is not persisted (e.g. some reverse proxy / browser combinations).
      res.cookie('player_steam_id', signPlayerSteamId(testSteamId), {
        httpOnly: false,
        // Test helpers must work over plain HTTP in E2E containers.
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      });

      res.json({
        success: true,
        steamId: testSteamId,
      });
    });
  } catch (err) {
    const error = err as Error;
    log.error('Error in /api/test/login-admin', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create admin session',
      details: error.message,
    });
  }
});

/**
 * Test-only helper: create a non-admin player session (signed player_steam_id cookie only).
 * Used to verify that normal users cannot access admin UI or API.
 *
 * POST /api/test/login-player
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/login-player', async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({
      success: false,
      error: 'login-player test helper is disabled in production',
    });
    return;
  }

  try {
    const { steamId: raw } = req.body as { steamId?: string };
    const steamId = raw && raw.trim().length > 0 ? raw.trim() : '76561198000000002';

    await playerService.getOrCreatePlayer(steamId, `Test Player ${steamId}`);
    await playerService.updatePlayer(steamId, { isAdmin: false });

    res.cookie('player_steam_id', signPlayerSteamId(steamId), {
      httpOnly: false,
      // Test helpers must work over plain HTTP in E2E containers.
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    res.json({
      success: true,
      steamId,
    });
  } catch (err) {
    const error = err as Error;
    log.error('Error in /api/test/login-player', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create player session',
      details: error.message,
    });
  }
});

function isTestHelperDisabled(res: Response): boolean {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return true;
  }
  return false;
}

function parseProvider(value: unknown): AuthProvider | null {
  return typeof value === 'string' &&
    (PENDING_STEAM_LINK_PROVIDERS as readonly string[]).includes(value)
    ? (value as AuthProvider)
    : null;
}

const STEAM_ID_RE = /^\d{17}$/;

/**
 * Test-only helper: issue a pending Steam link cookie with the real writer.
 *
 * POST /api/test/pending-steam-link
 * Body: { provider?: 'discord' | 'keycloak' | 'github', providerUserId }
 *
 * Calls `setPendingSteamLinkCookie`, the same function the SSO callbacks call
 * when an identity has no Steam link yet, so tests get a genuine cookie without
 * a real OAuth round trip.
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/pending-steam-link', requireAuth, (req: Request, res: Response): void => {
  if (isTestHelperDisabled(res)) return;

  const { provider: rawProvider, providerUserId } = req.body as {
    provider?: unknown;
    providerUserId?: unknown;
  };
  const provider = rawProvider === undefined ? 'discord' : parseProvider(rawProvider);
  if (!provider) {
    res.status(400).json({ success: false, error: 'Field "provider" is not a known SSO provider' });
    return;
  }
  if (typeof providerUserId !== 'string' || providerUserId.trim() === '') {
    res.status(400).json({ success: false, error: 'Field "providerUserId" is required' });
    return;
  }

  setPendingSteamLinkCookie(res, provider, providerUserId);
  res.json({ success: true });
});

/**
 * Test-only helper: run the linking step of the Steam callback.
 *
 * POST /api/test/complete-steam-link
 * Body: { steamId, nowOffsetMs? }
 *
 * `/steam/callback` needs a real Steam OpenID login, so nothing else reaches the
 * code that decides whether a `pending_steam_link` cookie is trusted. This
 * pretends Steam just proved `steamId` and calls the same
 * `completePendingSteamLink` the callback calls, against this request's own
 * cookies and session. The player row is created first, as the callback does
 * (auth_identities.steam_id references players).
 *
 * `nowOffsetMs` shifts the clock the cookie's expiry is checked against.
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post(
  '/complete-steam-link',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;

    const { steamId, nowOffsetMs } = req.body as { steamId?: unknown; nowOffsetMs?: unknown };
    if (typeof steamId !== 'string' || !STEAM_ID_RE.test(steamId)) {
      res
        .status(400)
        .json({ success: false, error: 'Field "steamId" must be a 17-digit Steam ID' });
      return;
    }
    if (
      nowOffsetMs !== undefined &&
      (typeof nowOffsetMs !== 'number' || !Number.isFinite(nowOffsetMs))
    ) {
      res.status(400).json({ success: false, error: 'Field "nowOffsetMs" must be a number' });
      return;
    }

    try {
      await playerService.getOrCreatePlayer(steamId, `Test Player ${steamId}`);
      const result = await completePendingSteamLink(req, res, steamId, {
        now: typeof nowOffsetMs === 'number' ? Date.now() + nowOffsetMs : undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      log.error('Error in /api/test/complete-steam-link', err as Error);
      res.status(500).json({ success: false, error: 'Failed to complete Steam link' });
    }
  }
);

/**
 * Test-only helper: read the auth identity links for one external account.
 *
 * GET /api/test/auth-identities?provider=discord&providerUserId=123...
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.get('/auth-identities', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;

  const { provider, providerUserId } = req.query;
  if (typeof provider !== 'string' || typeof providerUserId !== 'string') {
    res.status(400).json({
      success: false,
      error: 'Query parameters "provider" and "providerUserId" are required',
    });
    return;
  }

  try {
    const rows = await db.queryAsync<{ steam_id: string }>(
      'SELECT steam_id FROM auth_identities WHERE provider = ? AND provider_user_id = ? ORDER BY id',
      [provider, providerUserId]
    );
    res.json({ success: true, steamIds: rows.map((r) => r.steam_id) });
  } catch (err) {
    log.error('Error in GET /api/test/auth-identities', err as Error);
    res.status(500).json({ success: false, error: 'Failed to read auth identities' });
  }
});

/**
 * Test-only helper: seed an auth identity link (creating the player first).
 *
 * POST /api/test/auth-identities
 * Body: { provider?, providerUserId, steamId }
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/auth-identities', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;

  const {
    provider: rawProvider,
    providerUserId,
    steamId,
  } = req.body as {
    provider?: unknown;
    providerUserId?: unknown;
    steamId?: unknown;
  };
  const provider = rawProvider === undefined ? 'discord' : parseProvider(rawProvider);
  if (!provider) {
    res.status(400).json({ success: false, error: 'Field "provider" is not a known SSO provider' });
    return;
  }
  if (typeof providerUserId !== 'string' || providerUserId.trim() === '') {
    res.status(400).json({ success: false, error: 'Field "providerUserId" is required' });
    return;
  }
  if (typeof steamId !== 'string' || !STEAM_ID_RE.test(steamId)) {
    res.status(400).json({ success: false, error: 'Field "steamId" must be a 17-digit Steam ID' });
    return;
  }

  try {
    await playerService.getOrCreatePlayer(steamId, `Test Player ${steamId}`);
    await authIdentityService.linkIdentityToSteam(provider, providerUserId, steamId);
    res.json({ success: true });
  } catch (err) {
    log.error('Error in POST /api/test/auth-identities', err as Error);
    res.status(500).json({ success: false, error: 'Failed to seed auth identity' });
  }
});

export default router;
