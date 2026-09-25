// IMPORTANT: Load environment variables FIRST, before any other imports
// This ensures all modules can access env vars during initialization
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Migrate any demos/logs left behind under the pre-fix (wrong) DATA_DIR
// before any other module reads or writes under the real one at import time
// (e.g. the event logger and the demos route both create their directory as
// soon as they're imported below).
import { migrateLegacyDataDir } from './config/migrateLegacyDataDir';
migrateLegacyDataDir();

// Move uploaded map images off the container image and onto the mounted
// volume. Must also run before the map upload route is imported below: that
// module creates MAP_IMAGES_DIR at import time, and /map-images is served
// straight off the directory.
import { migrateLegacyMapImages } from './config/migrateLegacyMapImages';
migrateLegacyMapImages();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import swaggerUi from 'swagger-ui-express';
import { db } from './config/database';
import { seedBundledPacks } from './services/gamePackService';
import { PUBLIC_DIR, MAP_IMAGES_DIR, SWAGGER_UI_DIR } from './config/publicPaths';
import { DATA_DIR } from './config/dataDir';
import { getOpenApiSpec } from './config/swagger';
import { log, logger, LOG_HTTP_REQUESTS, LOG_DB_VERBOSE, LOG_DB_VALUES } from './utils/logger';
import { cleanupOldLogs } from './utils/eventLogger';
import { getIO, initializeSocket } from './services/socketService';
import { registerShutdown } from './utils/restart';
import { routeTable } from './routes/routeTable';
import { listIntegrations } from './integrations/registry';
import { diskModuleRoutes, scanDiskModules } from './modules/loader';
import {
  autoInstallCs2ForExistingData,
  autoUpdateModulesFromSnapshot,
  finishPendingUpdates,
  restoreInterruptedSwaps,
  sweepStaging,
} from './modules/catalogService';
import { installHostBridge } from './modules/hostBridge';
import { environmentTrustedKeys } from './modules/trustedKeys';
import { recoverActiveMatches } from './services/matchRecoveryService';
import {
  enrichBuiltinGames,
  resolveStoredGamesAgainstIgdb,
} from './services/gameEnrichmentService';
import { refreshGameIcons } from './services/gameIconService';
import { scheduler } from './core/scheduler';
import { steamService } from './services/steamService';
import { seedAdminsFromEnv } from './services/adminSeedService';
import { getServiceTokens } from './utils/serviceTokens';
import { allowUnauthenticatedEvents } from './middleware/serverAuth';
import packageJson from '../package.json';
import { redactDiscordIdsInPath } from './utils/discordId';
import { configurePassportAuth, passport } from './config/passport';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { isIP } from 'net';
import { DATABASE_NAME, DatabaseRenameRefused } from './config/databaseRename';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

// Configure Passport strategies
configurePassportAuth();

// Trust first proxy when behind Cloudflare Tunnel, nginx, Caddy, etc.
// Required so X-Forwarded-Proto / Host are respected for cookies and redirects.
app.set('trust proxy', 1);

// Middleware
app.use(cors());
// Increase body size limit to 50MB for image uploads (base64 encoded images can be large)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session + Passport
const sessionSecret = process.env.SESSION_SECRET || 'auto-tournament-dev-session-secret';
const PgSession = connectPgSimple(session);

// Reuse the same connection string logic as the main DatabaseManager so the
// session store talks to the exact same PostgreSQL instance with known‑good
// credentials. This avoids subtle mismatches when DATABASE_URL is unset or
// when individual DB_* env vars are used instead.
const sessionDbConnectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${
    process.env.DB_HOST || '127.0.0.1'
  }:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || DATABASE_NAME}`;

// Determine if we should use secure cookies (HTTPS only)
// Check FRONTEND_BASE_URL to see if we're using HTTPS
const frontendBaseUrl = process.env.FRONTEND_BASE_URL || '';
const useSecureCookies =
  process.env.NODE_ENV === 'production' && frontendBaseUrl.startsWith('https://');

// When behind Cloudflare Tunnel or another reverse proxy, the app often sees an
// internal Host (e.g. from Caddy). Without an explicit domain, the session cookie
// is set for that host, so the browser (which only talks to the public URL) never
// sends it → admin session fails. Use FRONTEND_BASE_URL host as cookie domain.
let sessionCookieDomain: string | undefined;
try {
  if (frontendBaseUrl) {
    const u = new URL(frontendBaseUrl.startsWith('http') ? frontendBaseUrl : `https://${frontendBaseUrl}`);
    const host = u.hostname.toLowerCase();
    // Only set an explicit cookie domain for real DNS names.
    // Setting Domain= on an IP can cause cookies to be dropped or behave unexpectedly.
    if (host && host !== 'localhost' && host !== '127.0.0.1' && isIP(host) === 0) {
      sessionCookieDomain = host;
    }
  }
} catch {
  // Invalid URL, skip domain
}

