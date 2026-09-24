/**
 * Code modules on disk: `DATA_DIR/modules/<id>/`, scanned at boot
 * (DESIGN-modules §4.1, items 7 and 9 of §6).
 *
 * A code module is a `GameIntegration` built outside this repo. It gets into
 * `DATA_DIR/modules/` one of two ways, and is **never uploaded**:
 *
 * - from the game catalog (`catalogService.ts`, DESIGN-modules §10): a
 *   release signed with a key compiled into the platform, from our GitHub or
 *   the image's offline snapshot. A stolen admin session can install our
 *   signed code and nothing else, so it still cannot become arbitrary code
 *   execution on the host.
 * - by hand: an operator drops the folder in, which takes the same access as
 *   editing `.env`. Such a module starts disabled.
 *
 * At boot, for each folder:
 *
 *   1. the folder name must be a valid module id (`manifest.ts`);
 *   2. `module.json` must parse and validate, and its id must be the folder's;
 *   3. the id must not be a built-in module's;
 *   4. its `serverApi` (and `clientApi`, if it has a client half) range must
 *      include this platform's version, or it is `incompatible`;
 *   5. an operator-placed module starts disabled, and a disabled one stops
 *      here: it is listed, but none of its code runs;
 *   6. the server entry is imported, its default export checked as a
 *      `GameIntegration` whose id is the manifest's, and not already taken;
 *   7. its migrations run (item 5, see the TODO below), then its seed;
 *   8. it is registered with `registerIntegration`, and its legacy routes
 *      mounted.
 *
 * Any step that fails marks that module `incompatible` or `broken` with the
 * reason, and the scan goes on to the next one. **The platform always boots.**
 *
 * Enabling or disabling a module takes effect on the next boot: a loaded Node
 * module cannot be cleanly unloaded, and pretending otherwise would leave its
 * routes, timers and registry entry behind. The API says so
 * (`restartRequired`).
 *
 * There is no sandbox. A module's server code runs in this process with the
 * database and the filesystem, exactly as trusted as the image.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { Router } from 'express';
import { DATA_DIR } from '../config/dataDir';
import { db } from '../config/database';
import { runModuleMigrations } from '../config/moduleMigrations';
import { log } from '../utils/logger';
import { hasIntegration, listIntegrations, registerIntegration } from '../integrations/registry';
import type { GameIntegration, LegacyRouteMount } from '../integrations/types';
import packageJson from '../../package.json';
import {
  compatibilityProblem,
  isValidModuleId,
  parseManifest,
  type ModuleManifest,
} from './manifest';
import { integrationFromNamespace, integrationProblem } from './validateIntegration';

export type ModuleStatus = 'ok' | 'incompatible' | 'broken' | 'disabled';

/** One row of `GET /api/modules`. */
export interface ModuleListing {
  id: string;
  name: string;
  version: string;
  source: 'builtin' | 'disk';
  clientApi: string | null;
  serverApi: string | null;
  enabled: boolean;
  status: ModuleStatus;
  reason: string | null;
  /** The client entry's URL, for a loaded, enabled module that has one. */
  client: { entry: string } | null;
}

/** What the last scan found in one folder. `status: 'ok'` means loaded. */
interface DiskModule {
  folder: string;
  dir: string;
  manifest: ModuleManifest | null;
  status: ModuleStatus;
  reason: string | null;
}

/** How long a server entry may take to import before it is given up on. */
const IMPORT_TIMEOUT_MS = 10_000;

/** `app_settings` key holding a disk module's enabled flag. */
export const MODULE_ENABLED_KEY_PREFIX = 'module_enabled:';

export function modulesDir(): string {
  return path.join(DATA_DIR, 'modules');
}

/** Every folder the last scan saw, by folder name. */
const diskModules = new Map<string, DiskModule>();

/** Ids of the integrations this loader registered, as opposed to built-ins. */
const loadedFromDisk = new Set<string>();

