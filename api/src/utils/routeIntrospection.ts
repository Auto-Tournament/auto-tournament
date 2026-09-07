/**
 * Reading the routes off the routers themselves.
 *
 * Every Express router carries a `stack` of layers: a layer with a `route` is
 * an endpoint, and a layer without one is middleware applied to everything
 * registered after it. That is enough to recover both the path list and which
 * endpoints are guarded, because the auth middleware appears in the stack under
 * its own function name — whether applied per-route
 * (`router.get(path, requireAuth, handler)`) or to a whole router
 * (`router.use(requireAuth)`).
 *
 * Two things consume this, and they must not disagree:
 *   - `scripts/generate-api-reference.ts` → docs/API-REFERENCE.md
 *   - `config/swagger` → the OpenAPI spec at /api-docs.json
 *
 * Hence one walk, here, rather than one in each.
 */

import { routeTable } from '../routes/routeTable';

/** What a caller has to present. */
export type Guard = 'admin' | 'server token';

/** Middleware function names we recognise, and what they mean for a caller. */
const GUARD_BY_MIDDLEWARE: Record<string, Guard> = {
  requireAuth: 'admin',
  validateServerToken: 'server token',
  validateEventToken: 'server token',
};

export interface Endpoint {
  method: string;
  /** Full path including the mount prefix, in Express form (`/api/teams/:id`). */
  path: string;
  guards: Guard[];
  /**
   * True when an identical method+path was registered earlier and therefore
   * always wins. Express matches in registration order, so a shadowed route is
   * dead code — and a dangerous kind, because it reads as if it were in force.
   *
   * `GET /api/tournament/:id/leaderboard` is registered twice: once before
   * `router.use(requireAuth)` and once after. The second looks admin-guarded
   * and never runs, so the endpoint is public.
   */
  shadowed?: boolean;
}

export interface EndpointGroup {
  title: string;
  description: string;
  prefix: string;
  endpoints: Endpoint[];
}

// Express layer internals. Typed loosely on purpose: this is a private shape,
// and pinning it exactly would turn an Express upgrade into a type error rather
// than the runtime check in `walkRouter`, which explains itself far better.
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
 * Router-level middleware applies to everything registered *after* it, so
 * guards accumulate as we go rather than being read per route. Several routers
 * rely on that: `teams`, `settings` and `servers` guard the whole file with a
 * single `use`, `matches` guards route by route, and `tournament` and `players`
 * do both — switching partway down the file.
 */
export function walkRouter(router: unknown, prefix = ''): Endpoint[] {
  const stack = (router as { stack?: Layer[] }).stack;

  if (!Array.isArray(stack)) {
    throw new Error(
      'Router has no `stack` array. Express changed its internals, so route ' +
        'introspection can no longer see the routes and would silently report ' +
        'an empty API. Fix the walk in utils/routeIntrospection.ts.'
    );
  }

  const endpoints: Endpoint[] = [];
  const routerGuards: Guard[] = [];

  for (const layer of stack) {
    if (!layer.route) {
      const guard = layer.name ? GUARD_BY_MIDDLEWARE[layer.name] : undefined;
      if (guard && !routerGuards.includes(guard)) routerGuards.push(guard);
      continue;
    }

    const routeGuards: Guard[] = [...routerGuards];
    for (const handler of layer.route.stack) {
      const guard = handler.name ? GUARD_BY_MIDDLEWARE[handler.name] : undefined;
      if (guard && !routeGuards.includes(guard)) routeGuards.push(guard);
    }

    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const routePath of paths) {
      // `/` as a router path means the mount prefix itself.
      const full = routePath === '/' ? prefix || '/' : `${prefix}${routePath}`;
      for (const method of Object.keys(layer.route.methods)) {
        endpoints.push({ method: method.toUpperCase(), path: full, guards: routeGuards });
      }
    }
  }

  return endpoints;
}

/**
 * Every mounted router, walked, in mount order, with shadowed routes marked.
 *
 * Shadowing is resolved across the whole table rather than per router:
 * `/api/servers` has three routers on the same prefix, so a route in a later
 * one can be shadowed by an earlier one just as easily as by a sibling.
 */
export function collectRouterGroups(): EndpointGroup[] {
  const seen = new Set<string>();

  return routeTable.map((mount) => ({
    title: mount.title,
    description: mount.description,
    prefix: mount.prefix,
    endpoints: walkRouter(mount.router, mount.prefix).map((endpoint) => {
      const key = `${endpoint.method} ${endpoint.path}`;
      if (seen.has(key)) return { ...endpoint, shadowed: true };
      seen.add(key);
      return endpoint;
    }),
  }));
}

/** Express `/api/teams/:id` → OpenAPI `/api/teams/{id}`. */
export function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Path parameter names, in order of appearance. */
export function pathParams(expressPath: string): string[] {
  return [...expressPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

export function describeGuards(guards: Guard[]): string {
  return guards.length === 0 ? 'public' : guards.join(' + ');
}