const sessionCookie: { sameSite: 'lax' | 'strict' | 'none'; secure: boolean; httpOnly: boolean; domain?: string } = {
  sameSite: 'lax',
  secure: useSecureCookies,
  httpOnly: true, // Prevent JavaScript access to cookie (security best practice)
};
if (sessionCookieDomain) {
  sessionCookie.domain = sessionCookieDomain;
}

app.use(
  session({
    // Persist sessions in PostgreSQL so admin logins survive API restarts.
    // Note: Session table is created by our database schema, so we don't need
    // connect-pg-simple to create it (which would require table.sql file).
    store: new PgSession({
      conString: sessionDbConnectionString,
      tableName: 'session',
      createTableIfMissing: false, // Table is created by our schema
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: sessionCookie,
  })
);
app.use(passport.initialize());
app.use(passport.session());

/** Paths the client polls on a timer; see the request logger below. */
const POLLED_ENDPOINTS = new Set(['/api/auth/me']);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    // Allow disabling noisy per-request logs via env:
    //   LOG_HTTP_REQUESTS=false
    if (!LOG_HTTP_REQUESTS) {
      return;
    }

    const duration = Date.now() - start;
    const { method } = req;
    // Discord IDs in lookup URLs are private; log them abbreviated.
    const path = redactDiscordIdsInPath(req.path);
    const { statusCode } = res;

    // Skip logging 304 (Not Modified) responses to reduce noise
    if (statusCode === 304) {
      return;
    }

    // Skip logging 404s for root path (common in dev mode from browser/tools)
    if (statusCode === 404 && path === '/') {
      return;
    }

    // Endpoints the client polls constantly. Successful calls to them say
    // nothing and drown the log, so they only get a debug line; anything that
    // actually failed still logs at warn/error below.
    const isPolledEndpoint = POLLED_ENDPOINTS.has(path);

    // Log with appropriate level based on status code
    if (statusCode >= 500) {
      log.error(`${method} ${path}`, undefined, { statusCode, duration });
    } else if (statusCode >= 400) {
      log.warn(`${method} ${path}`, { statusCode, duration });
    } else if (isPolledEndpoint) {
      log.debug(`[HTTP] ${method} ${path} -> ${statusCode}`, { statusCode, duration });
    } else {
      log.request(method, path, statusCode);
    }
  });

  next();
});

// Swagger Documentation
//
// The static assets first, from the copy the image ships (see
// `SWAGGER_UI_DIR`). `swagger-ui-express` would serve these itself out of
// `node_modules/swagger-ui-dist`, which the release image does not have —
// the backend is a single esbuild bundle. Without this the page loads and
// its stylesheet and script come back as the SPA's index.html, which renders
// as nothing at all.
//
// Running from source the directory is absent, this is a no-op, and
// `swaggerUi.serve` below answers exactly as it always did.
if (fs.existsSync(SWAGGER_UI_DIR)) {
  app.use('/api-docs', express.static(SWAGGER_UI_DIR, { fallthrough: true }));
}

// swagger-ui-express types don't perfectly match Express middleware types
app.use(
  '/api-docs',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...(swaggerUi.serve as any),
  swaggerUi.setup(getOpenApiSpec(), {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Auto Tournament API',
  }) as // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
);

// Swagger JSON
app.get('/api-docs.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(getOpenApiSpec());
});

/**
 * @openapi
 * /:
 *   get:
 *     tags:
 *       - Health
 *     summary: Get API information
 *     description: Returns basic information about the API and available endpoints
 *     responses:
 *       200:
 *         description: API information
 */
