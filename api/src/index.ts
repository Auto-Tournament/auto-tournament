// IMPORTANT: Load environment variables FIRST, before any other imports
// This ensures all modules can access env vars during initialization
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
dotenv.config({ path: path.join(process.cwd(), '.env') });

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import swaggerUi from 'swagger-ui-express';
import { db } from './config/database';
import { swaggerSpec } from './config/swagger';
import { log, logger, LOG_HTTP_REQUESTS, LOG_DB_VERBOSE, LOG_DB_VALUES } from './utils/logger';
import { cleanupOldLogs } from './utils/eventLogger';
import { initializeSocket } from './services/socketService';
import { serverService } from './services/serverService';
import { rconService } from './services/rconService';
import { settingsService } from './services/settingsService';
import { serverInitializationService } from './services/serverInitializationService';
import serverRoutes from './routes/servers';
import serverStatusRoutes from './routes/serverStatus';
import serverBootstrapRoutes from './routes/serverBootstrap';
import teamRoutes from './routes/teams';
import rconRoutes from './routes/rcon';
import matchRoutes from './routes/matches';
import eventRoutes from './routes/events';
import steamRoutes from './routes/steam';
import tournamentRoutes from './routes/tournament';
import demoRoutes from './routes/demos';
import teamMatchRoutes from './routes/teamMatch';
import teamStatsRoutes from './routes/teamStats';
import logsRoutes from './routes/logs';
import vetoRoutes from './routes/veto';
import settingsRoutes from './routes/settings';
import mapsRoutes from './routes/maps';
import mapPoolsRoutes from './routes/mapPools';
import recoveryRoutes from './routes/recovery';
import generationRoutes from './routes/generation';
import templatesRoutes from './routes/templates';
import manualMatchTemplatesRoutes from './routes/manualMatchTemplates';
import playersRoutes from './routes/players';
import eloTemplatesRoutes from './routes/eloTemplates';
import testRoutes from './routes/test';
import authRoutes from './routes/auth';
import matchzyRoutes from './routes/matchzy';
import { initMatchZyVersionService } from './services/matchzyVersionService';
import { recoverActiveMatches } from './services/matchRecoveryService';
import { matchAllocationService } from './services/matchAllocationService';
import { healthMonitoringService } from './services/healthMonitoringService';
import packageJson from '../package.json';
import { configurePassportAuth, passport } from './config/passport';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { isIP } from 'net';

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
const sessionSecret = process.env.SESSION_SECRET || 'matchzy-dev-session-secret';
const PgSession = connectPgSimple(session);