/**
 * Where disk modules' legacy routes are mounted. `index.ts` mounts this
 * router once, after the core routes and before the SPA and the 404 handler,
 * so routes added to it after boot are still reached.
 */
export const diskModuleRoutes = Router();

class ModuleLoadError extends Error {}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/** The ids of the modules compiled into this image (CS2, manual-report, …). */
function builtinIntegrations(): GameIntegration[] {
  return listIntegrations().filter((integration) => !loadedFromDisk.has(integration.id));
}

// ---------------------------------------------------------------------------
// Enabled state
// ---------------------------------------------------------------------------

/**
 * The stored switches, read from `app_settings` once and then kept in step by
 * every write, which all go through this file (`setModuleEnabled`,
 * `forgetModuleEnabled`). A scan reads them afresh. So the public manifest,
 * which every visitor's browser asks for, costs no database query.
 */
let enabledCache: Map<string, boolean> | null = null;

async function enabledFlags(): Promise<Map<string, boolean>> {
  if (enabledCache) return enabledCache;
  const flags = new Map<string, boolean>();
  try {
    for (const row of await db.getAllAppSettingsAsync()) {
      if (row.key.startsWith(MODULE_ENABLED_KEY_PREFIX)) {
        flags.set(row.key.slice(MODULE_ENABLED_KEY_PREFIX.length), row.value === 'true');
      }
    }
  } catch (error) {
    // No database, no enabled modules: the safe reading. Not cached, so the
    // next call tries again.
    log.warn(`[MODULES] Could not read which modules are enabled: ${messageOf(error)}`);
    return flags;
  }
  enabledCache = flags;
  return flags;
}

async function isModuleEnabled(id: string): Promise<boolean> {
  return (await enabledFlags()).get(id) === true;
}

/** Store a disk module's switch; `null` clears it. Keeps the cache in step. */
export async function storeEnabled(id: string, enabled: boolean | null): Promise<void> {
  await db.setAppSettingAsync(
    `${MODULE_ENABLED_KEY_PREFIX}${id}`,
    enabled === null ? null : String(enabled)
  );
  if (!enabledCache) return;
  if (enabled === null) enabledCache.delete(id);
  else enabledCache.set(id, enabled);
}

/** Clear a module's stored switch, as if it had never been switched. For the test helpers. */
export async function forgetModuleEnabled(id: string): Promise<void> {
  await storeEnabled(id, null);
}

// ---------------------------------------------------------------------------
// Scanning and loading
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ModuleLoadError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function importServerEntry(dir: string, manifest: ModuleManifest): Promise<unknown> {
  const realDir = await fs.promises.realpath(dir);
  let realFile: string;
  try {
    realFile = await fs.promises.realpath(path.resolve(realDir, manifest.server));
  } catch {
    throw new ModuleLoadError(`The server entry '${manifest.server}' does not exist.`);
  }
  if (!isInside(realDir, realFile)) {
    throw new ModuleLoadError(`The server entry '${manifest.server}' resolves outside the module folder.`);
  }

  // The version and the file's mtime in the URL make a reinstalled module a
  // fresh ESM instance: Node caches an import by URL, so without them a
  // module imported once (and refused, say, by its migrations) would come
  // back as the old code after its files were replaced. A loaded module is
  // never imported twice: an update of one waits for a restart.
  const stamp = Math.floor((await fs.promises.stat(realFile)).mtimeMs);
  const url = `${pathToFileURL(realFile).href}?v=${encodeURIComponent(manifest.version)}-${stamp}`;
  let namespace: unknown;
  try {
    namespace = await withTimeout(
      import(url),
      IMPORT_TIMEOUT_MS,
      `Importing the server entry did not finish within ${IMPORT_TIMEOUT_MS / 1000} seconds.`
    );
  } catch (error) {
    if (error instanceof ModuleLoadError) throw error;
    throw new ModuleLoadError(`The server entry failed to import: ${messageOf(error)}`);
  }
  return integrationFromNamespace(namespace);
}

