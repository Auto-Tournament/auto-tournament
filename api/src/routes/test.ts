import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { integrationForMatch, listIntegrations } from '../integrations/registry';
import type { ModuleMigration, ResultMeta, SeriesResult } from '../integrations/types';
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
import { setPackIndexBaseOverride } from '../services/packIndexService';
import { forgetBundledPacks, seedBundledPacks } from '../services/gamePackService';
import { setWikidataEndpointOverride, resetWikidataThrottle } from '../services/wikidataService';
import { clearGameSearchCache } from '../services/gameCatalogService';
import { gameSearchLimiter } from './games';
import {
  backfillLinkedAccounts,
  backfillTeamMembers,
  runSchemaMigrations,
} from '../config/schemaMigrations';
import {
  getModuleMigrationState,
  migrationChecksum,
  moduleNamespace,
  runModuleMigrations,
} from '../config/moduleMigrations';
import {
  CS2_MODULE_ID,
  LEGACY_CS2_TABLES,
  handOverCs2Tables,
} from '../config/cs2TableHandover';
import { playerIdentity } from '../services/playerIdentity';
import { teamMembers } from '../services/teamMembers';
import { forgetModuleEnabled, listModules, modulesDir, scanDiskModules } from '../modules/loader';
import { isValidModuleId } from '../modules/manifest';
import fs from 'fs';
import path from 'path';

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
router.post('/reset-database', requireAuth, async (_req: Request, res: Response): Promise<void> => {
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
    // Same as /api/tournament/wipe-database: the packs the image ships come
    // back, and the catalogue's cache stops describing a table that is gone.
    await seedBundledPacks();
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
 * Test-only helper: apply an Auto Tournament CS2 match report as if it arrived from a server.
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

/*
 * Test-only: a fixture module's migrations against the real database, so a
 * spec can prove `runModuleMigrations` (config/moduleMigrations.ts) applies in
 * order, records, refuses edits and core tables, and rolls back only the
 * migration that failed. The fixtures live here, not in the request: the
 * route never runs SQL a caller sends.
 */

const FIXTURE_MODULE_ID = 'migration-fixture';

const FIXTURE_BASE: ModuleMigration[] = [
  {
    id: '001-items',
    // No IF NOT EXISTS: running it a second time would fail, so a second run
    // that applies nothing proves it was not re-run.
    up: 'CREATE TABLE migration_fixture_items (id SERIAL PRIMARY KEY, label TEXT NOT NULL);',
  },
  {
    id: '002-items-label',
    // Needs 001's table: proves the order.
    up: `CREATE INDEX migration_fixture_items_label ON migration_fixture_items (label);
         INSERT INTO migration_fixture_items (label) VALUES ('first');`,
  },
];
const FIXTURE_NOTE: ModuleMigration = {
  id: '003-items-note',
  up: 'ALTER TABLE migration_fixture_items ADD COLUMN note TEXT;',
};

const MIGRATION_FIXTURES: Record<string, ModuleMigration[]> = {
  v1: FIXTURE_BASE,
  v2: [...FIXTURE_BASE, FIXTURE_NOTE],
  // 001 as shipped, then edited: must be refused, and 003 not applied.
  edited: [
    { id: '001-items', up: 'CREATE TABLE migration_fixture_items (id SERIAL PRIMARY KEY, label TEXT);' },
    FIXTURE_BASE[1],
    FIXTURE_NOTE,
  ],
  // 004 creates a table and then fails: only 004 rolls back, 005 never runs.
  failing: [
    ...FIXTURE_BASE,
    FIXTURE_NOTE,
    {
      id: '004-broken',
      up: `CREATE TABLE migration_fixture_partial (id INTEGER);
           INSERT INTO migration_fixture_items (missing_column) VALUES (1);`,
    },
    { id: '005-after', up: 'CREATE TABLE migration_fixture_after (id INTEGER);' },
  ],
  // Its own table first, then a core one: refused before either runs.
  core: [
    {
      id: '001-touch-core',
      up: `CREATE TABLE migration_fixture_sneaky (id INTEGER);
           ALTER TABLE matches ADD COLUMN migration_fixture_flag TEXT;`,
    },
  ],
};

router.get('/module-migrations', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;
  const moduleId = typeof req.query.moduleId === 'string' ? req.query.moduleId : FIXTURE_MODULE_ID;
  try {
    const rows = await db.queryAsync<{ migration_id: string; checksum: string }>(
      'SELECT migration_id, checksum FROM module_migrations WHERE module_id = ? ORDER BY migration_id',
      [moduleId]
    );
    const tables = await db.queryAsync<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name LIKE ?
        ORDER BY table_name`,
      [`${moduleNamespace(moduleId).replace(/_/g, '\\_')}%`]
    );
    const coreColumns = await db.queryAsync<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'matches'
          AND column_name LIKE 'migration\\_fixture\\_%'`
    );
    res.json({
      success: true,
      applied: rows.map((r) => ({ id: r.migration_id, checksum: r.checksum })),
      tables: tables.map((t) => t.table_name),
      coreColumns: coreColumns.map((c) => c.column_name),
      state: getModuleMigrationState(moduleId) ?? null,
    });
  } catch (err) {
    log.error('Error in GET /api/test/module-migrations', err as Error);
    res.status(500).json({ success: false, error: 'Failed to read module migrations' });
  }
});

