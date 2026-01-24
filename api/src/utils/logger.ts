/* eslint-disable @typescript-eslint/no-require-imports */

// Load environment variables FIRST (before reading process.env.LOG_LEVEL)
// This ensures LOG_LEVEL=debug from .env is respected
try {
  require('dotenv').config();
} catch {
  // dotenv not available, continue without it
}

const isDevelopment = process.env.NODE_ENV !== 'production';

const _logLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const isLogLevelDebug = _logLevel === 'debug';

/**
 * Logging feature flags
 *
 * These allow you to control *what* gets written to the main API logs
 * without changing call sites everywhere:
 *
 * - LOG_HTTP_REQUESTS=false      → disable per-request [HTTP] logs
 * - LOG_DB_VERBOSE=true         → enable per-query [DATABASE] logs (SQL, params, row counts)
 * - LOG_DB_VALUES=true          → when DB verbose, also log result rows (redacted via safeJson)
 * - LOG_RCON_VERBOSE=true       → enable high-volume RCON success logs
 *
 * When LOG_LEVEL=debug, LOG_DB_VERBOSE and LOG_DB_VALUES are enabled automatically
 * unless explicitly set to false. Use LOG_DB_VERBOSE=false or LOG_DB_VALUES=false
 * to override.
 *
 * Errors and warnings are **never** suppressed by these flags.
 */
export const LOG_HTTP_REQUESTS =
  (process.env.LOG_HTTP_REQUESTS || '').toLowerCase() !== 'false';

const _dbVerboseEnv = (process.env.LOG_DB_VERBOSE || '').toLowerCase();
const _dbValuesEnv = (process.env.LOG_DB_VALUES || '').toLowerCase();

export const LOG_DB_VERBOSE =
  _dbVerboseEnv === 'true' || (isLogLevelDebug && _dbVerboseEnv !== 'false');

export const LOG_DB_VALUES =
  _dbValuesEnv === 'true' || (isLogLevelDebug && _dbValuesEnv !== 'false');

export const LOG_RCON_VERBOSE =
  (process.env.LOG_RCON_VERBOSE || '').toLowerCase() === 'true';

/**
 * Create a Pino logger instance with compatibility for older Node.js 18 releases.
 *
 * `pino@10` relies on `diagnostics_channel.tracingChannel`, which was added in Node 18.19.0.
 * On older 18.x versions (like 18.12.1), we polyfill `tracingChannel` to fall back to `channel`
 * so that Pino can initialize without crashing.
 */
function createPinoLogger() {
  try {
    const diagnosticsChannel = require('node:diagnostics_channel');

    if (
      diagnosticsChannel &&
      typeof diagnosticsChannel.tracingChannel !== 'function' &&
      typeof diagnosticsChannel.channel === 'function'
    ) {
      // Polyfill for older Node versions: use `channel` as a stand-in for `tracingChannel`
      // This preserves basic diagnostics behavior without requiring a newer Node runtime.
      diagnosticsChannel.tracingChannel = diagnosticsChannel.channel;
    }
  } catch {
    // If diagnostics_channel is unavailable for some reason, continue without polyfill.
  }

  const pino = require('pino');

  // In development we prefer pretty-printed logs, but only if the
  // optional `pino-pretty` dependency is actually available. In
  // bundled / slim images we don't ship it, so we must gracefully
  // fall back to JSON to avoid hard crashes like:
  // "unable to determine transport target for \"pino-pretty\"".
  let transport: unknown = undefined;

  if (isDevelopment) {
    try {
      // Throws if pino-pretty cannot be resolved at runtime
      // (e.g. in the minimal Docker release image).
      require.resolve('pino-pretty');

      transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'UTC:yyyy-MM-dd HH:mm:ss',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      };
    } catch {
      // Silent fallback: keep transport undefined so we emit JSON logs.
      // This keeps containers healthy even without pino-pretty installed.
      transport = undefined;
    }
  }

  return pino({
    level: process.env.LOG_LEVEL || 'info',
    transport,
  });
}

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

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Internal helper: route all log calls through a single place so we can
 * consistently apply feature flags (e.g. HTTP/DB/RCON verbosity) without
 * touching every call site.
 */