/** The module's legacy route mounts, checked, before anything is registered. */
function legacyMountsOf(integration: GameIntegration): LegacyRouteMount[] {
  const mounts = integration.legacyRoutes?.() ?? [];
  if (!Array.isArray(mounts)) throw new ModuleLoadError("'legacyRoutes()' must return an array.");
  for (const mount of mounts) {
    if (
      !mount ||
      typeof mount.prefix !== 'string' ||
      !mount.prefix.startsWith('/api/') ||
      typeof mount.router !== 'function'
    ) {
      throw new ModuleLoadError(
        "Each of 'legacyRoutes()' must have a 'prefix' under /api/ and a 'router'."
      );
    }
  }
  return mounts;
}

interface Evaluation {
  record: DiskModule;
  integration?: GameIntegration;
}

async function evaluate(folder: string, dir: string): Promise<Evaluation> {
  const record = (
    status: ModuleStatus,
    reason: string | null,
    manifest: ModuleManifest | null = null
  ): DiskModule => ({ folder, dir, manifest, status, reason });

  if (!isValidModuleId(folder)) {
    return {
      record: record(
        'broken',
        `The folder name '${folder.slice(0, 80)}' is not a valid module id: use lowercase letters, digits and single hyphens.`
      ),
    };
  }

  let text: string;
  try {
    text = await fs.promises.readFile(path.join(dir, 'module.json'), 'utf8');
  } catch {
    return { record: record('broken', 'module.json is missing or cannot be read.') };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { record: record('broken', `module.json is not valid JSON: ${messageOf(error)}`) };
  }
  const parsed = parseManifest(raw, folder);
  if (!parsed.ok) return { record: record('broken', parsed.reason) };
  const manifest = parsed.manifest;

  if (builtinIntegrations().some((integration) => integration.id === manifest.id)) {
    return {
      record: record('broken', `The id '${manifest.id}' is a built-in module's.`, manifest),
    };
  }

  const incompatible = compatibilityProblem(manifest);
  if (incompatible) return { record: record('incompatible', incompatible, manifest) };

  if (!(await isModuleEnabled(manifest.id))) {
    return { record: record('disabled', null, manifest) };
  }

  // From here on the module's own code runs.
  try {
    const integration = await importServerEntry(dir, manifest);
    const problem = integrationProblem(integration);
    if (problem) throw new ModuleLoadError(problem);
    const loaded = integration as GameIntegration;
    if (loaded.id !== manifest.id) {
      throw new ModuleLoadError(
        `The integration's id is '${loaded.id}' but module.json says '${manifest.id}'.`
      );
    }
    if (hasIntegration(loaded.id)) {
      throw new ModuleLoadError(`A module with the id '${loaded.id}' is already registered.`);
    }
    const mounts = legacyMountsOf(loaded);

    // Its own database schema, before anything can use it (DESIGN-modules
    // §4.3). After validation, so a module that was never going to load does
    // not leave tables behind; before seed() and registration, so nothing
    // ever runs against a schema that is not there. The runner never throws:
    // it answers with a status, applies each migration in its own
    // transaction, and refuses one that reaches outside the module's own
    // names or was edited after it ran. A module whose migrations did not all
    // apply is broken, and says which one and why.
    // A database that already ran migrations this version does not declare
    // was set up by a newer version of the module: running this one against
    // that schema is a downgrade by another route. Refused, with the names.
    const declared = new Set((loaded.migrations ?? []).map((migration) => migration.id));
    const ledger = await db.queryAsync<{ migration_id: string }>(
      'SELECT migration_id FROM module_migrations WHERE module_id = ? ORDER BY migration_id',
      [loaded.id]
    );
    const unknown = ledger.map((row) => row.migration_id).filter((migration) => !declared.has(migration));
    if (unknown.length > 0) {
      throw new ModuleLoadError(
        `This database has migrations of '${loaded.id}' that version ${manifest.version} does not know (${unknown.join(', ')}): ` +
          'a newer version set it up. Install that version or a newer one.'
      );
    }

    const migrated = await runModuleMigrations(loaded);
    if (migrated.status !== 'ok') {
      throw new ModuleLoadError(
        `Its database migrations did not apply: ${migrated.reason ?? 'no reason given'}`
      );
    }

    if (loaded.seed) {
      try {
        await db.withClient((client) => loaded.seed!(client));
      } catch (error) {
        throw new ModuleLoadError(`Seeding the module's data failed: ${messageOf(error)}`);
      }
    }

    registerIntegration(loaded);
    loadedFromDisk.add(loaded.id);
    for (const mount of mounts) diskModuleRoutes.use(mount.prefix, mount.router);

    return { record: record('ok', null, manifest), integration: loaded };
  } catch (error) {
    return { record: record('broken', messageOf(error), manifest) };
  }
}