router.post(
  '/module-migrations/run',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;
    const { fixture } = (req.body ?? {}) as { fixture?: unknown };
    const migrations =
      typeof fixture === 'string' && Object.prototype.hasOwnProperty.call(MIGRATION_FIXTURES, fixture)
        ? MIGRATION_FIXTURES[fixture]
        : null;
    if (!migrations) {
      res.status(400).json({
        success: false,
        error: `Field "fixture" must be one of ${Object.keys(MIGRATION_FIXTURES).join(', ')}`,
      });
      return;
    }
    // Never throws; a refusal or failure is the result, not a 500.
    const result = await runModuleMigrations({ id: FIXTURE_MODULE_ID, migrations });
    res.json({ success: true, result });
  }
);

router.post(
  '/module-migrations/reset',
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;
    try {
      await db.execAsync(
        `DROP TABLE IF EXISTS migration_fixture_items, migration_fixture_partial,
           migration_fixture_after, migration_fixture_sneaky`
      );
      await db.runAsync('DELETE FROM module_migrations WHERE module_id = ?', [FIXTURE_MODULE_ID]);
      res.json({ success: true });
    } catch (err) {
      log.error('Error in POST /api/test/module-migrations/reset', err as Error);
      res.status(500).json({ success: false, error: 'Failed to reset the fixture module' });
    }
  }
);

/*
 * Test-only: CS2's tables (DESIGN-modules §6 item 10). CS2 owns cs2_servers,
 * cs2_maps and cs2_map_pools, created by its own migration on a fresh
 * database and renamed from the 2.x servers, maps and map_pools on an
 * upgraded one (config/cs2TableHandover.ts).
 *
 *   GET  /api/test/cs2-tables                   which tables exist, CS2's ledger
 *                                               and state, and the schema of the
 *                                               three tables and every key onto them
 *   POST /api/test/cs2-tables/handover          run the handover again (a no-op
 *                                               once done)
 *   POST /api/test/cs2-tables/foreign-keys      probe the keys onto them, in a
 *                                               transaction that is rolled back
 *   POST /api/test/cs2-tables/handover-probe    run the handover on a 2.4-shaped
 *        Body: { scenario }                     copy in a scratch schema, twice
 *
 * The upgrade test (scripts/test-upgrade.ts) reads the first two as well.
 */

type SqlClient = Pick<PoolClient, 'query'>;

const CS2_TABLES = LEGACY_CS2_TABLES.map((t) => t.to);
const LEGACY_TABLES = LEGACY_CS2_TABLES.map((t) => t.from);

/**
 * The schema of CS2's tables, in an order that does not depend on how they
 * came to be (columns by name, not position), so a fresh database and an
 * upgraded one compare equal.
 */
async function describeCs2Schema(client: SqlClient) {
  const tables = [...CS2_TABLES];
  const { rows: columns } = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1::text[])
      ORDER BY table_name, column_name`,
    [tables]
  );
  const { rows: indexes } = await client.query<{ tablename: string; indexname: string; indexdef: string }>(
    `SELECT tablename, indexname, replace(indexdef, current_schema() || '.', '') AS indexdef
       FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = ANY($1::text[])
      ORDER BY tablename, indexname`,
    [tables]
  );
  const { rows: constraints } = await client.query<{ table_name: string; conname: string; def: string }>(
    `SELECT cl.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = current_schema() AND cl.relname = ANY($1::text[])
      ORDER BY cl.relname, c.conname`,
    [tables]
  );
  const { rows: sequences } = await client.query<{ table_name: string; seqname: string }>(
    `SELECT c.relname AS table_name, s.relname AS seqname
       FROM pg_depend d
       JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
       JOIN pg_class c ON c.oid = d.refobjid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
        AND n.nspname = current_schema() AND c.relname = ANY($1::text[])
      ORDER BY c.relname, s.relname`,
    [tables]
  );
  const { rows: foreignKeys } = await client.query<{ table_name: string; conname: string; def: string }>(
    `SELECT cl.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_class ref ON ref.oid = c.confrelid
       JOIN pg_namespace n ON n.oid = ref.relnamespace
      WHERE c.contype = 'f' AND n.nspname = current_schema() AND ref.relname = ANY($1::text[])
      ORDER BY cl.relname, c.conname`,
    [tables]
  );

  const schema: Record<string, unknown> = {};
  for (const table of tables) {
    schema[table] = {
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
      constraints: constraints
        .filter((c) => c.table_name === table)
        .map((c) => ({ name: c.conname, definition: c.def })),
      sequences: sequences.filter((s) => s.table_name === table).map((s) => s.seqname),
    };
  }
  return {
    tables: schema,
    foreignKeys: foreignKeys.map((f) => ({ table: f.table_name, name: f.conname, definition: f.def })),
  };
}

async function existingTables(client: SqlClient, names: string[]): Promise<Record<string, boolean>> {
  const { rows } = await client.query<{ relname: string }>(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') AND c.relname = ANY($1::text[])`,
    [names]
  );
  const present = new Set(rows.map((r) => r.relname));
  return Object.fromEntries(names.map((name) => [name, present.has(name)]));
}

