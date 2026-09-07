/**
 * Generate docs/API-REFERENCE.md from the actual Express routers.
 *
 * Hand-written endpoint lists rot. `docs/API.md` covers the endpoints a bot
 * would want and stops there; the OpenAPI annotations cover about a third of
 * the surface. Neither tells you what is actually mounted, and neither
 * complains when a route is added.
 *
 * This reads the routers themselves. Every router carries a `stack` of layers:
 * a layer with a `route` is an endpoint, and a layer without one is middleware
 * applied to everything registered after it. That is exactly enough to recover
 * both the path list and which of them are guarded, because `requireAuth` and
 * `validateServerToken` appear in the stack under their own function names —
 * whether applied per-route (`router.get(path, requireAuth, handler)`) or to a
 * whole router (`router.use(requireAuth)`).
 *
 * Usage:
 *   yarn docs:api           # write docs/API-REFERENCE.md
 *   yarn docs:api --check   # exit 1 if the file is stale (used by CI)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { routeTable } from '../api/src/routes/routeTable';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(REPO_ROOT, 'docs', 'API-REFERENCE.md');
const INDEX_TS = path.join(REPO_ROOT, 'api', 'src', 'index.ts');

/** Middleware we recognise, and what it means for a caller. */
const GUARDS: Record<string, string> = {
  requireAuth: 'admin',
  validateServerToken: 'server token',
  validateEventToken: 'server token',
};

interface Endpoint {
  method: string;
  path: string;
  guards: string[];
}

interface Group {
  title: string;
  prefix: string;
  description: string;
  endpoints: Endpoint[];
}

// Express layer internals. Typed loosely on purpose: this is a private shape,
// and pinning it exactly would only turn an Express upgrade into a type error
// instead of the runtime check below, which explains itself far better.
interface Layer {
  name?: string;
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Array<{ name?: string }>;
  };
}

/**
 * Walk one router in registration order.
 *
 * Router-level middleware (`router.use(requireAuth)`) applies to everything
 * registered *after* it, so guards accumulate as we go rather than being read
 * per route. Several routers rely on that — `teams`, `settings` and `servers`
 * guard the whole file with a single `use`, while `matches` guards route by
 * route, and `tournament` and `players` do both, switching partway down.
 */
function walkRouter(router: unknown): Endpoint[] {
  const stack = (router as { stack?: Layer[] }).stack;

  if (!Array.isArray(stack)) {
    throw new Error(
      'Router has no `stack` array. Express changed its internals, so this ' +
        'generator can no longer see the routes and would silently emit an ' +
        'empty reference. Fix the walk in scripts/generate-api-reference.ts.'
    );
  }

  const endpoints: Endpoint[] = [];
  const routerGuards: string[] = [];

  for (const layer of stack) {
    if (!layer.route) {
      // Middleware applied to the rest of this router.
      const guard = layer.name && GUARDS[layer.name];
      if (guard && !routerGuards.includes(guard)) routerGuards.push(guard);
      continue;
    }

    const routeGuards = [...routerGuards];
    for (const handler of layer.route.stack) {
      const guard = handler.name && GUARDS[handler.name];
      if (guard && !routeGuards.includes(guard)) routeGuards.push(guard);
    }

    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const routePath of paths) {
      for (const method of Object.keys(layer.route.methods)) {
        endpoints.push({
          method: method.toUpperCase(),
          path: routePath,
          guards: routeGuards,
        });
      }
    }
  }

  return endpoints;
}

/**
 * Routes declared on the app rather than on a router — `/health` and friends.
 *
 * These are read out of index.ts as text. They are a handful of top-level
 * calls with literal paths, and lifting them into a router purely so this
 * script could import them would be tail-wagging-dog; reading them keeps them
 * in the reference and keeps the drift visible.
 */