let scanning: Promise<unknown> = Promise.resolve();

/**
 * Scan `DATA_DIR/modules` and load every enabled, compatible module not yet
 * loaded. Returns the integrations it registered, so a caller that runs it
 * after boot can start them. Never throws.
 *
 * Boot runs it once. The test-only helper runs it again to prove what a
 * restart would do; a module already loaded is left exactly as it is.
 */
export function scanDiskModules(): Promise<GameIntegration[]> {
  const run = scanning.then(scanOnce, scanOnce);
  scanning = run;
  return run;
}

async function scanOnce(): Promise<GameIntegration[]> {
  // What a restart would read: the switches as stored, not as last seen.
  enabledCache = null;
  const root = modulesDir();
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    // No folder is the stock install: nothing to do, and nothing to say.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`[MODULES] Could not read ${root}: ${messageOf(error)}`);
    }
    entries = [];
  }

  const loaded: GameIntegration[] = [];
  const seen = new Set<string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const dir = path.join(root, entry.name);
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      isDirectory = await fs.promises.stat(dir).then((s) => s.isDirectory(), () => false);
    }
    if (!isDirectory) continue;
    seen.add(entry.name);

    // A loaded module stays loaded, as it is, until the process restarts.
    if (diskModules.get(entry.name)?.status === 'ok') continue;

    let evaluation: Evaluation;
    try {
      evaluation = await evaluate(entry.name, dir);
    } catch (error) {
      evaluation = {
        record: { folder: entry.name, dir, manifest: null, status: 'broken', reason: messageOf(error) },
      };
    }
    diskModules.set(entry.name, evaluation.record);
    if (evaluation.integration) loaded.push(evaluation.integration);

    const { status, reason, manifest } = evaluation.record;
    const label = manifest ? `${manifest.id}@${manifest.version}` : entry.name;
    if (status === 'ok') log.success(`[MODULES] Loaded ${label} from ${dir}`);
    else if (status === 'disabled') log.info(`[MODULES] ${label} is disabled`);
    else log.warn(`[MODULES] ${label} is ${status}: ${reason}`);
  }

  // Folders removed since the last scan are forgotten, unless their module is
  // loaded: that one is still running.
  for (const [folder, record] of diskModules) {
    if (!seen.has(folder) && record.status !== 'ok') diskModules.delete(folder);
  }
  return loaded;
}

/** What the last scan (or `loadModuleNow`) found for one module. */
export interface DiskModuleState {
  status: ModuleStatus;
  reason: string | null;
  version: string | null;
  name: string | null;
  loaded: boolean;
}

export function diskModuleState(id: string): DiskModuleState | null {
  const record = diskModules.get(id);
  if (!record) return null;
  return {
    status: record.status,
    reason: record.reason,
    version: record.manifest?.version ?? null,
    name: record.manifest?.name ?? null,
    loaded: record.status === 'ok',
  };
}

/** Whether this process runs the module's code (it loaded, and cannot unload). */
export function isModuleLoaded(id: string): boolean {
  return diskModules.get(id)?.status === 'ok';
}

