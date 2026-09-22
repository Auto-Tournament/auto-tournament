/**
 * Generate docs/API-REFERENCE.md and docs/openapi.json from the actual routers.
 *
 * Hand-written endpoint lists rot. `docs/API.md` covers the endpoints a bot
 * would want and stops there; the `@openapi` annotations cover about a third of
 * the surface. Neither tells you what is actually mounted, and neither
 * complains when a route is added.
 *
 * Both outputs come from the same walk (`utils/routeIntrospection`), which is
 * also what the running server uses to build /api-docs.json — so the Markdown,
 * the committed spec and the live spec cannot disagree.
 *
 * The committed `openapi.json` is the point of contact for anything outside
 * this repo: generate a typed client from it, in any language, without needing
 * a MAT instance to point at.
 *
 * Usage:
 *   yarn docs:api           # write both files
 *   yarn docs:api --check   # exit 1 if either is stale (used by CI)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  collectRouterGroups,
  describeGuards,
  type Endpoint,
  type EndpointGroup,
} from '../api/src/utils/routeIntrospection';
import { PORTABLE_SERVER_URL, buildOpenApiSpec } from '../api/src/config/swagger';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKDOWN_OUT = path.join(REPO_ROOT, 'docs', 'API-REFERENCE.md');
const OPENAPI_OUT = path.join(REPO_ROOT, 'docs', 'openapi.json');
const INDEX_TS = path.join(REPO_ROOT, 'api', 'src', 'index.ts');

/**
 * Routes declared on the app rather than on a router — `/health` and friends.
 *
 * These are read out of index.ts as text. They are a handful of top-level calls
 * with literal paths, and lifting them into a router purely so this script
 * could import them would be tail-wagging-dog. (The OpenAPI side does not need
 * this: they already carry `@openapi` blocks, which swagger-jsdoc picks up.)
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

function renderGroup(group: EndpointGroup): string {
  if (group.endpoints.length === 0) return '';

  const rows = group.endpoints
    .map((e) => {
      const auth = e.shadowed
        ? `~~${describeGuards(e.guards)}~~ **shadowed**`
        : describeGuards(e.guards);
      return `| \`${e.method}\` | \`${e.path}\` | ${auth} |`;
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

function renderMarkdown(groups: EndpointGroup[], total: number): string {
  const all = groups.flatMap((g) => g.endpoints);
  const guarded = all.filter((e) => e.guards.length > 0 && !e.shadowed).length;
  const shadowed = all.filter((e) => e.shadowed);

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
endpoints worth using, see [API.md](API.md). To generate a client, use
[openapi.json](openapi.json) — same walk, machine-readable.

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

**shadowed** marks a registration that never runs: the same method and path was
registered earlier, and Express matches in registration order. It is dead code,
and the dangerous kind — it reads as though it were in force. Where a shadowed
row claims different auth from the row above it, the row above is what answers.
${
  shadowed.length === 0
    ? ''
    : `\nCurrently shadowed:\n\n${shadowed
        .map((e) => `- \`${e.method} ${e.path}\``)
        .join('\n')}\n`
}
## Endpoints

${groups.map(renderGroup).filter(Boolean).join('\n')}`;
}

/**
 * Structural sanity check on the spec before it is written.
 *
 * Deliberately dependency-free rather than pulling in a full OpenAPI validator:
 * the failure modes that actually happen here are a walk that silently returns
 * nothing, an Express-style `:param` leaking into a path, and a path parameter
 * used but not declared — which makes generated clients fail at runtime rather
 * than at codegen. A schema validator catches the first two and is quiet about
 * the third.
 */
function assertSpecIsSound(spec: Record<string, unknown>): void {
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
  const problems: string[] = [];

  if (Object.keys(paths).length === 0) {
    problems.push('the spec has no paths at all');
  }

  for (const [routePath, operations] of Object.entries(paths)) {
    if (!routePath.startsWith('/')) {
      problems.push(`path "${routePath}" does not start with "/"`);
    }
    if (routePath.includes(':')) {
      problems.push(
        `path "${routePath}" uses Express-style ":param" — OpenAPI wants "{param}". ` +
          'An `@openapi` block is probably written with the wrong syntax.'
      );
    }

    const templated = [...routePath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

    for (const [method, operation] of Object.entries(operations)) {
      const op = operation as { parameters?: Array<Record<string, unknown>> };
      const declared = new Set(
        (op.parameters ?? [])
          .filter((param) => param.in === 'path')
          .map((param) => param.name as string)
      );
      for (const name of templated) {
        if (!declared.has(name)) {
          problems.push(`${method.toUpperCase()} ${routePath}: path parameter "${name}" is not declared`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to write a malformed OpenAPI spec:\n  - ${problems.join('\n  - ')}`
    );
  }
}

function main(): void {
  const check = process.argv.includes('--check');

  const groups: EndpointGroup[] = [
    {
      title: 'Health and docs',
      prefix: '',
      description: 'Served by the app itself rather than a router.',
      endpoints: appLevelEndpoints(),
    },
    ...collectRouterGroups(),
  ];

  const total = groups.reduce((n, g) => n + g.endpoints.length, 0);

  if (total < 100) {
    throw new Error(
      `Only found ${total} endpoints, which is far fewer than this API has. ` +
        'Refusing to write a reference that is almost certainly wrong.'
    );
  }

  const markdown = renderMarkdown(groups, total);

  // Pinned rather than taken from the environment: this file is committed, so
  // it must be identical whoever regenerates it. See PORTABLE_SERVER_URL.
  const specObject = buildOpenApiSpec({ serverUrl: PORTABLE_SERVER_URL });
  assertSpecIsSound(specObject);
  const spec = `${JSON.stringify(specObject, null, 2)}\n`;

  const outputs: Array<{ file: string; content: string; label: string }> = [
    { file: MARKDOWN_OUT, content: markdown, label: 'docs/API-REFERENCE.md' },
    { file: OPENAPI_OUT, content: spec, label: 'docs/openapi.json' },
  ];

  if (check) {
    const stale = outputs.filter(
      (o) => !fs.existsSync(o.file) || fs.readFileSync(o.file, 'utf8') !== o.content
    );

    if (stale.length === 0) {
      console.log(`API docs are up to date (${total} endpoints).`);
      return;
    }

    console.error(
      `Out of date with the routers: ${stale.map((o) => o.label).join(', ')}.\n` +
        'Run `yarn docs:api` and commit the result.'
    );
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(MARKDOWN_OUT), { recursive: true });
  for (const output of outputs) fs.writeFileSync(output.file, output.content);

  console.log(
    `Wrote docs/API-REFERENCE.md and docs/openapi.json — ${total} endpoints ` +
      `across ${groups.length} groups.`
  );
}

main();
// Importing the routers pulls in services that hold timers and a database pool,
// so the process would otherwise sit there with nothing to do.
process.exit(process.exitCode ?? 0);
