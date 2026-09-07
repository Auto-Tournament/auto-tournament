import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { collectRouterGroups, toOpenApiPath } from '../../api/src/utils/routeIntrospection';

/**
 * The OpenAPI spec, against the routers it claims to describe.
 *
 * The spec is the contract anything outside this repo builds against — a bot
 * generates a typed client from it. An incomplete spec is a bot that cannot
 * call an endpoint that exists; a spec with the wrong `security` is worse,
 * because a client is generated that omits a credential and 401s at runtime for
 * no visible reason.
 *
 * @tag api
 * @tag docs
 */

const COMMITTED = path.join(__dirname, '..', '..', 'docs', 'openapi.json');

interface Spec {
  paths: Record<string, Record<string, { security?: Array<Record<string, string[]>> }>>;
  components?: { securitySchemes?: Record<string, unknown> };
}

function operationKeys(spec: Spec): string[] {
  return Object.entries(spec.paths)
    .flatMap(([p, methods]) => Object.keys(methods).map((m) => `${m} ${p}`))
    .sort();
}

/** Every route that actually answers — shadowed registrations never run. */
function liveRouterEndpoints() {
  return collectRouterGroups()
    .flatMap((g) => g.endpoints)
    .filter((e) => !e.shadowed);
}

test.describe('OpenAPI spec', () => {
  test('describes every endpoint the routers mount', {
    tag: ['@api', '@docs'],
  }, async ({ request }) => {
    const response = await request.get('/api-docs.json');
    expect(response.ok()).toBeTruthy();
    const spec = (await response.json()) as Spec;

    const documented = new Set(operationKeys(spec));
    const missing = liveRouterEndpoints()
      .map((e) => `${e.method.toLowerCase()} ${toOpenApiPath(e.path)}`)
      .filter((key) => !documented.has(key));

    expect(missing, 'every mounted route should appear in the spec').toEqual([]);
  });

  test('the committed spec matches what the server serves', {
    tag: ['@api', '@docs'],
  }, async ({ request }) => {
    // Otherwise the file people generate clients from drifts from the API,
    // which is the exact failure this whole approach exists to prevent.
    const live = (await (await request.get('/api-docs.json')).json()) as Spec;
    const committed = JSON.parse(fs.readFileSync(COMMITTED, 'utf8')) as Spec;

    expect(operationKeys(committed)).toEqual(operationKeys(live));
  });

  test('admin endpoints declare a security requirement', {
    tag: ['@api', '@docs'],
  }, async ({ request }) => {
    const spec = (await (await request.get('/api-docs.json')).json()) as Spec;

    const unguarded = liveRouterEndpoints()
      .filter((e) => e.guards.includes('admin'))
      .filter((e) => {
        const op = spec.paths[toOpenApiPath(e.path)]?.[e.method.toLowerCase()];
        return !op?.security || op.security.length === 0;
      })
      .map((e) => `${e.method} ${e.path}`);

    expect(unguarded, 'admin-guarded routes must declare security').toEqual([]);
  });

  test('a public endpoint is not marked as requiring auth', {
    tag: ['@api', '@docs'],
  }, async ({ request }) => {
    const spec = (await (await request.get('/api-docs.json')).json()) as Spec;

    // Genuinely public and heavily used by bots — if this grew a security
    // requirement, generated clients would start demanding a token for it.
    expect(spec.paths['/api/matches']?.get?.security).toBeUndefined();
  });

  test('a shadowed route is described by the registration that actually runs', {
    tag: ['@api', '@docs'],
  }, async ({ request }) => {
    const spec = (await (await request.get('/api-docs.json')).json()) as Spec;

    // GET /api/tournament/:id/leaderboard is registered twice — once before
    // router.use(requireAuth) and once after. Express answers with the first,
    // so the spec must say public. Describing the shadowed one would tell every
    // generated client to send a credential the endpoint never asks for.
    const op = spec.paths['/api/tournament/{id}/leaderboard']?.get;
    expect(op, 'the leaderboard should be in the spec').toBeTruthy();
    expect(op?.security).toBeUndefined();

    const response = await request.get('/api/tournament/1/leaderboard');
    expect(response.status(), 'and it should really answer without auth').not.toBe(401);
  });

  test('the committed spec is byte-stable across machines', {
    tag: ['@api', '@docs'],
  }, async () => {
    // docs/openapi.json is committed and CI rejects a mismatch, so its bytes
    // must not depend on who generated it. Two things made them depend on that,
    // and both are easy to reintroduce:
    //
    //  1. swagger-jsdoc collects annotations by globbing the route files, and a
    //     glob returns them in filesystem order — different on APFS and ext4.
    //     Key insertion order leaked into JSON.stringify, so a spec that was
    //     otherwise identical produced different bytes on CI.
    //  2. The server URL is resolved from API_BASE_URL / FRONTEND_BASE_URL,
    //     read from whatever .env sat in the working directory.
    const committed = JSON.parse(fs.readFileSync(COMMITTED, 'utf8')) as Spec & {
      servers?: Array<{ url: string }>;
    };

    const paths = Object.keys(committed.paths);
    expect(paths, 'path keys must be sorted, not in glob order').toEqual([...paths].sort());

    expect(
      committed.servers?.[0]?.url,
      'the committed spec must carry the pinned URL, not a local one'
    ).toBe('http://localhost:3069');
  });

  test('every security scheme a path references is defined', {
    tag: ['@api', '@docs'],
  }, async ({ request }) => {
    const spec = (await (await request.get('/api-docs.json')).json()) as Spec;
    const defined = new Set(Object.keys(spec.components?.securitySchemes ?? {}));

    const dangling = new Set<string>();
    for (const methods of Object.values(spec.paths)) {
      for (const op of Object.values(methods)) {
        for (const requirement of op.security ?? []) {
          for (const name of Object.keys(requirement)) {
            if (!defined.has(name)) dangling.add(name);
          }
        }
      }
    }

    expect([...dangling], 'security schemes must be declared in components').toEqual([]);
  });
});
