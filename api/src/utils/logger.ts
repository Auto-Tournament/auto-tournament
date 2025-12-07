import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

// In-memory log buffer for recent logs
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: object;
}

const MAX_LOGS = 1000; // Keep last 1000 logs
const logBuffer: LogEntry[] = [];

// Helper to add to log buffer
function addToBuffer(level: string, message: string, meta?: object) {
  logBuffer.push({
    timestamp: new Date().toISOString(),
    level,
    message,
    meta,
  });

  // Keep only the last MAX_LOGS entries
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
}

// Export function to get recent logs
export function getRecentLogs(limit = 100): LogEntry[] {
  return logBuffer.slice(-limit).reverse(); // Most recent first
}

/**
 * Pino logger configuration
 *
 * Industry standard approach:
 * - Development: Pretty-printed, colored logs for easier human reading
 * - Production: JSON structured logs for log aggregation systems (ELK, Datadog, CloudWatch, etc.)
 *
 * JSON in production enables:
 * - Better performance (no formatting overhead)
 * - Structured parsing by log aggregation tools
 * - Smaller log file sizes
 * - Machine-readable format for automated analysis
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'UTC:yyyy-MM-dd HH:mm:ss',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      }
    : undefined, // Production: undefined = JSON output (industry standard)
});

// Convenience methods for structured logging
export const log = {
  // Server events
  server: (message: string, meta?: object) => {
    const msg = `[SERVER] ${message}`;
    addToBuffer('info', msg, meta);
    logger.info({ ...meta }, msg);
  },
  database: (message: string, meta?: object) => {
    const msg = `[DATABASE] ${message}`;
    addToBuffer('info', msg, meta);
    logger.info({ ...meta }, msg);
  },

  // Match events
  matchCreated: (slug: string, serverId: string) => {
    const msg = `[MATCH] Match created: ${slug} on server ${serverId}`;
    const meta = { slug, serverId };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },
  matchLoaded: (slug: string, serverId: string, webhookConfigured: boolean) => {
    const msg = `[MATCH] Match loaded: ${slug} (webhook: ${webhookConfigured ? 'yes' : 'no'})`;
    const meta = { slug, serverId, webhookConfigured };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },
  matchAllocated: (slug: string, serverId: string, serverName: string) => {
    const msg = `[MATCH] Match allocated: ${slug} -> ${serverName} (${serverId})`;
    const meta = { slug, serverId, serverName };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },
  matchStatusUpdate: (slug: string, status: string) => {
    const msg = `[MATCH] Match status: ${slug} -> ${status}`;
    const meta = { slug, status };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },

  // RCON events
  rconCommand: (serverId: string, command: string, success: boolean) => {
    const msg = `[RCON] ${success ? 'SUCCESS' : 'FAILED'}: ${serverId} -> ${command}`;
    const meta = { serverId, command, success };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },
  rconBroadcast: (count: number, command: string) => {
    const msg = `[RCON] Broadcast to ${count} servers: ${command}`;
    const meta = { count, command };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },

  // Webhook events
  webhookReceived: (event: string, matchId: string) => {
    const msg = `[WEBHOOK] Event received: ${event} (${matchId})`;
    const meta = { event, matchId };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },
  webhookConfigured: (serverId: string, url: string) => {
    const msg = `[WEBHOOK] Webhook configured: ${serverId} -> ${url}`;
    const meta = { serverId, url };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },

  // Server management
  serverCreated: (id: string, name: string) => {
    const msg = `[SERVER] Server created: ${name} (${id})`;
    const meta = { id, name };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },
  serverUpdated: (id: string, name: string) => {
    const msg = `[SERVER] Server updated: ${name} (${id})`;
    const meta = { id, name };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },
  serverDeleted: (id: string, name: string) => {
    const msg = `[SERVER] Server deleted: ${name} (${id})`;
    const meta = { id, name };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },

  // HTTP requests
  request: (method: string, path: string, statusCode?: number) => {
    const msg = `[HTTP] ${method} ${path}${statusCode ? ` -> ${statusCode}` : ''}`;
    const meta = { method, path, statusCode };
    addToBuffer('info', msg, meta);
    logger.info(meta, msg);
  },

  // Auth
  authSuccess: (endpoint: string) => {
    const msg = `[AUTH] Auth success: ${endpoint}`;
    const meta = { endpoint };
    addToBuffer('debug', msg, meta);
    logger.debug(meta, msg);
  },
  authFailed: (endpoint: string, reason: string) => {
    const msg = `[AUTH] Auth failed: ${endpoint} - ${reason}`;
    const meta = { endpoint, reason };
    addToBuffer('warn', msg, meta);
    logger.warn(meta, msg);
  },

  // Warnings
  warn: (message: string, meta?: object) => {
    const msg = `[WARN] ${message}`;
    addToBuffer('warn', msg, meta);
    logger.warn({ ...meta }, msg);
  },

  // Errors
  error: (message: string, error?: Error | unknown, meta?: object) => {
    const errorDetails =
      error instanceof Error ? { error: error.message, stack: error.stack } : { error };
    const msg = `[ERROR] ${message}`;
    addToBuffer('error', msg, { ...meta, ...errorDetails });
    logger.error({ ...meta, ...errorDetails }, msg);
  },

  // Debug
  debug: (message: string, meta?: object) => {
    const msg = `[DEBUG] ${message}`;
    addToBuffer('debug', msg, meta);
    logger.debug({ ...meta }, msg);
  },

  // Info
  info: (message: string, meta?: object) => {
    addToBuffer('info', message, meta);
    logger.info({ ...meta }, message);
  },

  // Success
  success: (message: string, meta?: object) => {
    const msg = `[SUCCESS] ${message}`;
    addToBuffer('info', msg, meta);
    logger.info({ ...meta }, msg);
  },
};
