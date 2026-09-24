/**
 * The game catalog: one list of every game this instance can install — packs
 * and code modules alike — and the operations on them (DESIGN-modules §10).
 *
 * Packs are data and go through `gamePackService` as they always have.
 * Code modules come as signed releases, from our GitHub or the image's
 * offline snapshot, and are installed like this (§10.7):
 *
 *   1. choose the newest release whose API ranges hold this platform
 *   2. download it (or read the snapshot's copy; a failed download falls back
 *      to the snapshot when it has a compatible release)
 *   3. verify the signature on the raw bytes — before anything is
 *      decompressed, parsed or written outside staging
 *   4. unpack into `DATA_DIR/modules/.staging/…`, strictly (`archive.ts`)
 *   5. check `module.json` against what was signed and against the platform
 *   6. rename the old folder to `.previous/<id>` and the new one into place
 *   7. store provenance and the switch
 *   8. load it now if this process has not loaded it; otherwise the update
 *      waits for a restart. A load that fails rolls everything back.
 *
 * One operation at a time. Every write is logged with the admin who asked.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import semver from 'semver';
import { db } from '../config/database';
import { coreObjectNames, moduleNamespace } from '../config/moduleMigrations';
import { log } from '../utils/logger';
import { listIntegrations } from '../integrations/registry';
import {
  bundledPackEntries,
  bundledPackTile,
  checkTileMarkup,
  installPack,
  installedPack,
  installedPacks,
  packIcon,
  packIsInUse,
  readBundledPack,
  removePack,
} from '../services/gamePackService';
import { fetchPackAt } from '../services/packIndexService';
import { ArchiveError, extractEntries, readModuleArchive } from './archive';
import {
  downloadRelease,
  feedAssetUrl,
  pickRelease,
  platformApiVersions,
  readRemoteFeed,
  readSnapshotModules,
  readSnapshotRelease,
  snapshotDir,
  type CatalogModuleEntry,
  type CatalogRelease,
  type RemoteFeed,
  type ReleaseBytes,
} from './catalogFeed';
import {
  diskModuleState,
  forgetDiskModule,
  isBuiltinModule,
  isModuleLoaded,
  loadModuleNow,
  MODULE_ENABLED_KEY_PREFIX,
  modulesDir,
  relocateLoadedModule,
  storeEnabled,
} from './loader';
import { compatibilityProblem, isValidModuleId, parseManifest } from './manifest';
import { verifyModuleRelease } from './signature';
import { trustedKeys } from './trustedKeys';

// ---------------------------------------------------------------------------
// Errors and the lock
// ---------------------------------------------------------------------------

/** A refusal with the HTTP status it should be answered with. */
export class CatalogError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422 | 502,
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

let busy: string | null = null;

async function exclusive<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (busy) throw new CatalogError(409, `Another catalog operation is running (${busy}). Try again in a moment.`, 'busy');
  busy = what;
  try {
    return await fn();
  } finally {
    busy = null;
  }
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export const MODULE_INSTALL_KEY_PREFIX = 'module_install:';
export const MODULE_REMOVED_KEY_PREFIX = 'module_removed:';
/**
 * The highest version of a module this instance ever installed from the
 * catalog. Kept through uninstall and purge (and a database wipe, with the
 * other `module_*` settings), so a feed edit — or a stolen admin session —
 * cannot walk an instance back to an older signed release with a known flaw.
 */
export const MODULE_MAX_VERSION_KEY_PREFIX = 'module_max_version:';

/**
 * The oldest release of a module this platform accepts, whatever the feed
 * and the instance's history say. A release with a known flaw is fenced off
 * here, in a platform release.
 */
const MINIMUM_MODULE_VERSIONS: Readonly<Record<string, string>> = {};

async function highestInstalledVersion(id: string): Promise<string | null> {
  const raw = await db.getAppSettingAsync(`${MODULE_MAX_VERSION_KEY_PREFIX}${id}`).catch(() => null);
  return raw && semver.valid(raw) ? raw : null;
}

async function recordInstalledVersion(id: string, version: string): Promise<void> {
  const highest = await highestInstalledVersion(id);
  if (!highest || semver.gt(version, highest)) {
    await db.setAppSettingAsync(`${MODULE_MAX_VERSION_KEY_PREFIX}${id}`, version);
  }
}

/** Why installing `version` of `id` would be a downgrade, or null. Equal is a reinstall, and allowed. */
async function downgradeProblem(id: string, version: string): Promise<string | null> {
  const highest = await highestInstalledVersion(id);
  if (highest && semver.lt(version, highest)) {
    return `Version ${version} is older than ${highest}, which this instance has already run; a downgrade is refused.`;
  }
  const minimum = MINIMUM_MODULE_VERSIONS[id];
  if (minimum && semver.lt(version, minimum)) {
    return `Version ${version} is older than ${minimum}, the oldest this platform accepts.`;
  }
  return null;
}

export interface ModuleProvenance {
  source: 'catalog' | 'snapshot';
  version: string;
  sha256: string;
  keyId: string;
  installedAt: number;
  installedBy: string | null;
  /** What an update replaced, until the new version has loaded once. */
  previous?: ModuleProvenance | null;
}

export async function readProvenance(id: string): Promise<ModuleProvenance | null> {
  try {
    const raw = await db.getAppSettingAsync(`${MODULE_INSTALL_KEY_PREFIX}${id}`);
    return raw ? (JSON.parse(raw) as ModuleProvenance) : null;
  } catch {
    return null;
  }
}