/** Whether `id` is a module compiled into this image rather than one on disk. */
export function isBuiltinModule(id: string): boolean {
  return builtinIntegrations().some((integration) => integration.id === id);
}

/**
 * Load one module now, the way boot would: evaluate `DATA_DIR/modules/<id>`
 * and, when it is enabled and compatible, import, migrate, seed and register
 * it, then `start()` it. For the catalog's install and enable, which load a
 * module that is not loaded yet. A module already loaded is left as it is.
 * Never throws; the state says what happened (null: no such folder).
 */
export function loadModuleNow(id: string): Promise<DiskModuleState | null> {
  const run = scanning.then(
    () => loadOne(id),
    () => loadOne(id)
  );
  scanning = run;
  return run;
}

async function loadOne(id: string): Promise<DiskModuleState | null> {
  if (!isValidModuleId(id)) return null;
  if (diskModules.get(id)?.status === 'ok') return diskModuleState(id);
  enabledCache = null;
  const dir = path.join(modulesDir(), id);
  const isDirectory = await fs.promises.stat(dir).then(
    (s) => s.isDirectory(),
    () => false
  );
  if (!isDirectory) {
    diskModules.delete(id);
    return null;
  }
  let evaluation: Evaluation;
  try {
    evaluation = await evaluate(id, dir);
  } catch (error) {
    evaluation = {
      record: { folder: id, dir, manifest: null, status: 'broken', reason: messageOf(error) },
    };
  }
  diskModules.set(id, evaluation.record);
  const { status, reason, manifest } = evaluation.record;
  const label = manifest ? `${manifest.id}@${manifest.version}` : id;
  if (evaluation.integration) {
    log.success(`[MODULES] Loaded ${label} from ${dir} without a restart`);
    try {
      await evaluation.integration.start?.();
    } catch (error) {
      // Registered and serving; only its background work failed to start, the
      // same as a failed start() at boot.
      log.warn(`[MODULES] ${label} loaded, but its start() failed: ${messageOf(error)}`);
    }
  } else if (status === 'disabled') {
    log.info(`[MODULES] ${label} is disabled`);
  } else {
    log.warn(`[MODULES] ${label} is ${status}: ${reason}`);
  }
  return diskModuleState(id);
}

/**
 * Forget what a scan saw in a folder that is gone, unless its module is
 * loaded: that one keeps running until the restart.
 */
export function forgetDiskModule(id: string): void {
  if (diskModules.get(id)?.status !== 'ok') diskModules.delete(id);
}

/**
 * A loaded module's files moved (an update put a new version in its folder
 * and kept the running one in `dir`). Its client files are served from `dir`
 * until the restart, so browsers keep getting the client half that matches
 * the server half this process runs.
 */
export function relocateLoadedModule(id: string, dir: string): void {
  const record = diskModules.get(id);
  if (record?.status === 'ok') record.dir = dir;
}

// ---------------------------------------------------------------------------
// Listing and switching
// ---------------------------------------------------------------------------

function clientEntryUrl(id: string, entry: string): string {
  return `/api/modules/${id}/client/${entry.slice('client/'.length)}`;
}

function diskListing(record: DiskModule, enabled: boolean): ModuleListing {
  const { manifest, status } = record;
  let reason = record.reason;
  if (status === 'disabled' && enabled) reason = 'Enabled. It loads on the next restart.';
  if (status === 'ok' && !enabled) reason = 'Disabled. It stays loaded until the next restart.';
  return {
    id: manifest?.id ?? record.folder,
    name: manifest?.name ?? record.folder,
    version: manifest?.version ?? '',
    source: 'disk',
    clientApi: manifest?.clientApi ?? null,
    serverApi: manifest?.serverApi ?? null,
    enabled,
    status,
    reason,
    client:
      status === 'ok' && enabled && manifest?.client
        ? { entry: clientEntryUrl(manifest.id, manifest.client) }
        : null,
  };
}

