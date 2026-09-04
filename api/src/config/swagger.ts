import swaggerJsdoc from 'swagger-jsdoc';

const swaggerServerUrl =
  process.env.API_BASE_URL?.trim() ||
  process.env.FRONTEND_BASE_URL?.trim() ||
  `http://localhost:${process.env.PORT || '3000'}`;

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MatchZy Auto Tournament API',
      version: '1.0.0',
      description: 'API for managing CS2 tournament servers with secure RCON control',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: swaggerServerUrl,
        description: 'API server (from API_BASE_URL, FRONTEND_BASE_URL, or localhost)',
      },
    ],
    components: {
      securitySchemes: {
        // NOTE: this is an opaque shared secret from API_TOKENS /
        // API_TOKENS_READONLY, not a JWT. It used to be documented as one,
        // which was doubly misleading: nothing issued a JWT, and nothing
        // accepted a bearer token at all. See docs/API.md.
        //
        // Browsers use the admin session cookie instead; that is not described
        // here because Swagger UI cannot drive the Steam login flow anyway.
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'opaque',
          description:
            'Service token for machine clients (bots, scripts, CI). Send ' +
            '`Authorization: Bearer <token>`, where the token is one configured ' +
            'in API_TOKENS (full admin) or API_TOKENS_READONLY (GET only). ' +
            'Human admins authenticate with a session cookie instead.',
        },
        // Backward compatible alias: many route docs use BearerAuth.
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'opaque',
          description:
            'Service token for machine clients (bots, scripts, CI). Send ' +
            '`Authorization: Bearer <token>`, where the token is one configured ' +
            'in API_TOKENS (full admin) or API_TOKENS_READONLY (GET only). ' +
            'Human admins authenticate with a session cookie instead.',
        },
        // Same service token, for clients whose HTTP layer reserves the
        // Authorization header.
        apiToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Token',
          description:
            'Service token, as an alternative to `Authorization: Bearer <token>`.',
        },
        matchzyServerToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-MatchZy-Token',
          description:
            'Server-to-API authentication (webhooks, reports, demo uploads). Send `X-MatchZy-Token: <token>`.',
        },
      },
      schemas: {
        Server: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique server identifier',
              example: 'cs1',
            },
            name: {
              type: 'string',
              description: 'Server display name',
              example: 'Server #1',
            },
            host: {
              type: 'string',
              description: 'Server IP address or hostname',
              example: '192.168.254.232',
            },
            port: {
              type: 'integer',
              description: 'Server port',
              example: 27015,
            },
            password: {
              type: 'string',
              description: 'RCON password',
              example: 'rcon_password',
            },
            enabled: {
              type: 'boolean',
              description: 'Whether the server is enabled',
              example: true,
            },
            created_at: {
              type: 'integer',
              description: 'Unix timestamp of creation',
              example: 1699000000,
            },
            updated_at: {
              type: 'integer',
              description: 'Unix timestamp of last update',
              example: 1699000000,
            },
          },
        },
        CreateServerInput: {
          type: 'object',
          required: ['id', 'name', 'host', 'port', 'password'],
          properties: {
            id: {
              type: 'string',
              description: 'Unique server identifier',
              example: 'cs1',
            },
            name: {
              type: 'string',
              description: 'Server display name',
              example: 'Server #1',
            },
            host: {
              type: 'string',
              description: 'Server IP address or hostname',
              example: '192.168.254.232',
            },
            port: {
              type: 'integer',
              description: 'Server port (1-65535)',
              example: 27015,
            },
            password: {
              type: 'string',
              description: 'RCON password',
              example: 'rcon_password',
            },
          },
        },
        UpdateServerInput: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Server display name',
              example: 'Server #1 Updated',
            },
            host: {
              type: 'string',
              description: 'Server IP address or hostname',
              example: '192.168.254.232',
            },
            port: {
              type: 'integer',
              description: 'Server port (1-65535)',
              example: 27015,
            },
            password: {
              type: 'string',
              description: 'RCON password',
              example: 'new_password',
            },
          },
        },
        RconResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            serverId: {
              type: 'string',
              example: 'cs1',
            },
            serverName: {
              type: 'string',
              example: 'Server #1',
            },
            command: {
              type: 'string',
              example: 'css_start',
            },
            response: {
              type: 'string',
              example: 'Match started',
            },
            error: {
              type: 'string',
              example: 'Connection timeout',
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            error: {
              type: 'string',
              example: 'Error message',
            },
          },
        },
      },
    },
    tags: [
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
      {
        name: 'Servers',
        description: 'Server management endpoints',
      },
      {
        name: 'RCON',
        description: 'RCON command endpoints (authentication required)',
      },
    ],
  },
  // Scan all route files so any `@openapi` blocks are included.
  // (Many endpoints document OpenAPI inline in their route file, not only in `*.swagger.ts`.)
  apis: ['./src/routes/*.ts', './src/index.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