async function writeProvenance(id: string, value: ModuleProvenance | null): Promise<void> {
  await db.setAppSettingAsync(`${MODULE_INSTALL_KEY_PREFIX}${id}`, value ? JSON.stringify(value) : null);
}

async function readEnabled(id: string): Promise<boolean | null> {
  const raw = await db.getAppSettingAsync(`${MODULE_ENABLED_KEY_PREFIX}${id}`);
  return raw === null ? null : raw === 'true';
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

const stagingRoot = () => path.join(modulesDir(), '.staging');
const previousDir = (id: string) => path.join(modulesDir(), '.previous', id);
const liveDir = (id: string) => path.join(modulesDir(), id);

async function exists(target: string): Promise<boolean> {
  return fs.promises.lstat(target).then(
    () => true,
    () => false
  );
}

async function removeTree(target: string): Promise<void> {
  await fs.promises.rm(target, { recursive: true, force: true });
}

/** Leftovers of an install the process did not finish. Called at boot. */
export async function sweepStaging(): Promise<void> {
  await removeTree(stagingRoot()).catch(() => undefined);
  await removeTree(path.join(modulesDir(), '.trash')).catch(() => undefined);
}

/** The version in a module folder's `module.json`, or null. */
async function diskVersion(dir: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(path.join(dir, 'module.json'), 'utf8')) as { version?: unknown };
    return typeof raw.version === 'string' && semver.valid(raw.version) ? raw.version : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The catalog, merged
// ---------------------------------------------------------------------------

export type CatalogState =
  | 'available'
  | 'installed'
  | 'update-available'
  | 'disabled'
  | 'broken'
  | 'incompatible'
  | 'builtin';

export interface CatalogItem {
  kind: 'pack' | 'module';
  id: string;
  name: string;
  description: string | null;
  /** Same-origin URL of its tile, or null. */
  icon: string | null;
  /** Packs: the engine that runs them. */
  engine: string | null;
  state: CatalogState;
  /** Why it is broken or incompatible, or what a restart will change. */
  reason: string | null;
  installed: {
    version: string | null;
    source: string;
    enabled: boolean;
    /** Code modules from the catalog: the key their release was signed with. */
    keyId?: string | null;
    keyLabel?: string | null;
  } | null;
  /** What installing (or updating) would install. */
  available: { version: string | null; from: 'remote' | 'snapshot' } | null;
  /** The running process differs from what is installed and switched on. */
  restartRequired: boolean;
}

export interface CatalogListing {
  feed: { from: RemoteFeed['from']; stale: boolean; error: string | null };
  platform: { serverApi: string; clientApi: string };
  items: CatalogItem[];
}

function iconUrl(kind: 'pack' | 'module', id: string): string {
  return `/api/catalog/${kind === 'pack' ? 'packs' : 'modules'}/${encodeURIComponent(id)}/icon.svg`;
}

/** Remote and snapshot entries of one module, releases combined. */
function mergeModules(remote: CatalogModuleEntry[], snapshot: CatalogModuleEntry[]): Map<string, CatalogModuleEntry> {
  const merged = new Map<string, CatalogModuleEntry>();
  for (const entry of [...remote, ...snapshot]) {
    const existing = merged.get(entry.id);
    if (!existing) merged.set(entry.id, { ...entry, releases: [...entry.releases] });
    else existing.releases.push(...entry.releases);
  }
  return merged;
}

/**
 * What the running process does not match yet, for a module, or null: the
 * reason a restart is required.
 */
async function pendingRestart(id: string): Promise<string | null> {
  const state = diskModuleState(id);
  const onDisk = await exists(liveDir(id));
  const installedVersion = onDisk ? await diskVersion(liveDir(id)) : null;
  const enabled = (await readEnabled(id)) === true;
  const loaded = isModuleLoaded(id);
  if (loaded && !onDisk) return 'Uninstalled. Its code stays loaded until the next restart.';
  if (loaded && !enabled) return 'Disabled. Its code stays loaded until the next restart.';
  if (loaded && state?.version && installedVersion && state.version !== installedVersion) {
    return `Version ${installedVersion} is installed; ${state.version} runs until the next restart.`;
  }
  if (onDisk && enabled && !loaded && state?.status === 'disabled') {
    return 'Enabled. It loads on the next restart.';
  }
  return null;
}

async function moduleItem(
  id: string,
  entry: CatalogModuleEntry | undefined
): Promise<CatalogItem> {
  const state = diskModuleState(id);
  const onDisk = await exists(liveDir(id));
  const installedVersion = onDisk ? await diskVersion(liveDir(id)) : null;
  const enabled = (await readEnabled(id)) === true;
  const provenance = onDisk ? await readProvenance(id) : null;

  const picked = entry ? pickRelease(entry.releases) : null;
  const available =
    picked && picked.ok ? { version: picked.release.version, from: picked.release.from } : null;

  const restartReason = await pendingRestart(id);
  // Who vouched for the files on disk: the key that signed them, by name.
  const key = provenance ? trustedKeys().find((candidate) => candidate.keyId === provenance.keyId) : undefined;

  let itemState: CatalogState;
  let reason: string | null = restartReason;
  if (!onDisk) {
    itemState = picked && !picked.ok ? 'incompatible' : 'available';
    if (picked && !picked.ok) reason = picked.reason;
  } else if (state?.status === 'broken' || state?.status === 'incompatible') {
    itemState = state.status;
    reason = state.reason;
  } else if (!enabled) {
    itemState = 'disabled';
  } else if (available && installedVersion && semver.gt(available.version, installedVersion)) {
    itemState = 'update-available';
  } else {
    itemState = 'installed';
  }

  return {
    kind: 'module',
    id,
    name: entry?.name ?? state?.name ?? id,
    description: entry?.description ?? null,
    icon: entry?.icon ? iconUrl('module', id) : null,
    engine: null,
    state: itemState,
    reason,
    installed: onDisk
      ? {
          version: installedVersion,
          source: provenance?.source ?? 'manual',
          enabled,
          keyId: provenance?.keyId ?? null,
          keyLabel: provenance ? (key ? key.label : 'a key this platform no longer trusts') : null,
        }
      : null,
    available,
    restartRequired: restartReason !== null,
  };
}

/** Every game this instance has or could install, packs and modules in one list. */
export async function listCatalog(): Promise<CatalogListing> {
  const [feed, snapshotModules, snapshotPacks] = await Promise.all([
    readRemoteFeed(),
    readSnapshotModules(),
    bundledPackEntries(),
  ]);
  lastFeed = feed;
  const items: CatalogItem[] = [];

  // Modules compiled into this image: listed so the admin sees them, never
  // installable or removable here.
  for (const integration of listIntegrations()) {
    if (!isBuiltinModule(integration.id)) continue;
    items.push({
      kind: 'module',
      id: integration.id,
      name: integration.displayName,
      description: null,
      icon: null,
      engine: null,
      state: 'builtin',
      reason: null,
      installed: { version: null, source: 'builtin', enabled: true },
      available: null,
      restartRequired: false,
    });
  }

  const modules = mergeModules(feed.modules, snapshotModules);
  const ids = new Set<string>([...modules.keys()]);
  // Installed on disk but in no catalog: a manual install, or one the feed dropped.
  for (const dirent of await fs.promises.readdir(modulesDir(), { withFileTypes: true }).catch(() => [])) {
    if (!dirent.name.startsWith('.') && isValidModuleId(dirent.name)) ids.add(dirent.name);
  }
  for (const id of [...ids].sort()) {
    if (isBuiltinModule(id)) continue;
    items.push(await moduleItem(id, modules.get(id)));
  }

  // Packs: the feed's, the snapshot's, and whatever is installed.
  const packs = new Map<string, { name: string; description: string | null; engine: string; hasIcon: boolean; remote: string | null; snapshot: string | null }>();
  for (const entry of snapshotPacks) {
    packs.set(entry.slug, {
      name: entry.name,
      description: entry.description,
      engine: entry.engine,
      hasIcon: Boolean(entry.icon),
      remote: null,
      snapshot: entry.version,
    });
  }
  for (const entry of feed.packs) {
    const existing = packs.get(entry.slug);
    packs.set(entry.slug, {
      name: entry.name,
      description: entry.description ?? existing?.description ?? null,
      engine: entry.engine,
      hasIcon: Boolean(entry.icon) || Boolean(existing?.hasIcon),
      remote: entry.version ?? '0.0.0',
      snapshot: existing?.snapshot ?? null,
    });
  }
  for (const pack of installedPacks()) {
    if (!packs.has(pack.slug)) {
      packs.set(pack.slug, {
        name: pack.name,
        description: pack.definition.description ?? null,
        engine: pack.engine,
        hasIcon: pack.hasIcon,
        remote: null,
        snapshot: null,
      });
    }
  }
  for (const [slug, info] of [...packs.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const installed = installedPack(slug);
    const best = pickPackVersion(info.remote, info.snapshot);
    const newer = Boolean(
      installed?.version &&
        best?.version &&
        semver.valid(installed.version) &&
        semver.valid(best.version) &&
        semver.gt(best.version, installed.version)
    );
    items.push({
      kind: 'pack',
      id: slug,
      name: installed?.name ?? info.name,
      description: info.description,
      icon: info.hasIcon || installed?.hasIcon ? iconUrl('pack', slug) : null,
      engine: info.engine,
      state: installed ? (newer ? 'update-available' : 'installed') : 'available',
      reason: null,
      installed: installed ? { version: installed.version, source: installed.source, enabled: true } : null,
      available: best,
      restartRequired: false,
    });
  }

  return {
    feed: { from: feed.from, stale: feed.from !== 'remote', error: feed.error },
    platform: platformApiVersions(),
    items,
  };
}

function pickPackVersion(
  remote: string | null,
  snapshot: string | null
): { version: string | null; from: 'remote' | 'snapshot' } | null {
  if (remote === null && snapshot === null) return null;
  if (remote === null) return { version: snapshot, from: 'snapshot' };
  if (snapshot === null) return { version: remote, from: 'remote' };
  const r = semver.valid(remote);
  const s = semver.valid(snapshot);
  if (r && s && semver.gt(s, r)) return { version: snapshot, from: 'snapshot' };
  return { version: remote, from: 'remote' };
}

/** The feed the last listing read, so an install uses the list the admin saw. */
let lastFeed: RemoteFeed | null = null;

async function currentFeed(): Promise<RemoteFeed> {
  return lastFeed ?? (lastFeed = await readRemoteFeed());
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/** The tile for a catalog entry, checked like an imported pack's, or null. */
export async function catalogIcon(kind: 'pack' | 'module', id: string): Promise<string | null> {
  if (kind === 'pack') {
    const installed = await packIcon(id);
    if (installed) return installed;
    const bundled = await bundledPackTile(id);
    if (bundled) return bundled;
    const feed = await currentFeed();
    const entry = feed.packs.find((candidate) => candidate.slug === id);
    return entry?.icon && feed.base ? fetchFeedTile(feed.base, entry.icon) : null;
  }
  if (!isValidModuleId(id)) return null;
  const snapshot = (await readSnapshotModules()).find((entry) => entry.id === id);
  if (snapshot?.icon && /^[a-z0-9][a-z0-9._/-]*\.svg$/.test(snapshot.icon) && !snapshot.icon.includes('..')) {
    try {
      const markup = await fs.promises.readFile(path.join(snapshotDir(), snapshot.icon), 'utf8');
      if (!checkTileMarkup(markup)) return markup;
    } catch {
      // Fall through to the feed.
    }
  }
  const feed = await currentFeed();
  const entry = feed.modules.find((candidate) => candidate.id === id);
  return entry?.icon && feed.base ? fetchFeedTile(feed.base, entry.icon) : null;
}

const tileCache = new Map<string, { markup: string | null; at: number }>();

async function fetchFeedTile(base: string, relative: string): Promise<string | null> {
  const url = feedAssetUrl(base, relative);
  if (!url) return null;
  const cached = tileCache.get(url);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.markup;
  let markup: string | null = null;
  try {
    const response = await fetch(url, { timeout: 5000, size: 1_000_000 });
    if (response.ok) {
      const body = await response.text();
      markup = checkTileMarkup(body) ? null : body;
    }
  } catch {
    markup = null;
  }
  tileCache.set(url, { markup, at: Date.now() });
  return markup;
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export interface OperationResult {
  item: CatalogItem | null;
  restartRequired: boolean;
  /** Plain words for the admin: what happened, what is left to do. */
  message: string;
}

async function packItem(slug: string): Promise<CatalogItem | null> {
  return (await listCatalog()).items.find((item) => item.kind === 'pack' && item.id === slug) ?? null;
}

export function installCatalogPack(slug: string, actor: string | null): Promise<OperationResult> {
  return exclusive(`pack ${slug}`, async () => {
    const wanted = slug.trim().toLowerCase();
    const feed = await currentFeed();
    const remote = feed.packs.find((entry) => entry.slug === wanted);
    const bundled = (await bundledPackEntries()).find((entry) => entry.slug === wanted);
    if (!remote && !bundled) throw new CatalogError(404, `The catalog has no game '${wanted}'.`, 'not-found');

    const existing = installedPack(wanted);
    const choice = pickPackVersion(remote ? remote.version ?? '0.0.0' : null, bundled ? bundled.version : null);

    let installedFrom: 'remote' | 'snapshot' | null = null;
    let remoteError: string | null = null;
    if (choice?.from === 'remote' && remote && feed.base) {
      const found = await fetchPackAt(feed.base, wanted, remote.file);
      if (found.ok) {
        await installPack(found.pack, { source: 'index', origin: found.origin, installedBy: actor, tile: found.tile });
        installedFrom = 'remote';
      } else {
        remoteError = found.error;
      }
    }
    if (!installedFrom && bundled) {
      const { definition, tile } = await readBundledPack(bundled).catch((error: Error) => {
        throw new CatalogError(400, `The offline copy of '${wanted}' is not valid: ${error.message}`, 'invalid');
      });
      await installPack(definition, { source: 'bundled', installedBy: actor, tile });
      installedFrom = 'snapshot';
    }
    if (!installedFrom) {
      throw new CatalogError(remoteError?.startsWith('Could not download') ? 502 : 400, remoteError ?? 'Could not install that game.', 'download');
    }
    log.info(
      `[CATALOG] ${existing ? 'Updated' : 'Installed'} game pack '${wanted}' from the ${installedFrom === 'remote' ? 'catalog feed' : 'offline snapshot'}${actor ? ` (by ${actor})` : ''}`
    );
    return {
      item: await packItem(wanted),
      restartRequired: false,
      message: existing ? 'Updated.' : 'Installed.',
    };
  });
}

export function uninstallCatalogPack(slug: string, actor: string | null): Promise<OperationResult> {
  return exclusive(`pack ${slug}`, async () => {
    const wanted = slug.trim().toLowerCase();
    if (!installedPack(wanted)) throw new CatalogError(404, `'${wanted}' is not installed.`, 'not-installed');
    if (await packIsInUse(wanted)) {
      throw new CatalogError(409, 'A tournament is running this game; delete the tournament first.', 'in-use');
    }
    await removePack(wanted);
    log.info(`[CATALOG] Removed game pack '${wanted}'${actor ? ` (by ${actor})` : ''}`);
    return { item: await packItem(wanted), restartRequired: false, message: 'Removed.' };
  });
}

// ---------------------------------------------------------------------------
// Code modules
// ---------------------------------------------------------------------------

async function moduleEntry(id: string): Promise<CatalogModuleEntry | undefined> {
  const feed = await currentFeed();
  return mergeModules(feed.modules, await readSnapshotModules()).get(id);
}

async function itemFor(id: string): Promise<CatalogItem> {
  return moduleItem(id, await moduleEntry(id));
}

/** The bytes of `release`, falling back to the snapshot when a download fails. */
async function obtain(
  release: CatalogRelease,
  entry: CatalogModuleEntry,
  minimum: string | null
): Promise<{ bytes: ReleaseBytes; release: CatalogRelease }> {
  if (release.from === 'snapshot') {
    return { bytes: await readSnapshotRelease(release), release };
  }
  try {
    return { bytes: await downloadRelease(release), release };
  } catch (error) {
    const offline = pickRelease(entry.releases.filter((candidate) => candidate.from === 'snapshot'));
    if (offline.ok && (!minimum || semver.gt(offline.release.version, minimum))) {
      log.warn(
        `[CATALOG] ${(error as Error).message}; installing ${entry.id}@${offline.release.version} from the offline snapshot instead`
      );
      return { bytes: await readSnapshotRelease(offline.release), release: offline.release };
    }
    throw new CatalogError(502, (error as Error).message, 'download');
  }
}

/**
 * Tables in a module's namespace that the module may own: `<ns>…`, never a
 * core table, and never one in a longer namespace another known module owns
 * (`a` must not take `a_b_…`, which is `a-b`'s).
 */
async function namespaceTables(id: string): Promise<string[]> {
  const ns = moduleNamespace(id);
  const rows = await db.queryAsync<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND starts_with(tablename, ?)",
    [ns]
  );
  const others = new Set<string>();
  for (const row of await db.queryAsync<{ module_id: string }>('SELECT DISTINCT module_id FROM module_migrations')) {
    others.add(row.module_id);
  }
  for (const integration of listIntegrations()) others.add(integration.id);
  for (const dirent of await fs.promises.readdir(modulesDir(), { withFileTypes: true }).catch(() => [])) {
    if (isValidModuleId(dirent.name)) others.add(dirent.name);
  }
  const longer = [...others]
    .filter((other) => other !== id)
    .map(moduleNamespace)
    .filter((prefix) => prefix.startsWith(ns) && prefix !== ns);
  const core = coreObjectNames();
  return rows
    .map((row) => row.tablename)
    .filter((name) => !core.has(name) && !longer.some((prefix) => name.startsWith(prefix)))
    .sort();
}

/** The `game` values a module's tournaments carry: its id, and its catalogue claims when loaded. */
function gameRefs(id: string): string[] {
  const refs = new Set<string>([id]);
  const integration = listIntegrations().find((candidate) => candidate.id === id);
  if (integration?.catalog) {
    if (integration.catalog.slug) refs.add(integration.catalog.slug.toLowerCase());
    for (const alias of integration.catalog.aliases ?? []) refs.add(alias.toLowerCase());
  }
  for (const entry of integration?.catalogEntries ?? []) refs.add(entry.slug.toLowerCase());
  return [...refs];
}

async function tournamentsUsing(id: string, unfinishedOnly: boolean): Promise<number> {
  const row = await db.queryOneAsync<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM tournament WHERE LOWER(game) = ANY(?)${
      unfinishedOnly ? " AND status <> 'completed'" : ''
    }`,
    [gameRefs(id)]
  );
  return Number(row?.count ?? 0);
}

async function matchesUsing(id: string): Promise<number> {
  const row = await db.queryOneAsync<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM matches WHERE LOWER(game) = ANY(?)',
    [gameRefs(id)]
  );
  return Number(row?.count ?? 0);
}

function checkModuleId(id: string): void {
  if (!isValidModuleId(id)) throw new CatalogError(400, 'Not a valid module id.', 'invalid-id');
  if (isBuiltinModule(id)) {
    throw new CatalogError(409, `'${id}' is built into this image; it cannot be installed, updated or removed here.`, 'builtin');
  }
}

/**
 * Install or update a code module from the catalog.
 *
 * `update` must move to a newer version; `install` refuses a module that is
 * already installed. Answers what happened and whether a restart is needed.
 */
export function installCatalogModule(
  id: string,
  options: { actor: string | null; update: boolean }
): Promise<OperationResult> {
  return exclusive(`module ${id}`, () => installModule(id, options));
}

async function installModule(id: string, { actor, update }: { actor: string | null; update: boolean }): Promise<OperationResult> {
  checkModuleId(id);
  // A loaded module whose files already moved on (an update, an uninstall,
  // a switch) serves its client half from where it was until the restart.
  // Changing its files again before then would pull those out from under it.
  const pending = await pendingRestart(id);
  if (pending) {
    throw new CatalogError(409, `Restart Auto Tournament first: ${pending}`, 'restart-required');
  }
  const entry = await moduleEntry(id);
  if (!entry) throw new CatalogError(404, `The catalog has no module '${id}'.`, 'not-found');

  const live = liveDir(id);
  const installedVersion = (await exists(live)) ? await diskVersion(live) : null;
  if (installedVersion && !update) {
    throw new CatalogError(409, `'${id}' is already installed (version ${installedVersion}).`, 'installed');
  }
  if (!installedVersion && update) throw new CatalogError(404, `'${id}' is not installed.`, 'not-installed');

  const picked = pickRelease(entry.releases);
  if (!picked.ok) throw new CatalogError(409, picked.reason, 'incompatible');
  if (installedVersion && !semver.gt(picked.release.version, installedVersion)) {
    throw new CatalogError(
      409,
      semver.eq(picked.release.version, installedVersion)
        ? `'${id}' ${installedVersion} is already the newest version this platform can run.`
        : `The catalog offers ${picked.release.version}, older than the installed ${installedVersion}; a downgrade is refused.`,
      'not-newer'
    );
  }

  const refused = await downgradeProblem(id, picked.release.version);
  if (refused) throw new CatalogError(409, refused, 'downgrade');

  const { bytes, release } = await obtain(picked.release, entry, installedVersion);
  // The offline fallback may be another version than the one picked.
  const refusedFallback = release === picked.release ? null : await downgradeProblem(id, release.version);
  if (refusedFallback) throw new CatalogError(409, refusedFallback, 'downgrade');

  // The gate. Nothing below this line runs on bytes that did not verify.
  const verified = verifyModuleRelease(bytes.archive, bytes.signature, {
    id,
    version: release.version,
    sha256: release.sha256,
  });
  if (!verified.ok) {
    log.warn(`[CATALOG] Refused ${id}@${release.version}: ${verified.reason}`);
    throw new CatalogError(400, `The release was refused: ${verified.reason}.`, 'signature');
  }

  await fs.promises.mkdir(stagingRoot(), { recursive: true });
  const staging = path.join(stagingRoot(), `${id}-${crypto.randomBytes(6).toString('hex')}`);
  const tree = path.join(staging, 'module');
  try {
    await fs.promises.mkdir(staging, { recursive: false });
    try {
      await extractEntries(readModuleArchive(bytes.archive), tree);
    } catch (error) {
      if (error instanceof ArchiveError) {
        log.warn(`[CATALOG] Refused ${id}@${release.version}: ${error.message}`);
        throw new CatalogError(400, `The release archive was refused: ${error.message}.`, 'archive');
      }
      throw error;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await fs.promises.readFile(path.join(tree, 'module.json'), 'utf8'));
    } catch {
      throw new CatalogError(400, 'The release has no readable module.json.', 'manifest');
    }
    const parsed = parseManifest(raw, id);
    if (!parsed.ok) throw new CatalogError(400, `The release's ${parsed.reason}`, 'manifest');
    if (parsed.manifest.version !== verified.signature.version) {
      throw new CatalogError(
        400,
        `The release's module.json says version ${parsed.manifest.version}, but ${verified.signature.version} was signed.`,
        'manifest'
      );
    }
    const incompatible = compatibilityProblem(parsed.manifest);
    if (incompatible) throw new CatalogError(409, incompatible, 'incompatible');

    // Swap. Both folders are under DATA_DIR/modules, so each rename is atomic.
    const wasLoaded = isModuleLoaded(id);
    const hadPrevious = await exists(live);
    const previousEnabled = await readEnabled(id);
    const previousProvenance = await readProvenance(id);
    await removeTree(previousDir(id));
    let movedOld = false;
    try {
      if (hadPrevious) {
        await fs.promises.mkdir(path.dirname(previousDir(id)), { recursive: true });
        await fs.promises.rename(live, previousDir(id));
        movedOld = true;
      }
      await fs.promises.rename(tree, live);
    } catch (error) {
      // Never leave the module without a folder: put the old one back. (A
      // crash between the two renames is finished at boot, see
      // restoreInterruptedSwaps.)
      if (movedOld && !(await exists(live))) {
        await fs.promises.rename(previousDir(id), live).catch(() => undefined);
      }
      throw new Error(`Could not move the new version into place, so nothing was changed: ${(error as Error).message}`);
    }

    await writeProvenance(id, {
      source: release.from === 'remote' ? 'catalog' : 'snapshot',
      version: release.version,
      sha256: verified.signature.sha256,
      keyId: verified.key.keyId,
      installedAt: Math.floor(Date.now() / 1000),
      installedBy: actor,
      previous: previousProvenance ? { ...previousProvenance, previous: null } : null,
    });
    await db.setAppSettingAsync(`${MODULE_REMOVED_KEY_PREFIX}${id}`, null);
    // An install switches the module on; an update keeps the switch as the
    // admin left it.
    const enable = update ? previousEnabled === true : true;
    await storeEnabled(id, enable);

    const verb = update ? 'Updated' : 'Installed';
    const from = release.from === 'remote' ? 'our GitHub' : 'the offline snapshot';
    const by = actor ? ` (by ${actor})` : '';

    if (!enable) {
      await recordInstalledVersion(id, release.version);
      await removeTree(previousDir(id));
      log.info(`[CATALOG] ${verb} ${id} to ${release.version} from ${from}${by}; it stays disabled`);
      return {
        item: await itemFor(id),
        restartRequired: false,
        message: `Version ${release.version} is installed. It stays disabled until you enable it.`,
      };
    }

    if (wasLoaded) {
      await recordInstalledVersion(id, release.version);
      // Node cannot unload the running version. It keeps running — and keeps
      // serving its own client files from .previous — until the restart,
      // which loads the new one.
      relocateLoadedModule(id, previousDir(id));
      log.info(`[CATALOG] ${verb} ${id} to ${release.version} from ${from}${by}; restart to load it`);
      return {
        item: await itemFor(id),
        restartRequired: true,
        message: `Version ${release.version} is installed. Restart Auto Tournament to load it.`,
      };
    }

    const state = await loadModuleNow(id);
    if (state?.status === 'ok') {
      await recordInstalledVersion(id, release.version);
      await removeTree(previousDir(id));
      log.success(`[CATALOG] ${verb} ${id}@${release.version} from ${from}${by}, loaded without a restart`);
      return {
        item: await itemFor(id),
        restartRequired: false,
        message: `Installed and running. Reload the page to use it.`,
      };
    }

    // It did not load: put everything back as it was.
    const why = state?.reason ?? 'it did not load';
    const trash = path.join(modulesDir(), '.trash', `${id}-${crypto.randomBytes(6).toString('hex')}`);
    await fs.promises.mkdir(path.dirname(trash), { recursive: true });
    await fs.promises.rename(live, trash).catch(() => undefined);
    if (hadPrevious && (await exists(previousDir(id)))) await fs.promises.rename(previousDir(id), live);
    await removeTree(trash);
    await writeProvenance(id, previousProvenance);
    await storeEnabled(id, previousEnabled);
    forgetDiskModule(id);
    if (hadPrevious) await loadModuleNow(id);
    log.warn(`[CATALOG] ${id}@${release.version} did not load and was rolled back: ${why}`);
    throw new CatalogError(422, `${entry.name} ${release.version} did not load, so nothing was changed: ${why}`, 'load');
  } finally {
    await removeTree(staging).catch(() => undefined);
  }
}

/**
 * A crash between the two renames of an install leaves the old version in
 * `.previous/<id>` and nothing at `<id>`. Before the boot scan, put it back
 * — when the instance still counts the module as installed (an install
 * record or a switch) and no admin removed it. Never deletes anything.
 */
export async function restoreInterruptedSwaps(): Promise<void> {
  const root = path.join(modulesDir(), '.previous');
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dirent of entries) {
    const id = dirent.name;
    if (!dirent.isDirectory() || !isValidModuleId(id)) continue;
    if (await exists(liveDir(id))) continue;
    try {
      const installed = (await readProvenance(id)) !== null || (await readEnabled(id)) !== null;
      const removed = await db.getAppSettingAsync(`${MODULE_REMOVED_KEY_PREFIX}${id}`);
      if (!installed || removed) continue;
      await fs.promises.rename(previousDir(id), liveDir(id));
      log.warn(`[CATALOG] ${id}: an install was interrupted before its new version was in place; restored the previous version`);
    } catch (error) {
      log.error(`[CATALOG] ${id}: could not restore the previous version after an interrupted install: ${(error as Error).message}`);
    }
  }
}

/**
 * Finish the updates the last run left for a restart (§10.7 step 6). For each
 * module with a `.previous` folder: the new version loaded → drop the old
 * one; it did not → put the old one back, load that, and say so. Runs at
 * boot, after the scan.
 */
export async function finishPendingUpdates(): Promise<void> {
  const root = path.join(modulesDir(), '.previous');
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dirent of entries) {
    const id = dirent.name;
    if (!dirent.isDirectory() || !isValidModuleId(id)) continue;
    const state = diskModuleState(id);
    if (!(await exists(liveDir(id)))) {
      // Not restored before the scan (restoreInterruptedSwaps): the module was
      // removed on purpose, or nothing says it was installed. The old files
      // stay where they are; only an admin's uninstall deletes a version.
      if (await db.getAppSettingAsync(`${MODULE_REMOVED_KEY_PREFIX}${id}`)) await removeTree(previousDir(id));
      else log.warn(`[CATALOG] ${id}: ${previousDir(id)} holds a version that is not installed; left as it is`);
    } else if (state?.status === 'ok') {
      await removeTree(previousDir(id));
    } else if (state?.status === 'broken' || state?.status === 'incompatible') {
      const provenance = await readProvenance(id);
      const trash = path.join(modulesDir(), '.trash', `${id}-${crypto.randomBytes(6).toString('hex')}`);
      await fs.promises.mkdir(path.dirname(trash), { recursive: true });
      await fs.promises.rename(liveDir(id), trash);
      await fs.promises.rename(previousDir(id), liveDir(id));
      await removeTree(trash);
      await writeProvenance(id, provenance?.previous ?? null);
      forgetDiskModule(id);
      const restored = await loadModuleNow(id);
      log.warn(
        `[CATALOG] ${id}@${provenance?.version ?? '?'} did not load after the restart (${state.reason ?? 'no reason'}); ` +
          `rolled back to ${restored?.version ?? 'the previous version'}, which is ${restored?.status ?? 'missing'}`
      );
    }
  }
}

