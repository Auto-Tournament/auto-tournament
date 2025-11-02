import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname,emoji',
          singleLine: false,
        },
      }
    : undefined,
});

// Convenience methods with emojis
export const log = {
  // Server events
  server: (message: string, meta?: object) => logger.info({ ...meta }, `🚀 ${message}`),
  database: (message: string, meta?: object) => logger.info({ ...meta }, `📦 ${message}`),

  // Match events
  matchCreated: (slug: string, serverId: string) =>
    logger.info({ slug, serverId }, `🎮 Match created: ${slug} on server ${serverId}`),
  matchLoaded: (slug: string, serverId: string, webhookConfigured: boolean) =>
    logger.info(
      { slug, serverId, webhookConfigured },
      `✅ Match loaded: ${slug} (webhook: ${webhookConfigured ? 'yes' : 'no'})`
    ),
  matchAllocated: (slug: string, serverId: string, serverName: string) =>
    logger.info(
      { slug, serverId, serverName },
      `🎯 Match allocated: ${slug} → ${serverName} (${serverId})`
    ),
  matchStatusUpdate: (slug: string, status: string) =>
    logger.info({ slug, status }, `📊 Match status: ${slug} → ${status}`),

  // RCON events
  rconCommand: (serverId: string, command: string, success: boolean) =>
    logger.info(
      { serverId, command, success },
      `🎛️  RCON ${success ? '✓' : '✗'}: ${serverId} → ${command}`
    ),
  rconBroadcast: (count: number, command: string) =>
    logger.info({ count, command }, `📢 Broadcast to ${count} servers: ${command}`),

  // Webhook events
  webhookReceived: (event: string, matchId: string) =>
    logger.info({ event, matchId }, `📡 Event received: ${event} (${matchId})`),
  webhookConfigured: (serverId: string, url: string) =>
    logger.info({ serverId, url }, `🔗 Webhook configured: ${serverId} → ${url}`),

  // Server management
  serverCreated: (id: string, name: string) =>
    logger.info({ id, name }, `🖥️  Server created: ${name} (${id})`),
  serverUpdated: (id: string, name: string) =>
    logger.info({ id, name }, `🔧 Server updated: ${name} (${id})`),
  serverDeleted: (id: string, name: string) =>
    logger.info({ id, name }, `🗑️  Server deleted: ${name} (${id})`),

  // HTTP requests
  request: (method: string, path: string, statusCode?: number) =>
    logger.info(
      { method, path, statusCode },
      `🌐 ${method} ${path}${statusCode ? ` → ${statusCode}` : ''}`
    ),

  // Auth
  authSuccess: (endpoint: string) => logger.debug({ endpoint }, `🔓 Auth success: ${endpoint}`),
  authFailed: (endpoint: string, reason: string) =>
    logger.warn({ endpoint, reason }, `🔒 Auth failed: ${endpoint} - ${reason}`),

  // Warnings
  warn: (message: string, meta?: object) => logger.warn({ ...meta }, `⚠️  ${message}`),

  // Errors
  error: (message: string, error?: Error | unknown, meta?: object) => {
    const errorDetails =
      error instanceof Error ? { error: error.message, stack: error.stack } : { error };
    logger.error({ ...meta, ...errorDetails }, `❌ ${message}`);
  },

  // Debug
  debug: (message: string, meta?: object) => logger.debug({ ...meta }, `🐛 ${message}`),

  // Success
  success: (message: string, meta?: object) => logger.info({ ...meta }, `✅ ${message}`),
};
