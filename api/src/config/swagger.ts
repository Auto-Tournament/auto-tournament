import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'fs';
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
export function buildOpenApiSpec(
  overrides: { serverUrl?: string } = {}
): Record<string, unknown> {
  const spec = swaggerJsdoc(options) as Record<string, unknown> & {
    paths?: PathsObject;
    servers?: Array<{ url: string; description?: string }>;
  };
  const paths: PathsObject = spec.paths ?? {};

  // The committed copy of this spec must not carry whoever generated it's local
  // URL — see PORTABLE_SERVER_URL.
  if (overrides.serverUrl) {
    spec.servers = [
      {
        url: overrides.serverUrl,
        description: 'Your MAT instance. Replace with its base URL.',
      },
    ];
  }

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

  spec.paths = sortPaths(paths);
  spec.tags = buildTags(spec.tags as Array<{ name: string; description?: string }> | undefined);
  return spec;
}

/**
 * Server URL for the committed `docs/openapi.json`.
 *
 * The live spec advertises the instance's own URL, resolved from
 * `API_BASE_URL` / `FRONTEND_BASE_URL`, which is what makes Swagger UI's
 * "Try it" button work. That value must not reach the committed file: it is
 * read from whichever `.env` happened to be in the working directory, so the
 * generated bytes would depend on the developer who ran the generator, and CI
 * — which has no `.env` — would reject every regeneration but its own.
 *
 * MAT's documented default port, so it is a sensible thing to point at rather
 * than an obvious placeholder that nobody can use.
 */
export const PORTABLE_SERVER_URL = 'http://localhost:3069';

/** The order operations are conventionally read in, rather than alphabetical. */
const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

/**
 * Sort paths and the operations under them.
 *
 * Not cosmetic: `docs/openapi.json` is committed and CI fails when it does not
 * match a fresh build. swagger-jsdoc collects annotations by globbing the route
 * files, and a glob returns them in filesystem order — which is not the same on
 * APFS as on the ext4 that CI runs on. Key insertion order therefore differed
 * between a developer's machine and the runner, and `JSON.stringify` preserves
 * insertion order, so the bytes differed for a spec that was otherwise
 * identical. Sorting removes the dependency, and makes the diffs readable.
 */
function sortPaths(paths: PathsObject): PathsObject {
  const sorted: PathsObject = {};

  for (const routePath of Object.keys(paths).sort()) {
    const operations = paths[routePath];
    const ordered: Record<string, OperationObject> = {};

    for (const method of Object.keys(operations).sort((a, b) => {
      const ai = METHOD_ORDER.indexOf(a);
      const bi = METHOD_ORDER.indexOf(b);
      // Anything unrecognised sorts after the known verbs, alphabetically.
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })) {
      ordered[method] = operations[method];
    }

    sorted[routePath] = ordered;
  }

  return sorted;
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

/**
 * Where the committed spec might be, relative to this file.
 *
 * Two layouts: running from source (`api/src/config`), and the release image,
 * where the backend is bundled to `/app/dist` and the spec is copied to
 * `/app/docs`.
 */
const COMMITTED_SPEC_CANDIDATES = [
  // Running from source: api/src/config -> repo root.
  path.resolve(__dirname, '..', '..', '..', 'docs', 'openapi.json'),
  // Release image: the backend is bundled to /app/dist/index.js, so __dirname
  // is /app/dist and the spec sits beside it at /app/docs.
  path.resolve(__dirname, '..', 'docs', 'openapi.json'),
];

/**
 * The spec this instance serves.
 *
 * Prefer the committed `docs/openapi.json`, and fall back to building one.
 *
 * The fallback exists because the release image contains `dist/index.js`, not
 * `api/src/**.ts` — so swagger-jsdoc's globs match nothing there and every
 * hand-written description, request body and response schema disappears. A
 * production Swagger UI was therefore a skeleton: correct about which endpoints
 * exist and silent about all of them. The committed file has that detail, is
 * generated from these same routers, and CI will not let it drift, so shipping
 * it is strictly better than rebuilding a worse one at boot.
 *
 * The one thing not taken from the file is `servers`: the committed copy pins a
 * portable URL so its bytes are reproducible, which would point Swagger UI's
 * "Try it" button at the wrong host. That is replaced with this instance's own.
 */
function resolveOpenApiSpec(): Record<string, unknown> {
  for (const candidate of COMMITTED_SPEC_CANDIDATES) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const spec = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Record<string, unknown>;
      spec.servers = [{ url: swaggerServerUrl, description: 'This instance' }];
      return spec;
    } catch {
      // Unreadable or malformed: fall through and build one rather than
      // refusing to start over a documentation file.
    }
  }

  return buildOpenApiSpec();
}

let cachedSpec: Record<string, unknown> | null = null;

/**
 * Lazy so that merely importing this module — as the docs generator does, for
 * `buildOpenApiSpec` — does not read a spec file it is about to rewrite.
 */
export function getOpenApiSpec(): Record<string, unknown> {
  cachedSpec ??= resolveOpenApiSpec();
  return cachedSpec;
}