// Reuse the same connection string logic as the main DatabaseManager so the
// session store talks to the exact same PostgreSQL instance with known‑good
// credentials. This avoids subtle mismatches when DATABASE_URL is unset or
// when individual DB_* env vars are used instead.
const sessionDbConnectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${
    process.env.DB_HOST || '127.0.0.1'
  }:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'matchzy_tournament'}`;

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
    const { method, path } = req;
    const { statusCode } = res;

    // Skip logging 304 (Not Modified) responses to reduce noise
    if (statusCode === 304) {
      return;
    }

    // Skip logging 404s for root path (common in dev mode from browser/tools)
    if (statusCode === 404 && path === '/') {
      return;
    }

    // Log with appropriate level based on status code
    if (statusCode >= 500) {
      log.error(`${method} ${path}`, undefined, { statusCode, duration });
    } else if (statusCode >= 400) {
      log.warn(`${method} ${path}`, { statusCode, duration });
    } else {
      log.request(method, path, statusCode);
    }
  });

  next();
});

// Swagger Documentation
// swagger-ui-express types don't perfectly match Express middleware types
app.use(
  '/api-docs',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...(swaggerUi.serve as any),
  swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'MatchZy API Docs',
  }) as // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
);

// Swagger JSON
app.get('/api-docs.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
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
    message: 'MatchZy Auto Tournament API',
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
        getConfig: 'GET /api/matches/:slug.json (public - for MatchZy)',
        create: 'POST /api/matches (auth required)',
        load: 'POST /api/matches/:slug/load (auth required, webhooks auto-configured)',
        loadNoWebhook: 'POST /api/matches/:slug/load?skipWebhook=true (skip webhook setup)',
        updateStatus: 'PATCH /api/matches/:slug/status (auth required)',
        delete: 'DELETE /api/matches/:slug (auth required)',
      },
      events: {
        note: 'MatchZy event webhooks - receive game events',
        webhook: 'POST /api/events (server token required)',
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
  const now = Math.floor(Date.now() / 1000);
  const servers = await serverService.getAllServers(true);

  const enabled = servers.filter((s) => s.enabled === 1 && s.host !== '0.0.0.0');
  const outdated = enabled.filter((s) => typeof s.cs2_required_version === 'number');
  const stale = enabled.filter((s) => !s.cs2_update_checked_at || now - s.cs2_update_checked_at >= 30 * 60);
  const neverChecked = enabled.filter((s) => !s.cs2_update_checked_at);

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cs2Fleet: {
      enabled: enabled.length,
      outdated: outdated.length,
      stale: stale.length,
      neverChecked: neverChecked.length,
    },
    servers: enabled.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status ?? null,
      lastSeen: s.last_seen ?? null,
      cs2BuildId: s.cs2_build_id ?? null,
      cs2RequiredVersion: s.cs2_required_version ?? null,
      cs2UpdatePhase: s.cs2_update_phase ?? null,
      cs2UpdateRequiredAt: s.cs2_update_required_at ?? null,
      cs2UpdateCheckedAt: s.cs2_update_checked_at ?? null,
      cs2VersionFetchedAt: s.cs2_version_fetched_at ?? null,
    })),
  });
});

// API Routes
app.use('/api/servers', serverBootstrapRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/servers', serverStatusRoutes); // Mount status routes under /api/servers
app.use('/api/teams', teamRoutes);
app.use('/api/rcon', rconRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/steam', steamRoutes);
app.use('/api/tournament', tournamentRoutes);
app.use('/api/demos', demoRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/team', teamMatchRoutes); // Public team match data
app.use('/api/team', teamStatsRoutes); // Public team stats/history
app.use('/api/veto', vetoRoutes); // Map veto system
app.use('/api/settings', settingsRoutes);
app.use('/api/maps', mapsRoutes);
app.use('/api/map-pools', mapPoolsRoutes);
app.use('/api/templates', templatesRoutes); // Tournament templates
app.use('/api/manual-match-templates', manualMatchTemplatesRoutes); // Manual match templates
app.use('/api/recovery', recoveryRoutes); // Match recovery endpoints
app.use('/api/players', playersRoutes); // Player management
app.use('/api/elo-templates', eloTemplatesRoutes); // ELO calculation templates
app.use('/api/generation', generationRoutes); // Shared name/code generators (e.g. team names)
app.use('/api/test', testRoutes); // Test utilities (log markers, etc.)
app.use('/api/auth', authRoutes); // Authentication (Steam, Keycloak, Discord)
app.use('/api/matchzy', matchzyRoutes); // MatchZy Enhanced version info

// Serve frontend at /app (built client lives under api/public)
const publicPath = path.join(__dirname, '..', 'public');
app.use('/app', express.static(publicPath));

// Serve map images statically
app.use('/map-images', express.static(path.join(publicPath, 'map-images')));
app.get('/app/*', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicPath, 'index.html'));
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

// Initialize database and start server
(async () => {
  try {
    // Initialize database first (including schema)
    await db.init();
    log.success('Database initialized successfully');

    // Now start the server after database is ready
    // Bind to all interfaces (IPv4 & IPv6) so both 127.0.0.1 and ::1 work with dev proxies.
    const server = httpServer.listen(Number(PORT), () => {
      log.server('='.repeat(60));
      log.server('MatchZy Auto Tournament API');
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
      log.server(`Event logs: api/data/logs/events/ (30 day retention)`);
      log.server('='.repeat(60));

      // Bootstrap webhooks, recover matches, fetch MatchZy version (now database is ready)
      Promise.all([
        bootstrapServerWebhooks().catch((error) => {
          log.warn('Failed to auto-configure server webhooks on startup', { error });
        }),
        recoverActiveMatches().catch((error) => {
          log.warn('Failed to recover active matches on startup', { error });
        }),
      ]).then(() => {
        log.success('[Startup] All startup tasks completed');
        
        // Fetch latest MatchZy Enhanced version (fire-and-forget, cached for 1 hour)
        initMatchZyVersionService();
        
        // Start health monitoring for server tracking
        // Checks every minute to mark inactive servers as offline
        healthMonitoringService.start();
      });
    });

    // Graceful shutdown handlers
    process.on('SIGINT', () => {
      log.warn('Received SIGINT, shutting down gracefully...');
      matchAllocationService.stopAllPolling();
      healthMonitoringService.stop();
      server.close(() => {
        db.close();
        log.server('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      log.warn('Received SIGTERM, shutting down gracefully...');
      matchAllocationService.stopAllPolling();
      healthMonitoringService.stop();
      server.close(() => {
        db.close();
        log.server('Server closed');
        process.exit(0);
      });
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
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

async function bootstrapServerWebhooks(): Promise<void> {
  const serverToken = process.env.SERVER_TOKEN;
  if (!serverToken) {
    log.warn('SERVER_TOKEN is not set. Skipping automatic webhook bootstrap.');
    return;
  }

  // Resolve webhook base URL from settings.
  // Priority: 1) DB, 2) API_BASE_URL, 3) FRONTEND_BASE_URL, 4) http://localhost:{PORT}
  const apiPort = parseInt(process.env.PORT || '3000', 10);
  const localhostDefault = `http://localhost:${apiPort}`;
  let baseUrl = await settingsService.getWebhookUrl();

  const fromApi = process.env.API_BASE_URL?.trim();
  const fromFrontend = process.env.FRONTEND_BASE_URL?.trim();

  // If DB has localhost:PORT but FRONTEND_BASE_URL is set, treat as "wrong default" and fix it.
  if (
    baseUrl &&
    (baseUrl === localhostDefault || baseUrl === 'http://localhost:3000') &&
    fromFrontend &&
    !fromApi
  ) {
    try {
      await settingsService.setSetting('webhook_url', fromFrontend);
      baseUrl = await settingsService.getWebhookUrl();
      log.success(`Webhook URL updated from localhost default to FRONTEND_BASE_URL: ${baseUrl}`);
    } catch (e) {
      log.warn('Failed to update webhook URL from FRONTEND_BASE_URL', { error: e });
    }
  }

  if (!baseUrl) {
    const fallback = fromApi || fromFrontend || localhostDefault;
    const source = fromApi ? 'API_BASE_URL' : fromFrontend ? 'FRONTEND_BASE_URL' : 'auto-detect (PORT)';
    try {
      await settingsService.setSetting('webhook_url', fallback);
      baseUrl = await settingsService.getWebhookUrl();
      log.success(`Webhook URL initialized from ${source}: ${baseUrl}`);
      if (source === 'auto-detect (PORT)') {
        log.warn(
          'Webhook URL was not configured; auto-detected from PORT. ' +
            'Set API_BASE_URL or FRONTEND_BASE_URL in .env, or update in Settings, if your API is elsewhere.'
        );
      }
    } catch (error) {
      log.warn(
        'Failed to set webhook URL; skipping automatic webhook bootstrap. ' +
          'Set API_BASE_URL or FRONTEND_BASE_URL in .env or configure in Settings.',
        { error }
      );
      return;
    }
  }

  const enabledServers = await serverService.getAllServers(true);
  if (enabledServers.length === 0) {
    log.info('No enabled servers found for webhook bootstrap.');
    return;
  }

  log.info(`[STARTUP] Checking ${enabledServers.length} enabled server(s)...`);

  // Process all servers concurrently for faster startup
  await Promise.allSettled(
    enabledServers.map(async (serverInfo) => {
      try {
        // Quick RCON ping to check if server is reachable
        const statusResult = await rconService.sendCommand(serverInfo.id, 'status');
        if (!statusResult.success) {
          log.warn(`[STARTUP] ${serverInfo.id}: Unreachable (${statusResult.error})`);
          return;
        }

        const needsInit = !serverInfo.persistentConfigSent;
        const needsRetry = !!serverInfo.persistentConfigSent && !serverInfo.lastSeen;

        if (needsInit || needsRetry) {
          // Server needs (re)configuration
          await serverInitializationService.initializeServer(serverInfo.id, baseUrl, {
            force: needsRetry,
          });
          log.success(
            `[STARTUP] ${serverInfo.id}: ${needsInit ? 'Configured' : 'Retry sent'} – waiting for MatchZy events`
          );
        } else {
          // Server is already configured and has sent events - just log status
          const timeSinceLastSeen = serverInfo.lastSeen
            ? Math.floor(Date.now() / 1000) - serverInfo.lastSeen
            : null;
          
          if (timeSinceLastSeen !== null && timeSinceLastSeen < 300) {
            log.info(`[STARTUP] ${serverInfo.id}: Online (last event ${timeSinceLastSeen}s ago)`);
          } else {
            log.info(`[STARTUP] ${serverInfo.id}: Configured but inactive (${timeSinceLastSeen ? `${timeSinceLastSeen}s` : 'never'} since last event)`);
          }
        }
      } catch (error) {
        log.warn(`[STARTUP] ${serverInfo.id}: Check failed`, { error });
      }
    })
  );

  log.success(`[STARTUP] Server initialization complete`);
}