app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'Auto Tournament API',
    version: packageJson.version,
    status: 'running',
    documentation: {
      swagger: 'GET /api-docs (Interactive UI)',
      openapi: 'GET /api-docs.json (OpenAPI spec)',
    },
    endpoints: {
      health: 'GET /health',
      servers: {
        list: 'GET /api/servers',
        get: 'GET /api/servers/:id',
        create: 'POST /api/servers',
        createOrUpdate: 'POST /api/servers?upsert=true',
        createBatch: 'POST /api/servers/batch',
        createOrUpdateBatch: 'POST /api/servers/batch?upsert=true',
        update: 'PUT /api/servers/:id',
        patch: 'PATCH /api/servers/:id',
        updateBatch: 'PATCH /api/servers/batch',
        delete: 'DELETE /api/servers/:id',
        enable: 'POST /api/servers/:id/enable',
        disable: 'POST /api/servers/:id/disable',
      },
      teams: {
        list: 'GET /api/teams',
        get: 'GET /api/teams/:id',
        create: 'POST /api/teams',
        createOrUpdate: 'POST /api/teams?upsert=true',
        createBatch: 'POST /api/teams with array',
        update: 'PUT /api/teams/:id',
        updateBatch: 'PATCH /api/teams/batch',
        delete: 'DELETE /api/teams/:id',
      },
      rcon: {
        note: 'All RCON endpoints require Bearer token authentication',
        test: 'GET /api/rcon/test',
        testServer: 'GET /api/rcon/test/:serverId',
        practiceMode: 'POST /api/rcon/practice-mode',
        startMatch: 'POST /api/rcon/start-match',
        changeMap: 'POST /api/rcon/change-map',
        pauseMatch: 'POST /api/rcon/pause-match',
        unpauseMatch: 'POST /api/rcon/unpause-match',
        restartMatch: 'POST /api/rcon/restart-match',
        endWarmup: 'POST /api/rcon/end-warmup',
        reloadAdmins: 'POST /api/rcon/reload-admins',
        say: 'POST /api/rcon/say',
        broadcast: 'POST /api/rcon/broadcast',
      },
      matches: {
        note: 'Match management - webhooks auto-configured on load',
        list: 'GET /api/matches (auth required)',
        get: 'GET /api/matches/:slug (auth required)',
        getConfig: 'GET /api/matches/:slug.json (X-Auto-Tournament-Token or admin auth required - for Auto Tournament CS2)',
        create: 'POST /api/matches (auth required)',
        load: 'POST /api/matches/:slug/load (auth required, webhooks auto-configured)',
        loadNoWebhook: 'POST /api/matches/:slug/load?skipWebhook=true (skip webhook setup)',
        updateStatus: 'PATCH /api/matches/:slug/status (auth required)',
        delete: 'DELETE /api/matches/:slug (auth required)',
      },
      events: {
        note: 'Auto Tournament CS2 event webhooks - receive game events',
        webhook: 'POST /api/events (X-Auto-Tournament-Token required)',
        getEvents: 'GET /api/events/:matchSlug (auth required)',
      },
      settings: {
        list: 'GET /api/settings (auth required)',
        update: 'PUT /api/settings (auth required)',
      },
    },
  });
});

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Health check
 *     description: Check if the API is running
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   example: 2023-11-01T12:00:00.000Z
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    // Seconds this process has been running. A drop means the API restarted,
    // which is the difference between "survived an error" and "crashed and
    // came back" — indistinguishable from the outside otherwise, since the
    // container restarts in a couple of seconds.
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * @openapi
 * /api/health/fleet:
 *   get:
 *     tags:
 *       - Health
 *     summary: Fleet health snapshot
 *     description: Quick operator snapshot of enabled servers and CS2 update status.
 *     responses:
 *       200:
 *         description: Fleet snapshot
 */
app.get('/api/health/fleet', async (_req: Request, res: Response) => {
  // Each game integration adds its own block (CS2: `cs2Fleet` and `servers`).
  const contributions: Record<string, unknown> = {};
  for (const integration of listIntegrations()) {
    if (integration.healthContributions) {
      Object.assign(contributions, await integration.healthContributions());
    }
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...contributions,
  });
});

// API Routes.
//
// The mount table lives in routes/routeTable.ts so that the reference
// generator can read it without starting a server. Order is significant —
// see the note there.
for (const { prefix, router } of routeTable) {
  app.use(prefix, router);
}

// Legacy routes of code modules loaded from DATA_DIR/modules. They are added
// to this router when the modules load, after the database is up, so it has to
// be in place before the SPA and the 404 handler below.
app.use(diskModuleRoutes);

// Serve frontend at /app (built client lives under api/public)
app.use('/app', express.static(PUBLIC_DIR));

