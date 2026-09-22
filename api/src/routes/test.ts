import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { integrationForMatch } from '../integrations/registry';
import { db } from '../config/database';
import { playerService } from '../services/playerService';
import { signPlayerSteamId } from '../utils/signedPlayerCookie';
import { primeServerStatusForTests, ServerStatus } from '../integrations/cs2/services/serverStatusService';
import { authIdentityService, type AuthProvider } from '../services/authIdentityService';
import {
  completePendingSteamLink,
  requireStrategy,
  setPendingSteamLinkCookie,
  ssoCallbackRoute,
  startAccountLink,
} from './auth';
import { passport, testOAuthStrategyName } from '../config/passport';
import { PENDING_STEAM_LINK_PROVIDERS } from '../utils/signedPendingSteamLink';
import { setIgdbEndpointOverride, clearIgdbTokenCache } from '../services/igdbService';
import { setWikidataEndpointOverride, resetWikidataThrottle } from '../services/wikidataService';
import { clearGameSearchCache } from '../services/gameCatalogService';
import { gameSearchLimiter } from './games';

const router = Router();

function isE2eTestHelperEnabled(): boolean {
  const enabled = (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase();
  return enabled === '1' || enabled === 'true' || enabled === 'yes';
}

/**
 * Test sign-ins skip the "What do you play?" dialog unless the test asks for
 * it with `{ gamesPrompt: true }`: it is a modal, and every other UI spec that
 * signs in would otherwise have to dismiss it first.
 */
async function setGamesPromptForTest(steamId: string, body: unknown): Promise<void> {
  const wantsPrompt = (body as { gamesPrompt?: unknown } | undefined)?.gamesPrompt === true;
  await db.runAsync('UPDATE players SET games_prompt_dismissed_at = ? WHERE id = ?', [
    wantsPrompt ? null : Math.floor(Date.now() / 1000),
    steamId,
  ]);
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

  const match = await db.queryOneAsync<{ game?: string | null }>(
    'SELECT game FROM matches WHERE slug = ?',
    [slug]
  );
  await integrationForMatch(match ?? {}).syncMatchState?.(slug, { report });
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
    await setGamesPromptForTest(testSteamId, req.body);

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
    const { steamId: raw, name: rawName } = req.body as { steamId?: string; name?: string };
    const steamId = raw && raw.trim().length > 0 ? raw.trim() : '76561198000000002';
    // `name` is only used when the player is first created (getOrCreatePlayer
    // does not rename an existing player), so it is safe to pass on every
    // call without affecting an existing test player's name.
    const name =
      rawName && rawName.trim().length > 0 ? rawName.trim() : `Test Player ${steamId}`;

    await playerService.getOrCreatePlayer(steamId, name);
    await playerService.updatePlayer(steamId, { isAdmin: false });
    await setGamesPromptForTest(steamId, req.body);

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
 * Test-only helper: the raw, stored roster JSON of one team (`teams.players`).
 *
 * GET /api/test/raw-team-roster/:teamId
 *
 * Read-only. Exists so a test can prove a Discord ID was never written into the
 * roster JSON. No real endpoint can show that: admin team GETs overwrite each
 * roster player's `discordId` from the players table, and public team pages
 * never show roster fields, so an ID stored in the JSON would go unnoticed.
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.get(
  '/raw-team-roster/:teamId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;

    try {
      const row = await db.queryOneAsync<{ players: string | null }>(
        'SELECT players FROM teams WHERE id = ?',
        [req.params.teamId]
      );
      if (!row) {
        res.status(404).json({ success: false, error: 'Team not found' });
        return;
      }
      const players: unknown = row.players ? JSON.parse(row.players) : [];
      res.json({ success: true, players });
    } catch (err) {
      log.error('Error in GET /api/test/raw-team-roster', err as Error);
      res.status(500).json({ success: false, error: 'Failed to read team roster' });
    }
  }
);

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

/*
 * Test-only fake OAuth provider for GitHub and Google.
 *
 * config/passport.ts registers a `github-test` and a `google-test` strategy
 * (only when ENABLE_TEST_ENDPOINTS is explicitly on) whose token and profile
 * endpoints point here. The routes below then drive the real strategy code and
 * the real callback route (`ssoCallbackRoute`), so a test can complete a GitHub or Google
 * login end to end without talking to github.com or google.com.
 *
 * The test picks the profile the "provider" returns: the authorization `code`
 * is the base64url-encoded JSON of the raw profile (GitHub /user or Google
 * userinfo format). The token endpoint hands that back as the access token and
 * the userinfo endpoint decodes it. A code starting with `fail` makes the token
 * endpoint refuse, like a provider rejecting a used or bogus code.
 *
 *   GET  /api/test/oauth/:provider            start (sets the state cookie)
 *   POST /api/test/oauth/:provider/link       start linking to the signed-in account
 *   GET  /api/test/oauth/:provider/callback   callback (state, code exchange, linking)
 *   GET  /api/test/fake-oauth/:provider/authorize
 *   POST /api/test/fake-oauth/:provider/token
 *   GET  /api/test/fake-oauth/:provider/userinfo
 */

const FAKE_OAUTH_PROVIDERS = ['github', 'google'] as const;
type FakeOAuthProvider = (typeof FAKE_OAUTH_PROVIDERS)[number];

function parseFakeOAuthProvider(value: unknown): FakeOAuthProvider | null {
  return typeof value === 'string' && (FAKE_OAUTH_PROVIDERS as readonly string[]).includes(value)
    ? (value as FakeOAuthProvider)
    : null;
}

/** The fake provider only exists when test endpoints are explicitly enabled. */
function fakeOAuthProviderFrom(req: Request, res: Response): FakeOAuthProvider | null {
  const provider = parseFakeOAuthProvider(req.params.provider);
  if (!isE2eTestHelperEnabled() || !provider) {
    res.status(404).json({ success: false, error: 'Not found' });
    return null;
  }
  return provider;
}

router.get('/oauth/:provider', (req: Request, res: Response, next: NextFunction) => {
  const provider = fakeOAuthProviderFrom(req, res);
  if (!provider) return;
  const name = testOAuthStrategyName(provider);
  requireStrategy(name, provider)(req, res, () => passport.authenticate(name)(req, res, next));
});

// Link the fake provider to the signed-in account, as POST /api/auth/<provider>/link.
router.post('/oauth/:provider/link', (req: Request, res: Response, next: NextFunction) => {
  const provider = fakeOAuthProviderFrom(req, res);
  if (!provider) return;
  const name = testOAuthStrategyName(provider);
  requireStrategy(name, provider)(req, res, () => {
    void startAccountLink(name, provider)(req, res, next);
  });
});

router.get('/oauth/:provider/callback', (req: Request, res: Response, next: NextFunction) => {
  const provider = fakeOAuthProviderFrom(req, res);
  if (!provider) return;
  const name = testOAuthStrategyName(provider);
  // The strategy's state cookie is namespaced by the strategy name.
  requireStrategy(name, provider)(req, res, () => ssoCallbackRoute(name, name, provider)(req, res, next));
});

router.get('/fake-oauth/:provider/authorize', (req: Request, res: Response): void => {
  if (!fakeOAuthProviderFrom(req, res)) return;
  // A real provider would show a consent screen here. Tests read the state
  // from the redirect to this URL and call the callback themselves.
  res.json({ success: true });
});

router.post('/fake-oauth/:provider/token', (req: Request, res: Response): void => {
  if (!fakeOAuthProviderFrom(req, res)) return;
  const code = (req.body as { code?: unknown }).code;
  if (typeof code !== 'string' || code.length === 0 || code.startsWith('fail')) {
    res.status(400).json({ error: 'bad_verification_code' });
    return;
  }
  res.json({ access_token: code, token_type: 'bearer', scope: '' });
});

router.get('/fake-oauth/:provider/userinfo', (req: Request, res: Response): void => {
  if (!fakeOAuthProviderFrom(req, res)) return;
  // passport-github2 sends the token as a Bearer header, passport-google-oauth20
  // as an access_token query parameter.
  const header = req.headers.authorization || '';
  const query = typeof req.query.access_token === 'string' ? req.query.access_token : '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : query;
  try {
    const profile: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!profile || typeof profile !== 'object') throw new Error('not an object');
    res.json(profile);
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
});

/*
 * Test-only fake IGDB (api.igdb.com v4) and Twitch token endpoint.
 *
 *   POST /api/test/igdb                 { fake: true | false } point the IGDB
 *                                       client at this fake (or back), and reset
 *                                       its token cache, the search cache and the
 *                                       search rate limiter
 *   GET  /api/test/igdb                 request counters
 *   POST /api/test/fake-igdb/token      Twitch client-credentials token
 *   POST /api/test/fake-igdb/v4/games   Apicalypse `search "..."` over FAKE_IGDB_GAMES
 *
 * A client id starting with `bad` is refused by the token endpoint, and a
 * search containing `explode` makes the games endpoint answer 500, so tests
 * can drive the failure paths.
 */

const FAKE_IGDB_GAMES = [
  { id: 1001, name: 'Rocket League', slug: 'rocket-league', year: 2015, image: 'fakerl' },
  { id: 1002, name: 'Rocket Knight Adventures', slug: 'rocket-knight-adventures', year: 1993, image: null },
  { id: 1003, name: 'Counter-Strike 2', slug: 'counter-strike-2', year: 2023, image: 'fakecs2' },
  { id: 1004, name: 'Hollow Knight', slug: 'hollow-knight', year: 2017, image: 'fakehk' },
  { id: 1005, name: 'Stardew Valley', slug: 'stardew-valley', year: 2016, image: null },
  { id: 1006, name: 'Celeste', slug: 'celeste', year: 2018, image: 'fakecel' },
];

const fakeIgdbCounters = { tokenRequests: 0, searchRequests: 0 };
let fakeIgdbTokenSerial = 0;
const fakeIgdbTokens = new Set<string>();

function fakeIgdbEnabled(res: Response): boolean {
  if (!isE2eTestHelperEnabled()) {
    res.status(404).json({ success: false, error: 'Not found' });
    return false;
  }
  return true;
}

router.post('/igdb', requireAuth, (req: Request, res: Response): void => {
  if (!fakeIgdbEnabled(res)) return;
  const { fake } = (req.body ?? {}) as { fake?: unknown };
  const self = `http://127.0.0.1:${process.env.PORT || '3000'}/api/test/fake-igdb`;
  setIgdbEndpointOverride(
    fake === false ? null : { apiBase: `${self}/v4`, tokenUrl: `${self}/token` }
  );
  clearIgdbTokenCache();
  clearGameSearchCache();
  gameSearchLimiter.reset();
  fakeIgdbCounters.tokenRequests = 0;
  fakeIgdbCounters.searchRequests = 0;
  fakeIgdbTokens.clear();
  res.json({ success: true, fake: fake !== false });
});

router.get('/igdb', requireAuth, (_req: Request, res: Response): void => {
  if (!fakeIgdbEnabled(res)) return;
  res.json({ success: true, ...fakeIgdbCounters });
});

router.post('/fake-igdb/token', (req: Request, res: Response): void => {
  if (!fakeIgdbEnabled(res)) return;
  fakeIgdbCounters.tokenRequests += 1;
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : '';
  const secret = typeof req.query.client_secret === 'string' ? req.query.client_secret : '';
  if (
    !clientId ||
    !secret ||
    clientId.startsWith('bad') ||
    req.query.grant_type !== 'client_credentials'
  ) {
    res.status(400).json({ status: 400, message: 'invalid client' });
    return;
  }
  fakeIgdbTokenSerial += 1;
  const token = `fake-igdb-token-${fakeIgdbTokenSerial}`;
  fakeIgdbTokens.add(token);
  res.json({ access_token: token, expires_in: 5_000_000, token_type: 'bearer' });
});

router.post(
  '/fake-igdb/v4/games',
  express.text({ type: '*/*' }),
  (req: Request, res: Response): void => {
    if (!fakeIgdbEnabled(res)) return;
    const auth = req.headers.authorization || '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!req.headers['client-id'] || !fakeIgdbTokens.has(token)) {
      res.status(401).json({ message: 'Authorization Failure' });
      return;
    }
    fakeIgdbCounters.searchRequests += 1;

    const body = typeof req.body === 'string' ? req.body : '';
    const term = /search\s+"([^"]*)"/.exec(body)?.[1]?.toLowerCase() ?? '';
    if (term.includes('explode')) {
      res.status(500).json({ message: 'Internal Server Error' });
      return;
    }
    const limit = Number(/limit\s+(\d+)/.exec(body)?.[1] ?? 10);
    const rows = FAKE_IGDB_GAMES.filter((g) => !term || g.name.toLowerCase().includes(term))
      .slice(0, limit)
      .map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        first_release_date: Math.floor(Date.UTC(g.year, 5, 1) / 1000),
        ...(g.image ? { cover: { id: g.id * 10, image_id: g.image } } : {}),
      }));
    res.json(rows);
  }
);