/** Built-in modules first, in registration order, then disk modules by id. */
export async function listModules(): Promise<ModuleListing[]> {
  const builtins: ModuleListing[] = builtinIntegrations().map((integration) => ({
    id: integration.id,
    name: integration.displayName,
    version: packageJson.version,
    source: 'builtin',
    clientApi: null,
    serverApi: null,
    enabled: true,
    status: 'ok',
    reason: null,
    client: null,
  }));

  const flags = await enabledFlags();
  const disk = [...diskModules.values()]
    .sort((a, b) => a.folder.localeCompare(b.folder))
    .map((record) => diskListing(record, flags.get(record.folder) === true));

  return [...builtins, ...disk];
}

/** One row of the public manifest, `GET /api/modules/public`. */
export interface PublicModuleListing {
  id: string;
  version: string;
  clientApi: string;
  client: { entry: string };
}

/**
 * What any browser needs to load the code modules' client halves, and
 * nothing else: modules that are enabled, loaded (`ok`) and have a client
 * half, by id. No reasons, no disabled, broken or incompatible modules, no
 * server API, no switch state. Built-in modules are compiled into the app and
 * never listed. Their client files are public already, so this says nothing
 * those files do not.
 *
 * Read from memory: the last scan and the cached switches.
 */
export async function listPublicModules(): Promise<PublicModuleListing[]> {
  const flags = await enabledFlags();
  const listed: PublicModuleListing[] = [];
  for (const record of [...diskModules.values()].sort((a, b) => a.folder.localeCompare(b.folder))) {
    const { manifest } = record;
    if (record.status !== 'ok' || !manifest?.client || !manifest.clientApi) continue;
    if (flags.get(record.folder) !== true) continue;
    listed.push({
      id: manifest.id,
      version: manifest.version,
      clientApi: manifest.clientApi,
      client: { entry: clientEntryUrl(manifest.id, manifest.client) },
    });
  }
  return listed;
}

export type SetEnabledResult =
  | { ok: true; module: ModuleListing; restartRequired: boolean }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Store whether a disk module is enabled. It takes effect on the next boot;
 * `restartRequired` says whether the running process differs from what was
 * just stored.
 */
export async function setModuleEnabled(id: string, enabled: boolean): Promise<SetEnabledResult> {
  if (!isValidModuleId(id)) {
    return { ok: false, status: 400, error: 'Not a valid module id' };
  }
  if (builtinIntegrations().some((integration) => integration.id === id)) {
    return {
      ok: false,
      status: 400,
      error: `'${id}' is a built-in module; it is always on and cannot be switched here`,
    };
  }
  const record = diskModules.get(id);
  if (!record) {
    return {
      ok: false,
      status: 404,
      error: `No module '${id}' in ${modulesDir()}. Modules are found when the platform starts.`,
    };
  }

  await storeEnabled(id, enabled);
  return {
    ok: true,
    module: diskListing(record, enabled),
    restartRequired: enabled !== (record.status === 'ok'),
  };
}

// ---------------------------------------------------------------------------
// Client files
// ---------------------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * The file on disk for `GET /api/modules/<id>/client/<relative>`, or null.
 *
 * Only a module that is loaded and enabled serves anything, and only from its
 * own `client/` folder: a path that resolves anywhere else — through `..`, an
 * encoded `..`, or a symlink — is null, the same as a file that is not there.
 */
export async function resolveClientFile(id: string, relative: string): Promise<string | null> {
  if (!isValidModuleId(id)) return null;
  const record = diskModules.get(id);
  if (!record || record.status !== 'ok' || !record.manifest?.client) return null;
  if (!(await isModuleEnabled(id))) return null;

  if (!relative || relative.includes('\0') || relative.includes('\\')) return null;
  if (relative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }

  try {
    const clientDir = await fs.promises.realpath(path.join(record.dir, 'client'));
    const file = await fs.promises.realpath(path.resolve(clientDir, relative));
    if (!isInside(clientDir, file)) return null;
    const stat = await fs.promises.stat(file);
    return stat.isFile() ? file : null;
  } catch {
    return null;
  }
}
