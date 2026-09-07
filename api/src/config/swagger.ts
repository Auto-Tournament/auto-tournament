import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import {
  collectRouterGroups,
  pathParams,
  toOpenApiPath,
  type Guard,
} from '../utils/routeIntrospection';

/** Absolute path to `api/src`, so the jsdoc globs do not depend on cwd. */
const API_SRC = path.resolve(__dirname, '..');

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
  //
  // Resolved from this file rather than the working directory: the server runs
  // from `api/`, but the docs generator runs from the repo root, and a relative
  // glob silently matches nothing from the wrong place — producing a spec with
  // no hand-written detail in it at all.
  apis: [
    path.join(API_SRC, 'routes', '*.ts'),
    path.join(API_SRC, 'index.ts'),
  ],
};

/** How each guard maps onto the security schemes declared above. */
const SECURITY_BY_GUARD: Record<Guard, Array<Record<string, string[]>>> = {
  admin: [{ bearerAuth: [] }, { apiToken: [] }],
  'server token': [{ matchzyServerToken: [] }],
};

interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<Record<string, unknown>>;
  responses?: Record<string, unknown>;
  [key: string]: unknown;
}

type PathsObject = Record<string, Record<string, OperationObject>>;

/**
 * Build the OpenAPI spec: hand-written `@openapi` blocks, completed from the
 * routers.
 *
 * The annotations carry what a walk cannot infer — request bodies, response
 * schemas, prose. They also only cover about a third of the endpoints, and
 * nothing makes anyone write one for a new route. So the walk supplies the
 * skeleton for everything, and an annotation wins wherever it exists.
 *
 * The one thing the walk always overrides is `security`. An annotation saying
 * an endpoint is open when `requireAuth` guards it (or the reverse) is worse
 * than no annotation, because it is believed. The middleware is the truth.
 */
export function buildOpenApiSpec(): Record<string, unknown> {
  const spec = swaggerJsdoc(options) as Record<string, unknown> & { paths?: PathsObject };
  const paths: PathsObject = spec.paths ?? {};

  for (const group of collectRouterGroups()) {
    for (const endpoint of group.endpoints) {
      const openApiPath = toOpenApiPath(endpoint.path);
      const method = endpoint.method.toLowerCase();

      // OpenAPI has no vocabulary for these, and Express registers HEAD for
      // free alongside GET.
      if (method === 'head' || method === 'options') continue;

      // A shadowed registration never runs, so describing it would misreport
      // the endpoint — `GET /api/tournament/{id}/leaderboard` is registered
      // public and then again admin-guarded, and the public one is what
      // answers. Skipping keeps the first, which is the one Express matches.
      if (endpoint.shadowed) continue;

      const forPath = (paths[openApiPath] ??= {});
      const existing = forPath[method];

      const operation: OperationObject = existing ?? {
        tags: [group.title],
        summary: `${endpoint.method} ${endpoint.path}`,
        description:
          'Generated from the router. No hand-written `@openapi` block exists ' +
          'for this endpoint yet, so the request and response shapes are not ' +
          'described — read the handler.',
        responses: {
          200: { description: 'Success' },
        },
      };

      // Declare path parameters, without clobbering richer hand-written ones.
      const params = pathParams(endpoint.path);
      if (params.length > 0) {
        const declared = new Set(
          (operation.parameters ?? [])
            .filter((p) => (p as { in?: string }).in === 'path')
            .map((p) => (p as { name?: string }).name)
        );
        const missing = params
          .filter((name) => !declared.has(name))
          .map((name) => ({
            name,
            in: 'path',
            required: true,
            schema: { type: 'string' },
          }));
        if (missing.length > 0) {
          operation.parameters = [...(operation.parameters ?? []), ...missing];
        }
      }

      // Always the walk's answer — see the note above.
      const security = endpoint.guards.flatMap((guard) => SECURITY_BY_GUARD[guard]);
      if (security.length > 0) {
        operation.security = security;
      } else {
        delete operation.security;
      }

      if (!operation.tags || operation.tags.length === 0) {
        operation.tags = [group.title];
      }

      forPath[method] = operation;
    }
  }

  spec.paths = paths;
  spec.tags = buildTags(spec.tags as Array<{ name: string; description?: string }> | undefined);
  return spec;
}

/** Keep the hand-written tag descriptions, add one per router group. */
function buildTags(
  existing: Array<{ name: string; description?: string }> | undefined
): Array<{ name: string; description?: string }> {
  const byName = new Map<string, { name: string; description?: string }>();
  for (const tag of existing ?? []) byName.set(tag.name, tag);
  for (const group of collectRouterGroups()) {
    if (!byName.has(group.title)) {
      byName.set(group.title, { name: group.title, description: group.description });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const swaggerSpec = buildOpenApiSpec();