/*
 * Test-only fake Wikidata (www.wikidata.org/w/api.php).
 *
 *   POST /api/test/wikidata      { fake: true | false } point the Wikidata
 *                                client at this fake (or back), and reset its
 *                                rate-limit window, the search cache and the
 *                                search rate limiter
 *   GET  /api/test/wikidata      request counters
 *   GET  /api/test/fake-wikidata action=wbsearchentities|wbgetentities over
 *                                FAKE_WIKIDATA_ITEMS
 *
 * A search containing `wderror` makes wbsearchentities answer 500, so tests
 * can drive the fallback-to-built-ins path without a real network failure.
 */

interface FakeWikidataItem {
  id: string;
  label: string;
  /** QIDs this item is "instance of" (P31): a game (Q7889), a series (Q1150710), or neither. */
  instanceOf: string[];
  /** P577 publication date values, as Wikibase time strings. */
  pubDates: string[];
  logo?: string;
  image?: string;
}

const FAKE_WIKIDATA_ITEMS: FakeWikidataItem[] = [
  {
    id: 'Q10510',
    label: 'Rocket League',
    instanceOf: ['Q7889'],
    pubDates: ['+2015-07-07T00:00:00Z'],
    logo: 'Rocket League logo.png',
  },
  {
    id: 'Q2005',
    label: 'Counter-Strike 2',
    instanceOf: ['Q7889'],
    pubDates: ['+2023-09-27T00:00:00Z'],
    image: 'Counter-Strike 2 key art.jpg',
  },
  {
    id: 'Q108364709',
    label: 'Hollow Knight',
    instanceOf: ['Q7889'],
    // Deliberately out of order and with more than one value: the earliest
    // (2017) must win, not the first or the latest.
    pubDates: ['+2018-06-26T00:00:00Z', '+2017-02-24T00:00:00Z'],
  },
  {
    id: 'Q19835',
    label: 'Hollow Corp',
    instanceOf: ['Q4830453'], // a business, not a video game: must be filtered out
    pubDates: [],
  },
  {
    id: 'Q4438121',
    label: 'Mario (franchise)',
    instanceOf: ['Q1150710'], // a video game series: only kept when nothing else matched
    pubDates: [],
  },
  // Popular built-ins other specs search for with no IGDB credentials
  // configured; without a matching fake item, Wikidata would legitimately
  // answer "no matches" and (like a real, comprehensive source) suppress
  // those built-ins from the results (see gameCatalogService.searchGames).
  { id: 'Q1258949', label: 'Dota 2', instanceOf: ['Q7889'], pubDates: ['+2013-07-09T00:00:00Z'] },
  { id: 'Q30819', label: 'Chess', instanceOf: ['Q7889'], pubDates: [] },
];

