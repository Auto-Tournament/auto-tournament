import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { integrationForMatch } from '../integrations/registry';
import type { ResultMeta, SeriesResult } from '../integrations/types';
import { matchLifecycle } from '../core/matchLifecycle';
import { db } from '../config/database';
import { playerService } from '../services/playerService';
import { signPlayerSteamId } from '../utils/signedPlayerCookie';
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
import {
  backfillLinkedAccounts,
  backfillTeamMembers,
  runSchemaMigrations,
} from '../config/schemaMigrations';
import { playerIdentity } from '../services/playerIdentity';
import { teamMembers } from '../services/teamMembers';

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
 * Test-only helper: apply a series result through the core's result path.
 *
 * POST /api/test/series-result  { slug, result, meta }
 *
 * `matchLifecycle.applySeriesResult` is what every series end goes through (the
 * game's series end, the admin "set winner" action, later manual reports).
 * This calls it directly with any `source`, so a test can pin its contract
 * (idempotent, accepts ready and live matches, records who decided) without a
 * game in the loop. Answers with the outcome.
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/series-result', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }

  const { slug, result, meta } = (req.body || {}) as {
    slug?: string;
    result?: SeriesResult;
    meta?: Partial<ResultMeta>;
  };
  if (!slug || !result || typeof result !== 'object') {
    res.status(400).json({ success: false, error: 'slug and result are required' });
    return;
  }

  const outcome = await matchLifecycle.applySeriesResult(
    slug,
    {
      games: Array.isArray(result.games) ? result.games : [],
      team1Score: Number(result.team1Score) || 0,
      team2Score: Number(result.team2Score) || 0,
      winner: result.winner,
    },
    { source: meta?.source ?? 'admin', actorId: meta?.actorId ?? null }
  );
  log.warn(`[DEV-TOOLS] Applied series result for ${slug}`, { outcome });
  res.json({ success: true, ...outcome });
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

/**
 * Test-only helpers for the identity preparation (`linked_accounts`,
 * `schema_migrations`, `playerIdentity.resolve`). No real endpoint reads
 * `linked_accounts` yet, so these are how a test can see it.
 *
 *   GET  /api/test/linked-accounts?playerId=...        that player's rows, by id
 *   POST /api/test/linked-accounts/backfill            run the backfill again
 *        Body: { clearPlayerId? }                      (delete that player's rows first)
 *   GET  /api/test/schema-migrations                   the applied migration ids
 *   POST /api/test/schema-migrations/run               run the migrations again
 *   GET  /api/test/player-identity/resolve?provider=...&externalId=...
 *
 * NOTE: These endpoints are only available in non-production environments.
 */
router.get('/linked-accounts', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;

  const { playerId } = req.query;
  if (typeof playerId !== 'string' || playerId === '') {
    res.status(400).json({ success: false, error: 'Query parameter "playerId" is required' });
    return;
  }
  try {
    const rows = await db.queryAsync<{
      id: number;
      provider: string;
      external_id: string;
      verified: boolean;
      created_at: number;
    }>(
      'SELECT id, provider, external_id, verified, created_at FROM linked_accounts WHERE player_id = ? ORDER BY id',
      [playerId]
    );
    res.json({
      success: true,
      accounts: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        externalId: r.external_id,
        verified: r.verified,
        createdAt: Number(r.created_at),
      })),
    });
  } catch (err) {
    log.error('Error in GET /api/test/linked-accounts', err as Error);
    res.status(500).json({ success: false, error: 'Failed to read linked accounts' });
  }
});

router.post(
  '/linked-accounts/backfill',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;

    const { clearPlayerId } = (req.body ?? {}) as { clearPlayerId?: unknown };
    if (clearPlayerId !== undefined && typeof clearPlayerId !== 'string') {
      res.status(400).json({ success: false, error: 'Field "clearPlayerId" must be a string' });
      return;
    }
    try {
      if (typeof clearPlayerId === 'string') {
        await db.runAsync('DELETE FROM linked_accounts WHERE player_id = ?', [clearPlayerId]);
      }
      const inserted = await db.withClient((client) => backfillLinkedAccounts(client));
      res.json({ success: true, inserted });
    } catch (err) {
      log.error('Error in POST /api/test/linked-accounts/backfill', err as Error);
      res.status(500).json({ success: false, error: 'Failed to run the backfill' });
    }
  }
);