function appLevelEndpoints(): Endpoint[] {
  const source = fs.readFileSync(INDEX_TS, 'utf8');
  const pattern = /^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm;
  const endpoints: Endpoint[] = [];

  for (const match of source.matchAll(pattern)) {
    const [, method, routePath] = match;
    // The SPA catch-all is not an API endpoint.
    if (routePath.startsWith('/app')) continue;
    endpoints.push({ method: method.toUpperCase(), path: routePath, guards: [] });
  }

  return endpoints;
}

function describeGuards(guards: string[]): string {
  if (guards.length === 0) return 'public';
  return guards.join(' + ');
}

function renderGroup(group: Group): string {
  if (group.endpoints.length === 0) return '';

  const rows = group.endpoints
    .map((e) => {
      // `/` as a router path means the prefix itself — except in the
      // app-level group, which has no prefix, where `/` is the real path.
      const full = e.path === '/' ? group.prefix || '/' : `${group.prefix}${e.path}`;
      return `| \`${e.method}\` | \`${full}\` | ${describeGuards(e.guards)} |`;
    })
    .join('\n');

  return [
    `### ${group.title}`,
    '',
    group.description,
    '',
    '| Method | Path | Auth |',
    '| --- | --- | --- |',
    rows,
    '',
  ].join('\n');
}

function render(groups: Group[], total: number): string {
  const guarded = groups
    .flatMap((g) => g.endpoints)
    .filter((e) => e.guards.length > 0).length;

  return `<!--
  GENERATED FILE — DO NOT EDIT BY HAND.

  Produced by scripts/generate-api-reference.ts, which walks the real Express
  routers listed in api/src/routes/routeTable.ts. Regenerate with:

      yarn docs:api

  CI fails if this file does not match the routers (yarn docs:api --check).
-->

# API reference

Every endpoint this API serves — ${total} of them, ${guarded} behind auth —
read directly from the routers rather than written down, so it cannot drift.

For *how* to authenticate a bot or script, and a task-oriented tour of the
endpoints worth using, see [API.md](API.md). This file is the index.

## Reading the Auth column

| Value | Meaning |
| --- | --- |
| \`public\` | No credential needed |
| \`admin\` | An admin session, or a service token (\`API_TOKENS\`; \`API_TOKENS_READONLY\` for \`GET\`) |
| \`server token\` | \`X-MatchZy-Token\` — for CS2 game servers, not for bots |

\`public\` means the middleware requires nothing. A few of these still resolve
the caller's identity from a cookie and change what they return, or reject the
action further in — map veto is the notable one, since actions are attributed
to a player. Read the handler before assuming an endpoint is anonymous.

## Endpoints

${groups.map(renderGroup).filter(Boolean).join('\n')}`;
}

function main(): void {
  const check = process.argv.includes('--check');

  const groups: Group[] = [
    {
      title: 'Health and docs',
      prefix: '',
      description: 'Served by the app itself rather than a router.',
      endpoints: appLevelEndpoints(),
    },
    ...routeTable.map((mount) => ({
      title: mount.title,
      prefix: mount.prefix,
      description: mount.description,
      endpoints: walkRouter(mount.router),
    })),
  ];

  const total = groups.reduce((n, g) => n + g.endpoints.length, 0);

  if (total < 100) {
    throw new Error(
      `Only found ${total} endpoints, which is far fewer than this API has. ` +
        'Refusing to write a reference that is almost certainly wrong.'
    );
  }

  const output = render(groups, total);
  const existing = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : null;

  if (check) {
    if (existing === output) {
      console.log(`docs/API-REFERENCE.md is up to date (${total} endpoints).`);
      return;
    }
    console.error(
      'docs/API-REFERENCE.md is out of date with the routers.\n' +
        'Run `yarn docs:api` and commit the result.'
    );
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, output);
  console.log(
    `Wrote docs/API-REFERENCE.md — ${total} endpoints across ${groups.length} groups.`
  );
}

main();
// Importing the routers pulls in services that hold timers and a database
// pool, so the process would otherwise sit there with nothing to do.
process.exit(process.exitCode ?? 0);