// Serve map images statically. MAP_IMAGES_DIR comes from config/publicPaths,
// the single place both this static setup and the upload route
// (integrations/cs2/maps/routes.ts) resolve it from -- see that module for
// why, and for why it lives under DATA_DIR (the mounted volume) rather than
// under PUBLIC_DIR (build output, wiped by every update).
app.use('/map-images', express.static(MAP_IMAGES_DIR));
app.get('/app/*', (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist',
  });
});

// Start server
// Initialize Socket.io
initializeSocket(httpServer);

// Cleanup old event logs (keep last 30 days)
cleanupOldLogs(30);

// A rejected promise with no catch is fatal in Node by default, so a single
// stray background task can take the whole tournament server down mid-match.
// This was not hypothetical: a background settings read rejected with
// `relation "app_settings" does not exist` and killed the process, after
// which Caddy served 502 for every request.
//
// A rejection is not evidence that the process state is corrupt, so log it
// loudly and keep serving.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.error(`[FATAL-GUARD] Unhandled promise rejection: ${err.message}`);
  if (err.stack) log.error(err.stack);
});

// An uncaught exception is different: it unwound the stack somewhere
// arbitrary, so continuing risks acting on corrupt state. Log it and let the
// container restart us.
process.on('uncaughtException', (err) => {
  log.error(`[FATAL] Uncaught exception, shutting down: ${err.message}`);
  if (err.stack) log.error(err.stack);
  process.exit(1);
});