router.get('/schema-migrations', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;
  try {
    const rows = await db.queryAsync<{ id: string }>(
      'SELECT id FROM schema_migrations ORDER BY applied_at, id'
    );
    res.json({ success: true, applied: rows.map((r) => r.id) });
  } catch (err) {
    log.error('Error in GET /api/test/schema-migrations', err as Error);
    res.status(500).json({ success: false, error: 'Failed to read schema migrations' });
  }
});

router.post(
  '/schema-migrations/run',
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;
    try {
      const applied = await db.withClient((client) => runSchemaMigrations(client));
      res.json({ success: true, applied });
    } catch (err) {
      log.error('Error in POST /api/test/schema-migrations/run', err as Error);
      res.status(500).json({ success: false, error: 'Failed to run schema migrations' });
    }
  }
);

router.get(
  '/player-identity/resolve',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;

    const { provider, externalId } = req.query;
    if (typeof provider !== 'string' || typeof externalId !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Query parameters "provider" and "externalId" are required',
      });
      return;
    }
    try {
      const playerId = await playerIdentity.resolve({ provider, externalId });
      res.json({ success: true, playerId });
    } catch (err) {
      log.error('Error in GET /api/test/player-identity/resolve', err as Error);
      res.status(500).json({ success: false, error: 'Failed to resolve the account' });
    }
  }
);

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
  {
    id: 1001,
    name: 'Rocket League',
    slug: 'rocket-league',
    year: 2015,
    image: 'fakerl',
    genres: ['Sport', 'Racing'],
  },
  {
    id: 1002,
    name: 'Rocket Knight Adventures',
    slug: 'rocket-knight-adventures',
    year: 1993,
    image: null,
    genres: [],
  },
  {
    id: 1003,
    name: 'Counter-Strike 2',
    slug: 'counter-strike-2',
    year: 2023,
    image: 'fakecs2',
    genres: ['Shooter', 'Tactical'],
  },
  { id: 1004, name: 'Hollow Knight', slug: 'hollow-knight', year: 2017, image: 'fakehk', genres: ['Platform'] },
  { id: 1005, name: 'Stardew Valley', slug: 'stardew-valley', year: 2016, image: null, genres: [] },
  { id: 1006, name: 'Celeste', slug: 'celeste', year: 2018, image: 'fakecel', genres: ['Platform'] },
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
        genres: g.genres.map((name) => ({ name })),
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
  /** P136 (genre) item ids; resolved to `FAKE_WIKIDATA_GENRES` labels. */
  genreIds?: string[];
}

/** Genre item ids referenced by `FAKE_WIKIDATA_ITEMS.genreIds`, id -> English label. */
const FAKE_WIKIDATA_GENRES: Record<string, string> = {
  Q1: 'Shooter',
  Q2: 'Tactical shooter',
  Q3: 'Sports',
};

const FAKE_WIKIDATA_ITEMS: FakeWikidataItem[] = [
  {
    id: 'Q10510',
    label: 'Rocket League',
    instanceOf: ['Q7889'],
    pubDates: ['+2015-07-07T00:00:00Z'],
    logo: 'Rocket League logo.png',
    genreIds: ['Q3'],
  },
  {
    id: 'Q2005',
    label: 'Counter-Strike 2',
    instanceOf: ['Q7889'],
    pubDates: ['+2023-09-27T00:00:00Z'],
    image: 'Counter-Strike 2 key art.jpg',
    genreIds: ['Q1', 'Q2'],
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
      if (item) {
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
            ...(item.genreIds
              ? { P136: item.genreIds.map((qid) => ({ mainsnak: { datavalue: { value: { id: qid } } } })) }
              : {}),
          },
        };
        continue;
      }
      // Not a game — the second, genre-label-only batched call this codebase
      // makes for P136 ids (see wikidataService.resolveGenreLabels).
      const genreLabel = FAKE_WIKIDATA_GENRES[id];
      if (genreLabel) {
        entities[id] = { id, labels: { en: { language: 'en', value: genreLabel } } };
      }
    }
    res.json({ entities });
    return;
  }

  res.status(400).json({ error: { code: 'unknown_action', info: `unknown action: ${action}` } });
});

