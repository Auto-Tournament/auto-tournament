import fs from 'fs';
import path from 'path';
import { expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, isAdminAuthenticated, signInViaRequest } from './auth';
import { wipeDatabase } from './database';

/**
 * Golden-file (characterization) helpers.
 *
 * A golden spec records what the app does today and fails when that changes.
 * Goldens live in tests/fixtures/golden/ and are regenerated with
 *
 *   UPDATE_GOLDEN=1 yarn test:manual tests/api/<spec>.spec.ts
 *
 * Review the diff of the regenerated file before committing it: a changed
 * golden is a behaviour change and needs a reason in the PR.
 */

export const GOLDEN_DIR = path.resolve(__dirname, '../fixtures/golden');

export const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === '1';

/** Placeholder names for values that change from run to run. */
export interface SnapshotPlaceholders {
  /**
   * String values to replace wherever they appear (whole value or inside a
   * longer string). Only use distinctive values (generated ids, tokens):
   * a short value like "1" would be replaced inside unrelated strings.
   * Numbers are never replaced; give numeric ids a placeholder in the spec.
   */
  replace?: Record<string, string>;
  /** Keys whose value is always replaced by `<key>`, however deep. */
  volatileKeys?: string[];
}

/**
 * Keys that hold a wall-clock time or an auto-generated id. Whatever their
 * value, it is replaced by `<key>` (or `null` stays `null`, so "was it set"
 * is still recorded).
 */
const DEFAULT_VOLATILE_KEYS = [
  'created_at',
  'updated_at',
  'completed_at',
  'started_at',
  'loaded_at',
  'received_at',
  'createdAt',
  'updatedAt',
  'completedAt',
  'startedAt',
  'loadedAt',
  'timestamp',
];

/**
 * THE normaliser for golden snapshots. Everything non-deterministic goes
 * through here, so a golden diff always means behaviour changed:
 *
 * - timestamps (see DEFAULT_VOLATILE_KEYS plus `volatileKeys`) become `<key>`,
 *   or stay `null` when unset;
 * - exact values listed in `replace` (generated ids, the API origin, tokens,
 *   admin Steam IDs, random picks) become their placeholder, both as whole
 *   values and inside longer strings such as URLs;
 * - anything that looks like an ISO date string becomes `<iso-date>`;
 * - the API origin (http://localhost:<port>) becomes `<origin>`.
 *
 * Object keys are sorted so the file is stable to diff; arrays keep their order.
 */
export function normalizeForGolden<T>(value: T, placeholders: SnapshotPlaceholders = {}): T {
  const volatile = new Set([...DEFAULT_VOLATILE_KEYS, ...(placeholders.volatileKeys ?? [])]);
  const replacements = Object.entries(placeholders.replace ?? {})
    // Longest first so a value that contains another is replaced whole.
    .sort(([a], [b]) => b.length - a.length);

  const normalizeString = (input: string): string => {
    let out = input;
    for (const [from, to] of replacements) {
      if (from && out.includes(from)) out = out.split(from).join(to);
    }
    out = out.replace(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/g, '<origin>');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(out)) return '<iso-date>';
    return out;
  };

  const walk = (node: unknown, key?: string): unknown => {
    if (key !== undefined && volatile.has(key)) {
      return node === null || node === undefined ? node : `<${key}>`;
    }
    if (typeof node === 'string') return normalizeString(node);
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(node as Record<string, unknown>).sort()) {
        out[normalizeString(k)] = walk((node as Record<string, unknown>)[k], k);
      }
      return out;
    }
    return node;
  };

  return walk(value) as T;
}

/**
 * Compare `actual` with tests/fixtures/golden/<name>.json, or write it when
 * UPDATE_GOLDEN=1. `actual` must already be normalised.
 */
export function expectGolden(name: string, actual: unknown): void {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const serialized = `${JSON.stringify(actual, null, 2)}\n`;

  if (UPDATE_GOLDEN) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, serialized);
    return;
  }

  expect(
    fs.existsSync(file),
    `Golden file ${path.relative(process.cwd(), file)} is missing. ` +
      'Run the spec with UPDATE_GOLDEN=1 to create it, then review and commit it.'
  ).toBe(true);

  const expected = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  // Round-trip so `undefined` fields compare the way they would be stored.
  expect(
    JSON.parse(serialized),
    `Behaviour differs from golden ${name}.json. If the change is intended, ` +
      'regenerate with UPDATE_GOLDEN=1 and explain the diff in the PR.'
  ).toEqual(expected);
}

/**
 * Wipe the database and sign back in as admin.
 *
 * Golden specs start from an empty database so settings, admin rows and
 * auto-increment ids do not depend on which specs ran earlier on the shard.
 */
export async function resetDatabaseForGolden(request: APIRequestContext): Promise<void> {
  expect(await signInViaRequest(request), 'admin sign-in before reset').toBe(true);
  expect(await wipeDatabase(request), 'database reset').toBe(true);

  // The reset drops the admin's players row and the session table; sign in
  // again until the API agrees we are admin (see signIn in helpers/auth.ts).
  await expect
    .poll(
      async () => {
        await signInViaRequest(request);
        return isAdminAuthenticated(request);
      },
      { message: 'admin session after database reset', timeout: 15_000, intervals: [250, 500] }
    )
    .toBe(true);
}

/** POST JSON as admin and fail with the response body on error. */
export async function postOk<T = unknown>(
  request: APIRequestContext,
  url: string,
  data: unknown
): Promise<T> {
  const res = await request.post(url, { headers: getAuthHeader(), data });
  expect(res.ok(), `POST ${url} failed (${res.status()}): ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** GET JSON as admin and fail with the response body on error. */
export async function getOk<T = unknown>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url, { headers: getAuthHeader() });
  expect(res.ok(), `GET ${url} failed (${res.status()}): ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}