// Initialize database and start server
(async () => {
  try {
    // Initialize database first (including schema)
    await db.init();
    log.success('Database initialized successfully');

    // Code modules an operator put in DATA_DIR/modules: each enabled,
    // compatible one is loaded and registered next to the built-ins. After the
    // database, which holds which ones are enabled; before the packs and the
    // integrations' start(), which read the registry. Never throws: a broken
    // module is recorded as broken, and the platform boots without it.
    // Catalog installs the last run did not finish are swept first; updates
    // that waited for this restart are kept if they loaded and rolled back
    // if they did not (DESIGN-modules §10.7).
    await sweepStaging();
    await restoreInterruptedSwaps();
    // Extra signing keys from the environment trust code the platform does
    // not vouch for. Said at every boot, by id, so it is never a surprise.
    const envKeys = environmentTrustedKeys();
    if (envKeys.keys.length > 0) {
      log.warn(
        `[MODULES] MODULE_TRUSTED_KEYS: code modules signed by ${envKeys.keys.length} key(s) this platform does not ship are trusted too: ` +
          envKeys.keys.map((key) => key.keyId).join(', ')
      );
    }
    if (envKeys.malformed > 0) {
      log.warn(`[MODULES] MODULE_TRUSTED_KEYS: ${envKeys.malformed} entry(ies) are not base64 Ed25519 public keys and were ignored`);
    }
    // Code modules' server halves reach core through this (hostBridge.ts).
    installHostBridge();
    // An install with CS2 data (a 2.x upgrade) gets CS2 from the image's
    // offline snapshot before the scan loads it, so its tournaments keep
    // working now that CS2 is a catalog module. Logged; never throws.
    await autoInstallCs2ForExistingData();
    // A newer image carries newer module releases: modules installed from
    // the snapshot or the catalog move to the snapshot's newest one within
    // their major version, before the scan loads them. Logged; never throws.
    // MODULE_AUTO_UPDATE=false turns it off.
    await autoUpdateModulesFromSnapshot();
    await scanDiskModules();
    await finishPendingUpdates();

    // The games this instance can run: packs the image ships are kept up to
    // date where installed (none is installed on its own; PREINSTALL_PACKS
    // can ask for some), then everything in game_packs is loaded into the
    // cache the catalogue reads. The catalogue call is synchronous, so the
    // packs cannot come from a query at that point. See seedBundledPacks.
    await seedBundledPacks();

    // Now start the server after database is ready
    // Bind to all interfaces (IPv4 & IPv6) so both 127.0.0.1 and ::1 work with dev proxies.
    const server = httpServer.listen(Number(PORT), () => {
      log.server('='.repeat(60));
      log.server('Auto Tournament API');
      log.server('='.repeat(60));
      log.server(`Server running on port ${PORT}`);
      log.server(`Listening on: all interfaces (IPv4 & IPv6)`);
      log.server(`Environment: ${process.env.NODE_ENV || 'development'}`);
      log.server(
        `Logging: LOG_LEVEL=${process.env.LOG_LEVEL || 'info'} (Pino actual: ${logger.level}) | ` +
          `DB verbose=${LOG_DB_VERBOSE} | DB values=${LOG_DB_VALUES} | ` +
          `HTTP requests=${LOG_HTTP_REQUESTS}`
      );

      // Vite-style URL summary (Local + Network)
      const protocol = 'http';
      log.server('');
      log.server('Available endpoints:');
      log.server(`  Local API:   ${protocol}://localhost:${PORT}/`);

      const interfaces = os.networkInterfaces();
      const printed = new Set<string>();
      Object.values(interfaces).forEach((addresses) => {
        (addresses || [])
          .filter((addr) => addr.family === 'IPv4' && !addr.internal)
          .forEach((addr) => {
            if (printed.has(addr.address)) return;
            printed.add(addr.address);
            log.server(`  Network API: ${protocol}://${addr.address}:${PORT}/`);
          });
      });

      log.server('');
      log.server(`  App (static client):   ${protocol}://localhost:${PORT}/app/`);
      printed.forEach((ip) => {
        log.server(`  App (network):        ${protocol}://${ip}:${PORT}/app/`);
      });

      log.server('');
      log.server(`  API Docs:   ${protocol}://localhost:${PORT}/api-docs`);
      log.server(`  Health:     ${protocol}://localhost:${PORT}/health`);
      log.server('');
      log.server(`WebSocket: Enabled`);
      log.server(`Event logs: ${path.join(DATA_DIR, 'logs', 'events')} (30 day retention)`);
      log.server('='.repeat(60));

      reportServiceTokens();
      reportEventAuth();

      // Recover matches and start the game integrations (CS2: bootstrap server
      // webhooks, fetch the Auto Tournament CS2 version, start health monitoring) now the
      // database is ready.
      Promise.all([
        ...listIntegrations().map((integration) =>
          (integration.start?.() ?? Promise.resolve()).catch((error) => {
            log.warn(`Failed to start the ${integration.id} integration`, { error });
          })
        ),
        recoverActiveMatches().catch((error) => {
          log.warn('Failed to recover active matches on startup', { error });
        }),
        reportSteamApiKeyStatus().catch((error) => {
          log.warn('Failed to check the Steam Web API key on startup', { error });
        }),
        seedAdminsFromEnv().catch((error) => {
          log.warn('Failed to seed admins from ADMIN_STEAM_IDS on startup', { error });
        }),
        // Best-effort, never blocks: gives built-in games (installed modules
        // + the popular list) a real image/genres from Wikidata (and IGDB
        // covers, if configured). See gameEnrichmentService for the
        // once-per-7-days-per-game throttling and the CI/test opt-out.
        enrichBuiltinGames()
          // Then, without holding up startup, games stored before IGDB was
          // set up get its covers (rate-limited; see the function).
          .then(async () => {
            await resolveStoredGamesAgainstIgdb();
            // Then app icons for games no module or pack draws (Steam client
            // icons; background, rate-limited, see gameIconService).
            await refreshGameIcons();
          })
          .catch((error) => {
            log.warn('Failed to enrich built-in games on startup', { error });
          }),
      ]).then(() => {
        log.success('[Startup] All startup tasks completed');
      });
    });

    // Graceful shutdown handlers
    const stopIntegrations = () => {
      for (const integration of listIntegrations()) {
        integration.stop?.().catch((error) => {
          log.warn(`Failed to stop the ${integration.id} integration`, { error });
        });
      }
    };

    let shuttingDown = false;
    const shutDown = (why: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.warn(`${why}, shutting down gracefully...`);
      scheduler.stopAllPolling();
      stopIntegrations();
      // Live sockets and idle keep-alive connections would hold the close.
      getIO().disconnectSockets(true);
      server.close(() => {
        db.close();
        log.server('Server closed');
        process.exit(0);
      });
      server.closeIdleConnections();
      // Never hang: a stuck connection must not keep the old process alive.
      setTimeout(() => process.exit(0), 10_000).unref();
    };

    process.on('SIGINT', () => shutDown('Received SIGINT'));
    process.on('SIGTERM', () => shutDown('Received SIGTERM'));
    // "Restart now" on the Modules page: exit, and Docker's restart policy
    // starts the new process (utils/restart.ts).
    registerShutdown((reason) => shutDown(`Restart: ${reason}`));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (error instanceof DatabaseRenameRefused) {
      log.error(`[PostgreSQL] Not starting: ${error.message}`);
      process.exit(1);
    }
    log.error('Failed to initialize database', err);

    const msg = typeof err?.message === 'string' ? err.message : '';
    const isConnectionRefused =
      err?.code === 'ECONNREFUSED' ||
      msg.includes('ECONNREFUSED') ||
      msg.toLowerCase().includes('connection refused');

    if (isConnectionRefused) {
      const host = process.env.DB_HOST || '127.0.0.1';
      const port = process.env.DB_PORT || '5432';
      log.server('');
      log.server('⚠️  PostgreSQL is not running or not reachable.');
      log.server(`   Attempted: ${host}:${port}`);
      log.server('');
      log.server('   For local development:');
      log.server('     1. Start Postgres:  yarn db');
      log.server('     2. Restart the API:  yarn dev');
      log.server('');
      log.server('   Using Docker Compose? Start the stack first:');
      log.server('     docker compose -f docker/docker-compose.yml up -d postgres');
      log.server('');
    }

    process.exit(1);
  }
})();