/**
 * Test-only helpers for the manual-reporting schema (3.0 phase D, PR D1).
 * Nothing in the app reads these tables yet, so these are how a spec can see
 * them and prove the constraints hold.
 *
 *   GET  /api/test/team-members?teamId=...     that team's memberships
 *   POST /api/test/team-members/backfill       run the backfill again
 *        Body: { clearTeamId? }                (delete that team's rows first)
 *   GET  /api/test/phase-d-schema              columns and indexes of the new tables
 *   GET  /api/test/match-reports?matchSlug=... that match's reports
 *   POST /api/test/match-reports               insert one raw report row
 *        Body: { matchSlug, revision?, status?, source?, result? }
 *        409 when a constraint rejects it (a second open report, a repeated revision)
 *
 * NOTE: These endpoints are only available in non-production environments.
 */

/** The only tables `/api/test/phase-d-schema` will describe. */
const PHASE_D_TABLES = [
  'team_members',
  'match_reports',
  'match_report_actions',
  'custom_stat_fields',
  'match_stat_values',
] as const;

router.get('/team-members', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;

  const { teamId } = req.query;
  if (typeof teamId !== 'string' || teamId === '') {
    res.status(400).json({ success: false, error: 'Query parameter "teamId" is required' });
    return;
  }
  try {
    const rows = await db.queryAsync<{
      account_uid: string;
      role: string;
      created_at: number;
      player_id: string | null;
    }>(
      `SELECT tm.account_uid, tm.role, tm.created_at, p.id AS player_id
         FROM team_members tm
         LEFT JOIN players p ON p.uid = tm.account_uid
        WHERE tm.team_id = ?
        ORDER BY tm.created_at, tm.account_uid`,
      [teamId]
    );
    res.json({
      success: true,
      members: rows.map((r) => ({
        accountUid: r.account_uid,
        role: r.role,
        createdAt: Number(r.created_at),
        playerId: r.player_id,
      })),
    });
  } catch (err) {
    log.error('Error in GET /api/test/team-members', err as Error);
    res.status(500).json({ success: false, error: 'Failed to read team members' });
  }
});

router.post(
  '/team-members/backfill',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;

    const { clearTeamId } = (req.body ?? {}) as { clearTeamId?: unknown };
    if (clearTeamId !== undefined && typeof clearTeamId !== 'string') {
      res.status(400).json({ success: false, error: 'Field "clearTeamId" must be a string' });
      return;
    }
    try {
      if (typeof clearTeamId === 'string') {
        await db.runAsync('DELETE FROM team_members WHERE team_id = ?', [clearTeamId]);
      }
      const inserted = await db.withClient((client) => backfillTeamMembers(client));
      res.json({ success: true, inserted });
    } catch (err) {
      log.error('Error in POST /api/test/team-members/backfill', err as Error);
      res.status(500).json({ success: false, error: 'Failed to run the backfill' });
    }
  }
);

router.post('/team-members', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;

  const { teamId, accountUid, role } = (req.body ?? {}) as {
    teamId?: unknown;
    accountUid?: unknown;
    role?: unknown;
  };
  if (typeof teamId !== 'string' || teamId === '') {
    res.status(400).json({ success: false, error: 'Field "teamId" is required' });
    return;
  }
  if (typeof accountUid !== 'string' || accountUid === '') {
    res.status(400).json({ success: false, error: 'Field "accountUid" is required' });
    return;
  }
  if (role !== 'captain' && role !== 'member') {
    res.status(400).json({ success: false, error: 'Field "role" must be captain or member' });
    return;
  }
  try {
    const applied = await teamMembers.setRole(teamId, accountUid, role);
    res.json({ success: true, applied });
  } catch (err) {
    log.error('Error in POST /api/test/team-members', err as Error);
    res.status(500).json({ success: false, error: 'Failed to set the role' });
  }
});