function emit(
  level: LogLevel,
  message: string,
  meta?: object
): void {
  // Errors and warnings are always logged
  if (level === 'error') {
    addToBuffer('error', message, meta);
    logger.error({ ...meta }, message);
    return;
  }

  if (level === 'warn') {
    addToBuffer('warn', message, meta);
    logger.warn({ ...meta }, message);
    return;
  }

  if (level === 'debug') {
    addToBuffer('debug', message, meta);
    logger.debug({ ...meta }, message);
    return;
  }

  // Default: info
  addToBuffer('info', message, meta);
  logger.info({ ...meta }, message);
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
export const logger = createPinoLogger();

// Convenience methods for structured logging
export const log = {
  // Server events
  server: (message: string, meta?: object) => {
    const msg = `[SERVER] ${message}`;
    emit('info', msg, meta);
  },
  database: (message: string, meta?: object) => {
    const msg = `[DATABASE] ${message}`;
    emit('info', msg, meta);
  },

  // Match events
  matchCreated: (slug: string, serverId: string) => {
    const msg = `[MATCH] Match created: ${slug} on server ${serverId}`;
    const meta = { slug, serverId };
    emit('info', msg, meta);
  },
  matchLoaded: (slug: string, serverId: string, webhookConfigured: boolean) => {
    const msg = `[MATCH] Match loaded: ${slug} (webhook: ${webhookConfigured ? 'yes' : 'no'})`;
    const meta = { slug, serverId, webhookConfigured };
    emit('info', msg, meta);
  },
  matchAllocated: (slug: string, serverId: string, serverName: string) => {
    const msg = `[MATCH] Match allocated: ${slug} -> ${serverName} (${serverId})`;
    const meta = { slug, serverId, serverName };
    emit('info', msg, meta);
  },
  matchStatusUpdate: (slug: string, status: string) => {
    const msg = `[MATCH] Match status: ${slug} -> ${status}`;
    const meta = { slug, status };
    emit('info', msg, meta);
  },

  // RCON events
  rconCommand: (serverId: string, command: string, success: boolean) => {
    const msg = `[RCON] ${success ? 'SUCCESS' : 'FAILED'}: ${serverId} -> ${command}`;
    const meta = { serverId, command, success };
    // High‑volume success logs can be disabled via LOG_RCON_VERBOSE.
    if (!LOG_RCON_VERBOSE && success) {
      return;
    }
    emit('info', msg, meta);
  },
  rconBroadcast: (count: number, command: string) => {
    const msg = `[RCON] Broadcast to ${count} servers: ${command}`;
    const meta = { count, command };
    emit('info', msg, meta);
  },

  // Webhook events
  webhookReceived: (event: string, matchId: string) => {
    const msg = `[WEBHOOK] Event received: ${event} (${matchId})`;
    const meta = { event, matchId };
    emit('info', msg, meta);
  },
  webhookConfigured: (serverId: string, url: string) => {
    const msg = `[WEBHOOK] Webhook configured: ${serverId} -> ${url}`;
    const meta = { serverId, url };
    emit('info', msg, meta);
  },

  // Server management
  serverCreated: (id: string, name: string) => {
    const msg = `[SERVER] Server created: ${name} (${id})`;
    const meta = { id, name };
    emit('info', msg, meta);
  },
  serverUpdated: (id: string, name: string) => {
    const msg = `[SERVER] Server updated: ${name} (${id})`;
    const meta = { id, name };
    emit('info', msg, meta);
  },
  serverDeleted: (id: string, name: string) => {
    const msg = `[SERVER] Server deleted: ${name} (${id})`;
    const meta = { id, name };
    emit('info', msg, meta);
  },

  // HTTP requests
  request: (method: string, path: string, statusCode?: number) => {
    const msg = `[HTTP] ${method} ${path}${statusCode ? ` -> ${statusCode}` : ''}`;
    const meta = { method, path, statusCode };
    emit('info', msg, meta);
  },

  // Auth
  authSuccess: (endpoint: string) => {
    const msg = `[AUTH] Auth success: ${endpoint}`;
    const meta = { endpoint };
    emit('debug', msg, meta);
  },
  authFailed: (endpoint: string, reason: string) => {
    const msg = `[AUTH] Auth failed: ${endpoint} - ${reason}`;
    const meta = { endpoint, reason };
    emit('warn', msg, meta);
  },

  // Warnings
  warn: (message: string, meta?: object) => {
    const msg = `[WARN] ${message}`;
    emit('warn', msg, meta);
  },

  // Errors
  error: (message: string, error?: Error | unknown, meta?: object) => {
    const errorDetails =
      error instanceof Error ? { error: error.message, stack: error.stack } : { error };
    const msg = `[ERROR] ${message}`;
    emit('error', msg, { ...meta, ...errorDetails });
  },

  // Debug
  debug: (message: string, meta?: object) => {
    const msg = `[DEBUG] ${message}`;
    emit('debug', msg, meta);
  },

  // Info
  info: (message: string, meta?: object) => {
    emit('info', message, meta);
  },

  // Success
  success: (message: string, meta?: object) => {
    const msg = `[SUCCESS] ${message}`;
    emit('info', msg, meta);
  },
};
