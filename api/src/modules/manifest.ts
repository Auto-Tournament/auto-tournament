/**
 * `module.json`: what a code module on disk says about itself, and the checks
 * the loader runs on it before any of the module's code is imported.
 *
 *   DATA_DIR/modules/<id>/
 *     module.json       { id, name, version, serverApi, clientApi, server, client? }
 *     server/index.js   default export: a GameIntegration
 *     client/index.js   ESM bundle for the web client (optional)
 *
 * Pure: no filesystem, no registry, no database. The loader
 * (`modules/loader.ts`) reads the file and hands the parsed JSON here.
 */

import semver from 'semver';
import { CLIENT_API_VERSION, SERVER_API_VERSION } from './version';

/**
 * A module id: lowercase letters and digits, in groups joined by single
 * hyphens. The id is the module's folder name and a URL path segment, so
 * anything else — above all `.`, `/` and `\` — is refused before it gets near
 * a path.
 */
export const MODULE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MODULE_ID_MAX_LENGTH = 64;

export function isValidModuleId(id: unknown): boolean {
  return typeof id === 'string' && id.length <= MODULE_ID_MAX_LENGTH && MODULE_ID_PATTERN.test(id);
}

/** One path segment of an entry: no `.`/`..`, no separators, no oddities. */
const ENTRY_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * A relative path inside the module folder, in `/`-separated segments that are
 * each plain names. Refuses absolute paths, `..`, `.`, backslashes, empty
 * segments and anything outside that alphabet, so a manifest cannot point the
 * loader outside its own folder whatever the platform's path rules are.
 */
export function isSafeEntryPath(value: string): boolean {
  if (value.length === 0 || value.length > 200) return false;
  return value.split('/').every((segment) => ENTRY_SEGMENT.test(segment) && !/^\.+$/.test(segment));
}

export interface ModuleManifest {
  id: string;
  name: string;
  /** The module's own version, strict semver. */
  version: string;
  /** Range of server API versions the module works with. */
  serverApi: string;
  /** Range of client API versions the module works with. */
  clientApi: string;
  /** Server entry, relative to the module folder, e.g. `server/index.js`. */
  server: string;
  /** Client entry, relative to the module folder and under `client/`, or null. */
  client: string | null;
}

export type ManifestResult = { ok: true; manifest: ModuleManifest } | { ok: false; reason: string };

const SERVER_ENTRY_EXT = /\.(?:m|c)?js$/;
const CLIENT_ENTRY_EXT = /\.m?js$/;

function fail(reason: string): ManifestResult {
  return { ok: false, reason: `module.json: ${reason}` };
}

function isRange(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && semver.validRange(value) !== null;
}

/**
 * Validate a parsed `module.json` found in the folder `folder`.
 *
 * Strict on every field it defines: types, the id alphabet, a real semver
 * version and real semver ranges, and entry paths that stay inside the
 * module folder. Keys it does not define are left for the parts of the module
 * system that own them (migrations, locales) and are not an error.
 */
export function parseManifest(raw: unknown, folder: string): ManifestResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('must be a JSON object');
  }
  const m = raw as Record<string, unknown>;

  if (typeof m.id !== 'string') return fail("'id' is required and must be a string");
  if (!isValidModuleId(m.id)) {
    return fail(
      `'id' '${m.id.slice(0, 80)}' is not a valid module id: use lowercase letters, digits and single hyphens (at most ${MODULE_ID_MAX_LENGTH} characters)`
    );
  }
  if (m.id !== folder) {
    return fail(`'id' is '${m.id}' but the module's folder is '${folder}'; they must match`);
  }

  if (typeof m.name !== 'string' || m.name.trim() === '' || m.name.length > 100) {
    return fail("'name' is required: a non-empty string of at most 100 characters");
  }

  if (typeof m.version !== 'string' || semver.valid(m.version) === null) {
    return fail("'version' must be a semver version, such as 1.0.0");
  }

  if (!isRange(m.serverApi)) {
    return fail("'serverApi' must be a semver range, such as ^0.1.0");
  }
  if (!isRange(m.clientApi)) {
    return fail("'clientApi' must be a semver range, such as ^0.1.0");
  }

  if (typeof m.server !== 'string' || !isSafeEntryPath(m.server) || !SERVER_ENTRY_EXT.test(m.server)) {
    return fail(
      "'server' must be a .js, .mjs or .cjs file inside the module folder, such as server/index.js"
    );
  }
  // Everything under client/ is served to any browser; server code must not be.
  if (m.server.split('/')[0] === 'client') {
    return fail("'server' must not be under client/: that folder is served to browsers");
  }

  let client: string | null = null;
  if (m.client !== undefined && m.client !== null) {
    if (
      typeof m.client !== 'string' ||
      !isSafeEntryPath(m.client) ||
      m.client.split('/')[0] !== 'client' ||
      m.client.split('/').length < 2 ||
      !CLIENT_ENTRY_EXT.test(m.client)
    ) {
      return fail("'client' must be a .js or .mjs file under client/, such as client/index.js");
    }
    client = m.client;
  }

  return {
    ok: true,
    manifest: {
      id: m.id,
      name: m.name.trim(),
      version: m.version,
      serverApi: m.serverApi,
      clientApi: m.clientApi,
      server: m.server,
      client,
    },
  };
}

/**
 * Why this platform cannot run the module, or null when it can: its
 * `serverApi` range must include `SERVER_API_VERSION`, and when it has a
 * client half, its `clientApi` range must include `CLIENT_API_VERSION`.
 */
export function compatibilityProblem(
  manifest: Pick<ModuleManifest, 'serverApi' | 'clientApi' | 'client'>,
  versions: { serverApi: string; clientApi: string } = {
    serverApi: SERVER_API_VERSION,
    clientApi: CLIENT_API_VERSION,
  }
): string | null {
  if (!semver.satisfies(versions.serverApi, manifest.serverApi)) {
    return `Built for server API ${manifest.serverApi}; this platform provides ${versions.serverApi}.`;
  }
  if (manifest.client !== null && !semver.satisfies(versions.clientApi, manifest.clientApi)) {
    return `Built for client API ${manifest.clientApi}; this platform provides ${versions.clientApi}.`;
  }
  return null;
}