/**
 * Report the state of the Steam Web API key once, at startup.
 *
 * The health check already classifies a missing key, a rejected key and an
 * unreachable Steam, but nothing ran it until something happened to need
 * Steam — so an operator who started the container with a bad key saw a clean
 * log and found out much later, if at all. That is the reported problem: a
 * whole debugging session lost to a fake key, when one line at boot would have
 * ended it.
 *
 * Never fatal. Steam is optional, and Steam being down is not a reason to
 * refuse to start; the point is to say so plainly.
 */
async function reportSteamApiKeyStatus(): Promise<void> {
  const health = await steamService.checkSteamWebApiHealth({ force: true });

  if (health.ok) {
    log.success('[Startup] Steam Web API key is valid');
    return;
  }

  switch (health.errorType) {
    case 'not_configured':
      log.warn(
        '[Startup] STEAM_API_KEY is not set. Steam features (avatars, name lookups, ' +
          'Steam sign-in checks) are disabled. Get a key at ' +
          'https://steamcommunity.com/dev/apikey and set STEAM_API_KEY.'
      );
      break;
    case 'invalid_key':
      log.error(
        '[Startup] STEAM_API_KEY was rejected by Steam' +
          (health.statusCode ? ` (HTTP ${health.statusCode})` : '') +
          '. The key is set but not valid, so Steam features will fail. ' +
          'Check it at https://steamcommunity.com/dev/apikey.'
      );
      break;
    case 'unreachable':
      log.warn(
        `[Startup] Could not reach the Steam Web API to verify STEAM_API_KEY (${health.error}). ` +
          'This may be temporary; the key will be re-checked when it is next used.'
      );
      break;
    default:
      log.warn(
        `[Startup] STEAM_API_KEY could not be verified: ${health.error ?? 'unknown error'}`
      );
  }
}

/**
 * Say what machine access is configured, at boot.
 *
 * A service token that was rejected at parse time (too short, duplicated)
 * otherwise fails silently: nothing complains until the integration's first
 * call comes back 401, by which point the person debugging it is looking at
 * the bot rather than at the env var they typo'd.
 */
function reportServiceTokens(): void {
  const { tokens, problems } = getServiceTokens();

  for (const problem of problems) {
    log.warn(`[Startup] ${problem}`);
  }

  if (tokens.length === 0) {
    log.info(
      '[Startup] No API tokens configured. Set API_TOKENS (full admin) or ' +
        'API_TOKENS_READONLY (GET only) to let bots and scripts call the admin ' +
        'API without a browser session. See docs/API.md.'
    );
    return;
  }

  const described = tokens.map((t) => `${t.label} (${t.scope}, ${t.fingerprint})`).join(', ');
  log.success(
    `[Startup] ${tokens.length} API token(s) active: ${described}`
  );
}

/**
 * Say when game event ingest is running without authentication.
 *
 * ALLOW_UNAUTHENTICATED_EVENTS is a migration shim for servers configured
 * before the webhook token was enforced. Left on, it means anyone who can
 * reach this API can forge match events, so it should be loud every boot
 * rather than something an operator sets once and forgets.
 */
function reportEventAuth(): void {
  if (!allowUnauthenticatedEvents()) return;

  log.warn(
    '[Startup] ALLOW_UNAUTHENTICATED_EVENTS is set: game events with no ' +
      'X-Auto-Tournament-Token are accepted. Anyone who can reach this API can forge match ' +
      'events. Reconnect your servers so they re-fetch their webhook config, then ' +
      'unset this.'
  );
}
