import swaggerJsdoc from 'swagger-jsdoc';

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
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'token',
          description: 'Enter your API token (set in .env as API_TOKEN)',
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
              example: 'NTLAN #1',
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
              example: 'NTLAN #1',
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
              example: 'NTLAN #1 Updated',
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
              example: 'NTLAN #1',
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
  apis: ['./src/routes/*.swagger.ts', './src/index.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