/** Switch a module on. Loads it now when this process has not loaded it. */
export function enableCatalogModule(id: string, actor: string | null): Promise<OperationResult> {
  return exclusive(`module ${id}`, async () => {
    checkModuleId(id);
    if (!(await exists(liveDir(id)))) throw new CatalogError(404, `'${id}' is not installed.`, 'not-installed');
    await storeEnabled(id, true);
    log.info(`[CATALOG] Enabled ${id}${actor ? ` (by ${actor})` : ''}`);
    if (isModuleLoaded(id)) {
      return { item: await itemFor(id), restartRequired: false, message: 'Enabled.' };
    }
    const state = await loadModuleNow(id);
    if (state?.status === 'ok') {
      return { item: await itemFor(id), restartRequired: false, message: 'Enabled and running. Reload the page to use it.' };
    }
    return {
      item: await itemFor(id),
      restartRequired: false,
      message: `Enabled, but it did not load: ${state?.reason ?? 'unknown reason'}`,
    };
  });
}

/** Switch a module off. Its client files stop at once; its server code at the restart. */
export function disableCatalogModule(id: string, actor: string | null): Promise<OperationResult> {
  return exclusive(`module ${id}`, async () => {
    checkModuleId(id);
    if (!(await exists(liveDir(id)))) throw new CatalogError(404, `'${id}' is not installed.`, 'not-installed');
    await storeEnabled(id, false);
    const restartRequired = isModuleLoaded(id);
    log.info(`[CATALOG] Disabled ${id}${actor ? ` (by ${actor})` : ''}${restartRequired ? '; unloads on restart' : ''}`);
    return {
      item: await itemFor(id),
      restartRequired,
      message: restartRequired ? 'Disabled. Restart Auto Tournament to unload it.' : 'Disabled.',
    };
  });
}