router.get('/phase-d-schema', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;

  try {
    const columns = await db.queryAsync<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ANY(?::text[])
        ORDER BY table_name, ordinal_position`,
      [[...PHASE_D_TABLES]]
    );
    const indexes = await db.queryAsync<{ tablename: string; indexname: string; indexdef: string }>(
      `SELECT tablename, indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename = ANY(?::text[])
        ORDER BY tablename, indexname`,
      [[...PHASE_D_TABLES]]
    );
    const foreignKeys = await db.queryAsync<{ table_name: string; conname: string; def: string }>(
      `SELECT cl.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
        WHERE c.contype = 'f' AND cl.relname = ANY(?::text[])
        ORDER BY cl.relname, c.conname`,
      [[...PHASE_D_TABLES]]
    );

    const tables: Record<string, unknown> = {};
    for (const table of PHASE_D_TABLES) {
      tables[table] = {
        columns: columns
          .filter((c) => c.table_name === table)
          .map((c) => ({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable === 'YES',
            default: c.column_default,
          })),
        indexes: indexes
          .filter((i) => i.tablename === table)
          .map((i) => ({ name: i.indexname, definition: i.indexdef })),
        foreignKeys: foreignKeys
          .filter((f) => f.table_name === table)
          .map((f) => ({ name: f.conname, definition: f.def })),
      };
    }
    res.json({ success: true, tables });
  } catch (err) {
    log.error('Error in GET /api/test/phase-d-schema', err as Error);
    res.status(500).json({ success: false, error: 'Failed to read the schema' });
  }
});

router.get('/match-reports', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;

  const { matchSlug } = req.query;
  if (typeof matchSlug !== 'string' || matchSlug === '') {
    res.status(400).json({ success: false, error: 'Query parameter "matchSlug" is required' });
    return;
  }
  try {
    const rows = await db.queryAsync<{
      id: number;
      revision: number;
      status: string;
      source: string;
      result: string;
    }>(
      `SELECT id, revision, status, source, result
         FROM match_reports
        WHERE match_slug = ?
        ORDER BY revision`,
      [matchSlug]
    );
    res.json({
      success: true,
      reports: rows.map((r) => ({
        id: r.id,
        revision: r.revision,
        status: r.status,
        source: r.source,
        result: r.result,
      })),
    });
  } catch (err) {
    log.error('Error in GET /api/test/match-reports', err as Error);
    res.status(500).json({ success: false, error: 'Failed to read match reports' });
  }
});

router.post('/match-reports', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;

  const {
    matchSlug,
    revision,
    status,
    source,
    result: reported,
  } = (req.body ?? {}) as {
    matchSlug?: unknown;
    revision?: unknown;
    status?: unknown;
    source?: unknown;
    result?: unknown;
  };
  if (typeof matchSlug !== 'string' || matchSlug === '') {
    res.status(400).json({ success: false, error: 'Field "matchSlug" is required' });
    return;
  }
  try {
    const row = await db.queryOneAsync<{ id: number }>(
      `INSERT INTO match_reports (match_slug, revision, status, source, result)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
      [
        matchSlug,
        typeof revision === 'number' ? revision : 1,
        typeof status === 'string' ? status : 'submitted',
        typeof source === 'string' ? source : 'report',
        JSON.stringify(reported ?? {}),
      ]
    );
    res.status(201).json({ success: true, id: row?.id });
  } catch (err) {
    const error = err as Error & { code?: string };
    // 23505 unique violation, 23503 foreign key violation: what the spec is
    // checking for, not a server fault.
    if (error.code === '23505' || error.code === '23503') {
      res.status(409).json({ success: false, error: error.message, code: error.code });
      return;
    }
    log.error('Error in POST /api/test/match-reports', error);
    res.status(500).json({ success: false, error: 'Failed to insert the match report' });
  }
});

export default router;