const fakeWikidataCounters = { searchRequests: 0, getEntitiesRequests: 0 };

function fakeWikidataEnabled(res: Response): boolean {
  if (!isE2eTestHelperEnabled()) {
    res.status(404).json({ success: false, error: 'Not found' });
    return false;
  }
  return true;
}

router.post('/wikidata', requireAuth, (req: Request, res: Response): void => {
  if (!fakeWikidataEnabled(res)) return;
  const { fake } = (req.body ?? {}) as { fake?: unknown };
  const self = `http://127.0.0.1:${process.env.PORT || '3000'}/api/test/fake-wikidata`;
  setWikidataEndpointOverride(fake === false ? null : self);
  resetWikidataThrottle();
  clearGameSearchCache();
  gameSearchLimiter.reset();
  fakeWikidataCounters.searchRequests = 0;
  fakeWikidataCounters.getEntitiesRequests = 0;
  res.json({ success: true, fake: fake !== false });
});

router.get('/wikidata', requireAuth, (_req: Request, res: Response): void => {
  if (!fakeWikidataEnabled(res)) return;
  res.json({ success: true, ...fakeWikidataCounters });
});

router.get('/fake-wikidata', (req: Request, res: Response): void => {
  if (!fakeWikidataEnabled(res)) return;

  const action = typeof req.query.action === 'string' ? req.query.action : '';

  if (action === 'wbsearchentities') {
    fakeWikidataCounters.searchRequests += 1;
    const term = (typeof req.query.search === 'string' ? req.query.search : '').toLowerCase();
    if (term.includes('wderror')) {
      res.status(500).json({ error: { code: 'internal_api_error', info: 'fake failure' } });
      return;
    }
    const limit = Number(req.query.limit ?? 20) || 20;
    const hits = FAKE_WIKIDATA_ITEMS.filter((item) => item.label.toLowerCase().includes(term)).slice(
      0,
      limit
    );
    res.json({ search: hits.map((item) => ({ id: item.id, label: item.label })) });
    return;
  }

  if (action === 'wbgetentities') {
    fakeWikidataCounters.getEntitiesRequests += 1;
    const ids = (typeof req.query.ids === 'string' ? req.query.ids : '').split('|').filter(Boolean);
    const entities: Record<string, unknown> = {};
    for (const id of ids) {
      const item = FAKE_WIKIDATA_ITEMS.find((i) => i.id === id);
      if (!item) continue;
      entities[id] = {
        id: item.id,
        labels: { en: { language: 'en', value: item.label } },
        claims: {
          P31: item.instanceOf.map((qid) => ({ mainsnak: { datavalue: { value: { id: qid } } } })),
          P577: item.pubDates.map((time) => ({ mainsnak: { datavalue: { value: { time } } } })),
          ...(item.logo
            ? { P154: [{ mainsnak: { datavalue: { value: item.logo } } }] }
            : {}),
          ...(item.image
            ? { P18: [{ mainsnak: { datavalue: { value: item.image } } }] }
            : {}),
        },
      };
    }
    res.json({ entities });
    return;
  }

  res.status(400).json({ error: { code: 'unknown_action', info: `unknown action: ${action}` } });
});

export default router;