/**
 * Remove a module's files. Its data — tables, migration ledger, settings —
 * stays, so installing it again brings everything back. Refused while an
 * unfinished tournament runs its game.
 */
export function uninstallCatalogModule(id: string, actor: string | null): Promise<OperationResult> {
  return exclusive(`module ${id}`, async () => {
    checkModuleId(id);
    if (!(await exists(liveDir(id)))) throw new CatalogError(404, `'${id}' is not installed.`, 'not-installed');
    const inUse = await tournamentsUsing(id, true);
    if (inUse > 0) {
      throw new CatalogError(
        409,
        `${inUse} unfinished tournament${inUse === 1 ? '' : 's'} use${inUse === 1 ? 's' : ''} this game. Finish or delete ${inUse === 1 ? 'it' : 'them'} first.`,
        'in-use'
      );
    }
    await storeEnabled(id, false);
    const trash = path.join(modulesDir(), '.trash', `${id}-${crypto.randomBytes(6).toString('hex')}`);
    await fs.promises.mkdir(path.dirname(trash), { recursive: true });
    await fs.promises.rename(liveDir(id), trash);
    await removeTree(trash);
    await removeTree(previousDir(id));
    await writeProvenance(id, null);
    await db.setAppSettingAsync(`${MODULE_REMOVED_KEY_PREFIX}${id}`, String(Math.floor(Date.now() / 1000)));
    forgetDiskModule(id);
    const restartRequired = isModuleLoaded(id);
    log.info(`[CATALOG] Uninstalled ${id}; its data is kept${actor ? ` (by ${actor})` : ''}${restartRequired ? '; unloads on restart' : ''}`);
    return {
      item: await itemFor(id),
      restartRequired,
      message: restartRequired
        ? 'Uninstalled; its data is kept. Restart Auto Tournament to unload it.'
        : 'Uninstalled; its data is kept.',
    };
  });
}

