// IMPORTANT: Load environment variables FIRST, before any other imports
// This ensures all modules can access env vars during initialization
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import swaggerUi from 'swagger-ui-express';
import { db } from './config/database';
import { swaggerSpec } from './config/swagger';
import { log } from './utils/logger';
import { cleanupOldLogs } from './utils/eventLogger';
import { initializeSocket } from './services/socketService';
import { serverService } from './services/serverService';
import { rconService } from './services/rconService';
import { settingsService } from './services/settingsService';
import {
  getMatchZyWebhookCommands,
  getMatchZyLoadMatchAuthCommands,
  getMatchZyReportUploadCommands,
} from './utils/matchzyRconCommands';
import serverRoutes from './routes/servers';
import serverStatusRoutes from './routes/serverStatus';
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
import { recoverActiveMatches } from './services/matchRecoveryService';
import { matchAllocationService } from './services/matchAllocationService';
import packageJson from '../package.json';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Increase body size limit to 50MB for image uploads (base64 encoded images can be large)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
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
 * /api/auth/verify:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Verify authentication token
 *     description: Check if the provided token is valid
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Token is valid
 *       401:
 *         description: Token is invalid
 */
app.get('/api/auth/verify', (req: Request, res: Response): void => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const validToken = process.env.API_TOKEN;

  if (!token || token !== validToken) {
    res.status(401).json({
      success: false,
      error: 'Invalid token',
    });
    return;
  }

  res.json({
    success: true,
    message: 'Token is valid',
  });
});

// API Routes
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
app.use('/api/recovery', recoveryRoutes); // Match recovery endpoints

// Serve frontend at /app
const publicPath = path.join(__dirname, '../public');
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

// Initialize database before starting server
(async () => {
  try {
    await db.init();
    log.success('Database initialized successfully');
  } catch (error) {
    log.error('Failed to initialize database', error as Error);
    process.exit(1);
  }
})();

const server = httpServer.listen(Number(PORT), '0.0.0.0', () => {
  log.server('='.repeat(60));
  log.server('🎮  MatchZy Auto Tournament API');
  log.server('='.repeat(60));
  log.server(`Server running on port ${PORT}`);
  log.server(`Listening on: 0.0.0.0:${PORT} (all network interfaces)`);
  log.server(`Environment: ${process.env.NODE_ENV || 'development'}`);
  log.server(`API Docs: http://localhost:${PORT}/api-docs`);
  log.server(`Health check: http://localhost:${PORT}/health`);
  log.server(`WebSocket: Enabled ✓`);
  log.server(`Event logs: data/logs/events/ (30 day retention)`);
  log.server('='.repeat(60));

  // Bootstrap webhooks and recover active matches
  Promise.all([
    bootstrapServerWebhooks().catch((error) => {
      log.warn('Failed to auto-configure server webhooks on startup', { error });
    }),
    recoverActiveMatches().catch((error) => {
      log.warn('Failed to recover active matches on startup', { error });
    }),
  ]).then(() => {
    log.success('[Startup] All startup tasks completed');
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  log.warn('Received SIGINT, shutting down gracefully...');
  matchAllocationService.stopAllPolling();
  server.close(() => {
    db.close();
    log.server('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  log.warn('Received SIGTERM, shutting down gracefully...');
  matchAllocationService.stopAllPolling();
  server.close(() => {
    db.close();
    log.server('Server closed');
    process.exit(0);
  });
});

async function bootstrapServerWebhooks(): Promise<void> {
  const serverToken = process.env.SERVER_TOKEN;
  if (!serverToken) {
    log.warn('SERVER_TOKEN is not set. Skipping automatic webhook bootstrap.');
    return;
  }

  let baseUrl: string;
  try {
    baseUrl = await settingsService.requireWebhookUrl();
  } catch {
    log.warn('Webhook URL is not configured. Skipping automatic webhook bootstrap.');
    return;
  }

  const enabledServers = await serverService.getAllServers(true);
  if (enabledServers.length === 0) {
    log.info('No enabled servers found for webhook bootstrap.');
    return;
  }

  log.info(`Bootstrapping webhooks for ${enabledServers.length} server(s)...`);

  for (const serverInfo of enabledServers) {
    try {
      const statusResult = await rconService.sendCommand(serverInfo.id, 'status');
      if (!statusResult.success) {
        log.warn(`Skipping ${serverInfo.id}: unable to reach server (${statusResult.error})`);
        continue;
      }

      const commands = [
        ...getMatchZyWebhookCommands(baseUrl, serverToken),
        ...getMatchZyLoadMatchAuthCommands(serverToken),
        ...getMatchZyReportUploadCommands(baseUrl, serverToken, serverInfo.id),
      ];

      for (const cmd of commands) {
        await rconService.sendCommand(serverInfo.id, cmd);
      }

      log.webhookConfigured(serverInfo.id, `${baseUrl}/api/events`);
      log.success(`Auto-configured MatchZy webhook/auth for ${serverInfo.name} (${serverInfo.id})`);
    } catch (error) {
      log.warn(`Failed to auto-configure webhook for server ${serverInfo.id}`, { error });
    }
  }
}