async function cs2Ledger(client: SqlClient) {
  const { rows } = await client.query<{ migration_id: string; checksum: string }>(
    `SELECT migration_id, checksum FROM module_migrations WHERE module_id = $1 ORDER BY migration_id`,
    [CS2_MODULE_ID]
  );
  return rows.map((r) => ({ id: r.migration_id, checksum: r.checksum }));
}

function cs2Module() {
  return listIntegrations().find((integration) => integration.id === CS2_MODULE_ID);
}

router.get('/cs2-tables', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  if (isTestHelperDisabled(res)) return;
  try {
    const body = await db.withClient(async (client) => {
      const tables = await existingTables(client, CS2_TABLES);
      const counts: Record<string, number> = {};
      for (const table of CS2_TABLES) {
        if (!tables[table]) continue;
        const { rows } = await client.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${table}`);
        counts[table] = Number(rows[0]?.n ?? 0);
      }
      const mapPoolNames = tables.cs2_map_pools
        ? (await client.query<{ name: string }>('SELECT name FROM cs2_map_pools ORDER BY name')).rows.map(
            (r) => r.name
          )
        : [];
      const first = cs2Module()?.migrations?.[0];
      return {
        tables,
        legacyTables: await existingTables(client, LEGACY_TABLES),
        counts,
        mapPoolNames,
        ledger: await cs2Ledger(client),
        firstMigration: first ? { id: first.id, checksum: migrationChecksum(first.up) } : null,
        declared: (cs2Module()?.migrations ?? []).map((m) => ({
          id: m.id,
          checksum: migrationChecksum(m.up),
        })),
        state: getModuleMigrationState(CS2_MODULE_ID) ?? null,
        schema: await describeCs2Schema(client),
      };
    });
    res.json({ success: true, ...body });
  } catch (err) {
    log.error('Error in GET /api/test/cs2-tables', err as Error);
    res.status(500).json({ success: false, error: 'Failed to read the CS2 tables' });
  }
});

router.post(
  '/cs2-tables/handover',
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;
    try {
      const report = await db.withClient((client) => handOverCs2Tables(client, cs2Module()));
      res.json({ success: true, report });
    } catch (err) {
      log.error('Error in POST /api/test/cs2-tables/handover', err as Error);
      res.status(500).json({ success: false, error: 'Failed to run the handover' });
    }
  }
);

interface ForeignKeyProbe {
  code: string | null;
  constraint: string | null;
}

/** Run `sql` under a savepoint and report the error it raised, if any. */
async function probe(client: SqlClient, sql: string, params: unknown[]): Promise<ForeignKeyProbe> {
  await client.query('SAVEPOINT fk_probe');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT fk_probe');
    return { code: null, constraint: null };
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT fk_probe');
    const e = err as { code?: string; constraint?: string };
    return { code: e.code ?? null, constraint: e.constraint ?? null };
  }
}

router.post(
  '/cs2-tables/foreign-keys',
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;
    try {
      const result = await db.withClient(async (client) => {
        await client.query('BEGIN');
        try {
          const { rows: maxPool } = await client.query<{ id: number }>(
            'SELECT COALESCE(MAX(id), 0) + 1000 AS id FROM cs2_map_pools'
          );
          const missingPoolId = maxPool[0].id;

          // A template pointing at a pool that does not exist.
          const templateMissingPool = await probe(
            client,
            `INSERT INTO tournament_templates (name, type, format, settings, map_pool_id)
             VALUES ('fk-probe', 'single_elimination', 'bo1', '{}', $1)`,
            [missingPoolId]
          );
          const manualTemplateMissingPool = await probe(
            client,
            `INSERT INTO manual_match_templates (name, best_of, starting_side, knife_mode, map_pool_id)
             VALUES ('fk-probe', 'bo1', 'knife', 'default', $1)`,
            [missingPoolId]
          );
          // A match on a server that does not exist.
          const matchMissingServer = await probe(
            client,
            `INSERT INTO matches (slug, tournament_id, round, match_number, config, server_id)
             VALUES ('fk-probe-match', NULL, 0, 0, '{}', 'fk-probe-no-such-server')`,
            []
          );

          // ON DELETE SET NULL: deleting a pool clears the template's reference.
          const { rows: pool } = await client.query<{ id: number }>(
            `INSERT INTO cs2_map_pools (name, map_ids) VALUES ('fk-probe-pool', '[]') RETURNING id`
          );
          const { rows: template } = await client.query<{ id: number }>(
            `INSERT INTO tournament_templates (name, type, format, settings, map_pool_id)
             VALUES ('fk-probe', 'single_elimination', 'bo1', '{}', $1) RETURNING id`,
            [pool[0].id]
          );
          await client.query('DELETE FROM cs2_map_pools WHERE id = $1', [pool[0].id]);
          const { rows: after } = await client.query<{ map_pool_id: number | null }>(
            'SELECT map_pool_id FROM tournament_templates WHERE id = $1',
            [template[0].id]
          );
          return {
            templateMissingPool,
            manualTemplateMissingPool,
            matchMissingServer,
            templatePoolAfterPoolDeleted: after[0]?.map_pool_id ?? null,
          };
        } finally {
          await client.query('ROLLBACK');
        }
      });
      res.json({ success: true, ...result });
    } catch (err) {
      log.error('Error in POST /api/test/cs2-tables/foreign-keys', err as Error);
      res.status(500).json({ success: false, error: 'Failed to probe the foreign keys' });
    }
  }
);

/** The scratch schema the handover probe builds a 2.4-shaped database in. */
const HANDOVER_PROBE_SCHEMA = 'test_cs2_handover_probe';

/**
 * CS2's three tables as 2.4.15 created them (config/database.schema.ts at
 * v2.4.15), plus the two core tables with keys onto them, trimmed to the key
 * columns.
 */
const LEGACY_CS2_DDL = `
  CREATE TABLE servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    password TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    matchzy_config TEXT,
    persistent_config_sent INTEGER,
    plugin_version TEXT,
    hostname TEXT,
    last_seen INTEGER,
    status TEXT DEFAULT 'unknown',
    cs2_required_version INTEGER,
    cs2_update_phase TEXT,
    cs2_update_required_at INTEGER,
    cs2_update_checked_at INTEGER,
    cs2_build_id INTEGER,
    cs2_version_string TEXT,
    cs2_version_fetched_at INTEGER,
    matchzy_db_ok INTEGER,
    matchzy_db_type TEXT,
    matchzy_db_error TEXT,
    matchzy_db_last_ok_at INTEGER,
    matchzy_db_last_seen_at INTEGER,
    server_can_reach_api_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
    updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
  );
  CREATE INDEX idx_servers_status ON servers(status);
  CREATE INDEX idx_servers_last_seen ON servers(last_seen);
  CREATE INDEX idx_servers_enabled ON servers(enabled);
  CREATE TABLE maps (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    image_url TEXT,
    created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
    updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
  );
  CREATE INDEX idx_maps_id ON maps(id);
  CREATE TABLE map_pools (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    map_ids TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
    updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
  );
  CREATE INDEX idx_map_pools_name ON map_pools(name);
  CREATE INDEX idx_map_pools_default ON map_pools(is_default);
  CREATE INDEX idx_map_pools_enabled ON map_pools(enabled);
  CREATE TABLE matches (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    server_id TEXT,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL
  );
  CREATE TABLE tournament_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    map_pool_id INTEGER,
    FOREIGN KEY (map_pool_id) REFERENCES map_pools(id) ON DELETE SET NULL
  );
  CREATE TABLE module_migrations (
    module_id TEXT NOT NULL,
    migration_id TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
    PRIMARY KEY (module_id, migration_id)
  );
  INSERT INTO servers (id, name, host, port, password) VALUES
    ('probe-1', 'Probe One', '10.0.0.1', 27015, 'secret-1'),
    ('probe-2', 'Probe Two', '10.0.0.2', 27016, 'secret-2');
  INSERT INTO maps (id, display_name) VALUES ('de_dust2', 'Dust II'), ('de_mirage', 'Mirage');
  INSERT INTO map_pools (name, map_ids) VALUES
    ('Probe Pool A', '["de_dust2"]'),
    ('Probe Pool B', '["de_dust2","de_mirage"]');
  INSERT INTO matches (slug, server_id) VALUES ('probe-match', 'probe-2');
  INSERT INTO tournament_templates (name, map_pool_id)
    SELECT 'Probe Template', id FROM map_pools WHERE name = 'Probe Pool B';
`;

/**
 * What to do to the 2.4-shaped copy before the handover runs:
 * - `legacy`: nothing, a 2.4.15 database as it is.
 * - `old-install`: an older install, missing a column and an index 2.4.15 has.
 * - `renamed-by-hand`: `servers` already renamed (dependents and ledger not),
 *   as if someone had started the job by hand.
 * - `both`: a `cs2_maps` exists beside `maps`: must be refused, not merged.
 */
const HANDOVER_PROBE_SCENARIOS: Record<string, string> = {
  legacy: '',
  'old-install': `ALTER TABLE servers DROP COLUMN server_can_reach_api_at;
                  DROP INDEX idx_servers_enabled;`,
  'renamed-by-hand': 'ALTER TABLE servers RENAME TO cs2_servers;',
  both: `CREATE TABLE cs2_maps (id TEXT PRIMARY KEY, display_name TEXT NOT NULL);`,
};

router.post(
  '/cs2-tables/handover-probe',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (isTestHelperDisabled(res)) return;
    const { scenario } = (req.body ?? {}) as { scenario?: unknown };
    if (typeof scenario !== 'string' || !Object.prototype.hasOwnProperty.call(HANDOVER_PROBE_SCENARIOS, scenario)) {
      res.status(400).json({
        success: false,
        error: `Field "scenario" must be one of ${Object.keys(HANDOVER_PROBE_SCENARIOS).join(', ')}`,
      });
      return;
    }
    try {
      const result = await db.withClient(async (client) => {
        const { rows } = await client.query<{ search_path: string }>('SHOW search_path');
        const searchPath = rows[0].search_path;
        try {
          await client.query(`DROP SCHEMA IF EXISTS ${HANDOVER_PROBE_SCHEMA} CASCADE`);
          await client.query(`CREATE SCHEMA ${HANDOVER_PROBE_SCHEMA}`);
          await client.query(`SET search_path TO ${HANDOVER_PROBE_SCHEMA}`);
          await client.query(LEGACY_CS2_DDL);
          if (HANDOVER_PROBE_SCENARIOS[scenario]) {
            await client.query(HANDOVER_PROBE_SCENARIOS[scenario]);
          }

          const first = await handOverCs2Tables(client, cs2Module());
          const second = await handOverCs2Tables(client, cs2Module());

          const all = [...CS2_TABLES, ...LEGACY_TABLES];
          const tables = await existingTables(client, all);
          const rowsOf = async (sql: string) => (await client.query(sql)).rows;
          const data = {
            servers: tables.cs2_servers
              ? await rowsOf('SELECT id, name, host, port, password FROM cs2_servers ORDER BY id')
              : null,
            maps: tables.cs2_maps ? await rowsOf('SELECT id FROM cs2_maps ORDER BY id') : null,
            legacyMaps: tables.maps ? await rowsOf('SELECT id FROM maps ORDER BY id') : null,
            mapPools: tables.cs2_map_pools
              ? await rowsOf('SELECT id, name, map_ids FROM cs2_map_pools ORDER BY id')
              : null,
            match: await rowsOf('SELECT slug, server_id FROM matches'),
            template: await rowsOf(
              `SELECT t.name, p.name AS pool
                 FROM tournament_templates t
                 LEFT JOIN cs2_map_pools p ON p.id = t.map_pool_id`
            ),
          };
          const ledger = await cs2Ledger(client);
          // Then CS2's later migrations, as its runner does on boot, so the
          // schema compares with a fresh database's.
          for (const migration of cs2Module()?.migrations?.slice(1) ?? []) {
            await client.query(migration.up);
          }
          const schema = await describeCs2Schema(client);

          await client.query('BEGIN');
          // The renamed sequence still hands out ids after the old ones.
          const nextPoolId = tables.cs2_map_pools
            ? (
                await client.query<{ id: number }>(
                  `INSERT INTO cs2_map_pools (name, map_ids) VALUES ('Probe Pool C', '[]') RETURNING id`
                )
              ).rows[0].id
            : null;
          // The template's key still points at the renamed pools table.
          const templateMissingPool = await probe(
            client,
            `INSERT INTO tournament_templates (name, map_pool_id) VALUES ('Probe Missing', 999999)`,
            []
          );
          await client.query('ROLLBACK');

          return {
            first,
            second,
            tables,
            ledger,
            schema,
            data,
            nextPoolId,
            templateMissingPool,
          };
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          await client.query(`SET search_path TO ${searchPath}`);
          await client.query(`DROP SCHEMA IF EXISTS ${HANDOVER_PROBE_SCHEMA} CASCADE`);
        }
      });
      res.json({ success: true, ...result });
    } catch (err) {
      log.error('Error in POST /api/test/cs2-tables/handover-probe', err as Error);
      res.status(500).json({ success: false, error: (err as Error).message });
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

/**
 * Test-only fake pack index, the same trick the fake IGDB uses.
 *
 *   POST /api/test/pack-index   { fake: true | false }  point the pack index
 *                                                       at the fixture below
 *   GET  /api/test/fake-pack-index/index.json
 *   GET  /api/test/fake-pack-index/packs/:slug.json
 *
 * The fixture holds one importable game and one entry pointing outside the
 * index, which must never be fetched.
 */
const FAKE_INDEX_TILE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
  '<rect width="16" height="16" fill="var(--at-ember, #ff6a3d)"/>' +
  '<path d="M4 4h8v8H4z" fill="var(--at-ink-900, #121213)"/></svg>';

const FAKE_INDEX_PACKS: Record<string, unknown> = {
  'index-test-game': {
    schema: 1,
    slug: 'index-test-game',
    name: 'Index Test Game',
    engine: 'manual-report',
    version: '2.0.0',
    description: 'A game that exists only in the fake index.',
    // A path to the file below, the way a real pack names its art.
    icon: '../icons/index-test-game.svg',
  },
};

/**
 * Test-only: run bundled-pack seeding again without restarting the process,
 * so a spec can prove what a restart would do — above all that a bundled game
 * an admin removed stays removed.
 */
router.post('/packs/reseed', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fakeIgdbEnabled(res)) return;
  // `{ forget: [slug] }` first forgets those were ever seeded, so a spec can
  // put a bundled game it removed back exactly as a fresh install has it.
  const { forget } = (req.body ?? {}) as { forget?: unknown };
  if (Array.isArray(forget)) {
    await forgetBundledPacks(forget.filter((slug): slug is string => typeof slug === 'string'));
  }
  res.json({ success: true, report: await seedBundledPacks() });
});

router.post('/pack-index', requireAuth, (req: Request, res: Response): void => {
  if (!fakeIgdbEnabled(res)) return;
  const { fake } = (req.body ?? {}) as { fake?: unknown };
  const self = `http://127.0.0.1:${process.env.PORT || '3000'}/api/test/fake-pack-index/`;
  setPackIndexBaseOverride(fake === false ? null : self);
  res.json({ success: true, fake: fake !== false });
});

router.get('/fake-pack-index/index.json', (_req: Request, res: Response): void => {
  if (!fakeIgdbEnabled(res)) return;
  res.json({
    schema: 1,
    packs: [
      {
        slug: 'index-test-game',
        name: 'Index Test Game',
        version: '2.0.0',
        engine: 'manual-report',
        description: 'A game that exists only in the fake index.',
        file: 'packs/index-test-game.json',
        icon: 'icons/index-test-game.svg',
      },
      // Must be dropped rather than fetched: an index is a file anybody can
      // open a pull request against.
      {
        slug: 'elsewhere',
        name: 'Somewhere Else',
        version: '1.0.0',
        engine: 'manual-report',
        file: 'https://example.com/evil.json',
      },
    ],
  });
});

router.get('/fake-pack-index/packs/:file', (req: Request, res: Response): void => {
  if (!fakeIgdbEnabled(res)) return;
  const slug = req.params.file.replace(/\.json$/, '');
  const pack = FAKE_INDEX_PACKS[slug];
  if (!pack) {
    res.status(404).json({ success: false, error: 'No such pack' });
    return;
  }
  res.json(pack);
});

router.get('/fake-pack-index/icons/:file', (req: Request, res: Response): void => {
  if (!fakeIgdbEnabled(res)) return;
  if (req.params.file !== 'index-test-game.svg') {
    res.status(404).json({ success: false, error: 'No such icon' });
    return;
  }
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.send(FAKE_INDEX_TILE);
});

/**
 * Test-only code-module fixtures.
 *
 * Code modules are installed by putting a folder in `DATA_DIR/modules/` and
 * are only scanned at boot (`modules/loader.ts`). The E2E suite runs against
 * the release image, whose `DATA_DIR` the test runner cannot write to and
 * which it cannot restart, so these write a fixture module there and run the
 * scan again, which is what a restart would do for a module not yet loaded.
 *
 *   POST   /api/test/modules/fixture  { id, kind }  write DATA_DIR/modules/<id>/, rescan
 *   POST   /api/test/modules/rescan                 scan again
 *   DELETE /api/test/modules/fixtures               remove every fixture folder
 *
 * The fixtures are fixed here, not sent by the test, and their ids must start
 * with `fixture-`, so even with the helpers on nothing but these few files
 * can be written, and cleaning up cannot touch a real module.
 *
 * Kinds:
 *   valid         a GameIntegration with a client half (index.js, style.css)
 *   incompatible  a valid module built for server API ^0.3.0
 *   throws        a server entry that throws while it is imported
 *   mismatched-id module.json names its id '../<id>'
 *   migrates      a valid module whose one migration creates `<id>_probe`
 *   bad-migration a valid module whose migration reaches into core's `matches`
 *
 * Client-side kinds, each with a server half as valid as `valid`'s:
 *   client-incompatible   declares client API ^0.3.0
 *   client-react19        its client imports `use`, which React 18 does not export
 *   client-render-throws  its client's route throws while it renders
 *
 * Every kind's client/index.js is a real client entry (`fixtureClientSource`).
 */
const MODULE_FIXTURE_KINDS = [
  'valid',
  'incompatible',
  'throws',
  'mismatched-id',
  'migrates',
  'bad-migration',
  'client-incompatible',
  'client-react19',
  'client-render-throws',
] as const;
type ModuleFixtureKind = (typeof MODULE_FIXTURE_KINDS)[number];

/** The table prefix a module owns: its id with hyphens as underscores. */
function fixtureTablePrefix(id: string): string {
  return id.replace(/-/g, '_');
}

/** The `migrations` line of a fixture's source, for the kinds that have one. */
function migrationsFor(id: string, kind: ModuleFixtureKind): string {
  const table = `${fixtureTablePrefix(id)}_probe`;
  if (kind === 'migrates') {
    return `
  migrations: [
    { id: '001-probe', up: 'CREATE TABLE ${table} (id SERIAL PRIMARY KEY, note TEXT);' },
  ],`;
  }
  if (kind === 'bad-migration') {
    // Its own table first, then a reach into core's: the namespace check has
    // to refuse the whole list before anything runs, so neither may exist.
    return `
  migrations: [
    { id: '001-probe', up: 'CREATE TABLE ${table} (id SERIAL PRIMARY KEY);' },
    { id: '002-reach', up: 'ALTER TABLE matches ADD COLUMN ${fixtureTablePrefix(id)}_x TEXT;' },
  ],`;
  }
  return '';
}

/**
 * A fixture's `client/index.js`, written the way a module build emits it:
 * plain ESM with no build step, React, MUI, the router and i18next left as
 * bare imports for the host's import map to resolve (never a bundled React),
 * and `createElement` where a build would have compiled JSX.
 *
 * Its default export is a `ClientGameIntegration` with two admin routes,
 * `/<id>` and `/<id>/next`. The page proves it runs on the host's instances:
 * `useState` works (one React), a contained MUI button takes the host theme's
 * primary colour, and it shows the host's current path and language and
 * navigates the host's router.
 */
function fixtureClientSource(id: string, kind: ModuleFixtureKind): string {
  const reactNames =
    kind === 'client-react19'
      ? // React 19's `use`: the host's React 18 shim has no such export, so
        // this module must fail to link inside import(), before it renders.
        'createElement as h, use, useState'
      : 'createElement as h, useState';
  const page =
    kind === 'client-render-throws'
      ? `function FixturePage() {
  throw new Error(${JSON.stringify(`fixture ${id} exploded while rendering`)});
}`
      : `function FixturePage() {
  const [clicks, setClicks] = useState(0);
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  return h(
    Box,
    { 'data-testid': id + '-page', sx: { p: 2 } },
    h(Typography, { 'data-testid': id + '-path' }, location.pathname),
    h(Typography, { 'data-testid': id + '-language' }, i18n.language),
    h(Typography, { 'data-testid': id + '-translated' }, t('modulesPage.code.chip')),
    h(Typography, { 'data-testid': id + '-primary' }, theme.palette.primary.main),
    h(
      Button,
      {
        variant: 'contained',
        color: 'primary',
        'data-testid': id + '-clicks',
        onClick: () => setClicks((n) => n + 1),
      },
      'Clicked ' + clicks
    ),
    h(
      Button,
      { variant: 'outlined', 'data-testid': id + '-navigate', onClick: () => navigate('/' + id + '/next') },
      'Next'
    )
  );
}`;
  return `import { ${reactNames} } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const id = ${JSON.stringify(id)};

${page}

export default {
  id,
  capabilities: { servers: false, veto: false, liveEvents: false, demos: false, playerStats: false },
  matchPanels: {},
  tournamentSetupSteps: {},
  standaloneMatchSteps: {},
  resourceDialogs: {},
  dashboardWidgets: {},
  routes: [
    { path: id, scope: 'admin', element: h(FixturePage) },
    { path: id + '/next', scope: 'admin', element: h(FixturePage) },
  ],
  navItems: [],
};
`;
}

function moduleFixtureFiles(id: string, kind: ModuleFixtureKind): Record<string, string> {
  const manifest = {
    id: kind === 'mismatched-id' ? `../${id}` : id,
    name: `Fixture ${id}`,
    version: '1.0.0',
    serverApi: kind === 'incompatible' ? '^0.3.0' : '^0.1.0',
    clientApi: kind === 'client-incompatible' ? '^0.3.0' : '^0.2.0',
    server: 'server/index.js',
    client: 'client/index.js',
  };
  const integration = `const integration = {
  id: ${JSON.stringify(id)},
  displayName: ${JSON.stringify(`Fixture ${id}`)},
  capabilities: { servers: false, veto: false, liveEvents: false, demos: false, playerStats: false },
  // Kept out of the game catalogue, so loading it changes nothing else.
  catalog: null,${migrationsFor(id, kind)}
  statsSchema: () => ({ metrics: [] }),
  async buildMatchConfig() {
    return {};
  },
  describeMatch: () => ({
    seriesLength: 1,
    maps: [],
    team1: { name: 'Team 1', players: [] },
    team2: { name: 'Team 2', players: [] },
  }),
  async capacity() {
    return null;
  },
  async allocate() {
    return { status: 'failed', error: 'fixture module', retryable: false };
  },
  async restart() {
    return { ok: false, error: 'fixture module' };
  },
};
export default integration;
`;
  return {
    'module.json': JSON.stringify(manifest, null, 2),
    // server/index.js is ESM; Node reads that from the nearest package.json.
    'package.json': JSON.stringify({ type: 'module' }),
    'server/index.js':
      kind === 'throws'
        ? `throw new Error(${JSON.stringify(`fixture ${id} exploded at import`)});\n`
        : integration,
    'client/index.js': fixtureClientSource(id, kind),
    'client/style.css': '.fixture-module { color: inherit; }\n',
  };
}

router.post('/modules/fixture', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fakeIgdbEnabled(res)) return;
  const { id, kind } = (req.body ?? {}) as { id?: unknown; kind?: unknown };
  if (typeof id !== 'string' || !isValidModuleId(id) || !id.startsWith('fixture-')) {
    res.status(400).json({ success: false, error: "id must be a valid module id starting with 'fixture-'" });
    return;
  }
  if (!MODULE_FIXTURE_KINDS.includes(kind as ModuleFixtureKind)) {
    res.status(400).json({ success: false, error: `kind must be one of ${MODULE_FIXTURE_KINDS.join(', ')}` });
    return;
  }
  try {
    const dir = path.join(modulesDir(), id);
    for (const [file, contents] of Object.entries(moduleFixtureFiles(id, kind as ModuleFixtureKind))) {
      await fs.promises.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.promises.writeFile(path.join(dir, file), contents);
    }
    await scanDiskModules();
    res.json({ success: true, modules: await listModules() });
  } catch (err) {
    log.error('Error in POST /api/test/modules/fixture', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/**
 * Test-only: what a fixture module's migrations did, and whether its probe
 * table exists — the proof a loaded code module got its schema and a refused
 * one got none of it.
 */
router.get('/modules/:id/migrations', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fakeIgdbEnabled(res)) return;
  const { id } = req.params;
  if (!isValidModuleId(id) || !id.startsWith('fixture-')) {
    res.status(400).json({ success: false, error: "id must be a valid module id starting with 'fixture-'" });
    return;
  }
  try {
    const table = `${fixtureTablePrefix(id)}_probe`;
    const row = await db.queryOneAsync<{ exists: string | null }>(
      'SELECT to_regclass(?)::text AS exists',
      [`public.${table}`]
    );
    res.json({
      success: true,
      state: getModuleMigrationState(id) ?? null,
      probeTableExists: Boolean(row?.exists),
    });
  } catch (err) {
    log.error('Error in GET /api/test/modules/:id/migrations', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/modules/rescan', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  if (!fakeIgdbEnabled(res)) return;
  try {
    // What boot does next for a module it loaded: start it.
    for (const integration of await scanDiskModules()) {
      await integration.start?.();
    }
    res.json({ success: true, modules: await listModules() });
  } catch (err) {
    log.error('Error in POST /api/test/modules/rescan', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.delete('/modules/fixtures', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  if (!fakeIgdbEnabled(res)) return;
  try {
    const entries = await fs.promises.readdir(modulesDir()).catch(() => [] as string[]);
    const removed: string[] = [];
    for (const name of entries) {
      if (!name.startsWith('fixture-') || !isValidModuleId(name)) continue;
      await fs.promises.rm(path.join(modulesDir(), name), { recursive: true, force: true });
      await forgetModuleEnabled(name);
      removed.push(name);
    }
    res.json({ success: true, removed });
  } catch (err) {
    log.error('Error in DELETE /api/test/modules/fixtures', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