/**
 * Delete a module's data for good: the tables in its namespace, its migration
 * ledger and its switches. Only for a module that is uninstalled and not
 * loaded, with its id typed as confirmation, and with no tournament or match
 * on its game.
 */
export function purgeCatalogModule(id: string, confirm: unknown, actor: string | null): Promise<OperationResult & { dropped: string[] }> {
  return exclusive(`module ${id}`, async () => {
    checkModuleId(id);
    if (confirm !== id) throw new CatalogError(400, `Type the module id ('${id}') to confirm.`, 'confirm');
    if (await exists(liveDir(id))) throw new CatalogError(409, `Uninstall '${id}' first.`, 'installed');
    if (isModuleLoaded(id)) {
      throw new CatalogError(409, `'${id}' is still loaded. Restart Auto Tournament, then purge it.`, 'loaded');
    }
    const tournaments = await tournamentsUsing(id, false);
    const matches = await matchesUsing(id);
    if (tournaments > 0 || matches > 0) {
      throw new CatalogError(
        409,
        `${tournaments} tournament(s) and ${matches} match(es) are on this game. Delete them before purging its data.`,
        'in-use'
      );
    }
    const tables = await namespaceTables(id);
    let purged: PurgeReport = { tables, constraints: [] };
    await db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        purged = await purgeModuleData(client, id, tables);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new CatalogError(409, `Purging failed, nothing was deleted: ${(error as Error).message}`, 'purge');
      }
    });
    await storeEnabled(id, null);
    log.warn(
      `[CATALOG] Purged ${id}'s data: ${tables.length ? tables.join(', ') : 'no tables'}` +
        (purged.constraints.length ? `, and the keys into them (${purged.constraints.join(', ')})` : '') +
        (actor ? ` (by ${actor})` : '')
    );
    return {
      item: await itemFor(id),
      restartRequired: false,
      message: `Deleted ${tables.length} table${tables.length === 1 ? '' : 's'} and the module's records.`,
      dropped: tables,
    };
  });
}

export interface PurgeReport {
  tables: string[];
  /** Foreign keys from other tables into the module's, dropped first: `table.constraint`. */
  constraints: string[];
}

/**
 * The database half of a purge, on a connection inside the caller's
 * transaction: drop every foreign key another table holds into the module's
 * tables (core's `matches.server_id` into CS2's `cs2_servers`, say — the
 * rows keep their values, the key goes), then the tables, then the module's
 * ledger and switches. Exported for the test helper that runs it and rolls
 * it back.
 */
export async function purgeModuleData(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  id: string,
  tables: string[]
): Promise<PurgeReport> {
  const constraints: string[] = [];
  if (tables.length > 0) {
    const { rows } = await client.query(
      `SELECT quote_ident(n.nspname) || '.' || quote_ident(r.relname) AS tbl,
              r.relname AS relname, quote_ident(c.conname) AS con, c.conname AS conname
         FROM pg_constraint c
         JOIN pg_class r ON r.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE c.contype = 'f'
          AND c.confrelid = ANY($1::text[]::regclass[])
          AND c.conrelid <> ALL($1::text[]::regclass[])`,
      [tables]
    );
    for (const row of rows) {
      await client.query(`ALTER TABLE ${row.tbl as string} DROP CONSTRAINT ${row.con as string}`);
      constraints.push(`${row.relname as string}.${row.conname as string}`);
    }
    await client.query(`DROP TABLE IF EXISTS ${tables.map((name) => `"${name.replace(/"/g, '""')}"`).join(', ')}`);
  }
  await client.query('DELETE FROM module_migrations WHERE module_id = $1', [id]);
  await client.query('DELETE FROM app_settings WHERE key = ANY($1)', [
    [`${MODULE_ENABLED_KEY_PREFIX}${id}`, `${MODULE_INSTALL_KEY_PREFIX}${id}`],
  ]);
  return { tables, constraints };
}

/** The tables a purge of `id` would drop. For the test helper. */
export function purgeableTables(id: string): Promise<string[]> {
  return namespaceTables(id);
}
