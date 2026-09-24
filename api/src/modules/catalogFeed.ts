/**
 * Where the game catalog's entries come from (DESIGN-modules §10.2): the
 * remote feed, its last copy under `DATA_DIR`, and the offline snapshot the
 * image carries.
 *
 * - **Feed**: `catalog.json` at the root of `Auto-Tournament/packs`
 *   (`CATALOG_URL` overrides it, `CATALOG_OFFLINE=true` never fetches). It
 *   lists packs, exactly as `index.json` does, and code modules with their
 *   signed releases. The feed is not trusted: packs are validated like
 *   uploads, and a module is installed only if its archive's signature
 *   verifies against a key compiled into the platform. So a community-edited
 *   file is fine. A release URL must still be under our own GitHub
 *   organisation, so the feed cannot make this server fetch anything else.
 * - **Cache**: the last feed that parsed, so an instance that has been online
 *   once keeps its list when it is not.
 * - **Snapshot**: `bundled-packs/` and `bundled-modules/`, what installs with
 *   no network at all.
 *
 * Nothing is fetched until an admin opens the catalog.
 */

import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import semver from 'semver';
import { DATA_DIR } from '../config/dataDir';
import { BUNDLED_MODULES_DIR } from '../config/publicPaths';
import { log } from '../utils/logger';
import { resolveInsideIndex } from '../services/packIndexService';
import { isValidModuleId } from './manifest';
import { CLIENT_API_VERSION, SERVER_API_VERSION } from './version';
import { MAX_SIGNATURE_BYTES } from './signature';

export const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/Auto-Tournament/packs/main/catalog.json';
/** Module releases are downloaded from here and nowhere else. */
export const RELEASE_URL_PREFIX = 'https://github.com/Auto-Tournament/';

export const MAX_FEED_BYTES = 2_000_000;
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const FEED_TIMEOUT_MS = 5_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

interface Overrides {
  catalogUrl?: string | null;
  releasePrefix?: string | null;
  feedTimeoutMs?: number;
  downloadTimeoutMs?: number;
  snapshotDir?: string | null;
  cacheFile?: string | null;
}

let overrides: Overrides = {};

/** Test-only: point the catalog at the fixture feed and snapshot. `null` resets. */
export function setCatalogOverridesForTests(next: Overrides | null): void {
  overrides = next ?? {};
}

export function catalogUrl(): string {
  return overrides.catalogUrl || process.env.CATALOG_URL || DEFAULT_CATALOG_URL;
}

function catalogOffline(): boolean {
  if (overrides.catalogUrl) return false;
  return ['1', 'true', 'yes'].includes((process.env.CATALOG_OFFLINE || '').trim().toLowerCase());
}

function releasePrefix(): string {
  return overrides.releasePrefix || RELEASE_URL_PREFIX;
}

export function snapshotDir(): string {
  return overrides.snapshotDir || BUNDLED_MODULES_DIR;
}

function cacheFile(): string {
  return overrides.cacheFile || path.join(DATA_DIR, 'catalog.json');
}

export function downloadTimeoutMs(): number {
  return overrides.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
}

/** The API versions this platform provides, which a release's ranges must hold. */
export function platformApiVersions(): { serverApi: string; clientApi: string } {
  return { serverApi: SERVER_API_VERSION, clientApi: CLIENT_API_VERSION };
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface CatalogRelease {
  version: string;
  serverApi: string;
  clientApi: string;
  /** Hex sha256 of the archive, when the feed lists it. */
  sha256: string | null;
  size: number | null;
  /** Where the bytes come from. */
  from: 'remote' | 'snapshot';
  /** `remote`: the archive's URL; the signature is at `<url>.sig`. */
  url?: string;
  /** `snapshot`: the archive's file name in the snapshot folder. */
  file?: string;
}

export interface CatalogModuleEntry {
  id: string;
  name: string;
  description: string | null;
  /** Path of its tile, relative to the feed or the snapshot folder. */
  icon: string | null;
  releases: CatalogRelease[];
}

export interface CatalogPackEntry {
  slug: string;
  name: string;
  version: string | null;
  engine: string;
  description: string | null;
  file: string;
  icon: string | null;
}

export interface RemoteFeed {
  /** The URL entries are relative to (the feed's folder), or null offline. */
  base: string | null;
  packs: CatalogPackEntry[];
  modules: CatalogModuleEntry[];
  /** `remote`: fetched now. `cache`: the last copy. `none`: no feed at all. */
  from: 'remote' | 'cache' | 'none';
  /** Why the feed is not fresh. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Parsing — every field checked, a bad row skipped rather than fatal
// ---------------------------------------------------------------------------

function text(value: unknown, max = 500): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function isRange(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && semver.validRange(value) !== null;
}

/** A release URL under `prefix`, `https:` (or the test fixture's own origin), no credentials. */
export function allowedReleaseUrl(value: string, prefix = releasePrefix()): boolean {
  let url: URL;
  let root: URL;
  try {
    url = new URL(value);
    root = new URL(prefix);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol !== root.protocol || url.origin !== root.origin) return false;
  if (root.protocol !== 'https:' && !overrides.releasePrefix) return false;
  // Normalised by URL, so `..` has already been resolved before this check.
  return url.pathname.startsWith(root.pathname) && !url.search && !url.hash;
}

function parseRelease(raw: unknown, from: 'remote' | 'snapshot'): CatalogRelease | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || !semver.valid(r.version)) return null;
  if (!isRange(r.serverApi) || !isRange(r.clientApi)) return null;
  const sha256 = typeof r.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(r.sha256) ? r.sha256.toLowerCase() : null;
  const size = typeof r.size === 'number' && Number.isFinite(r.size) && r.size > 0 ? r.size : null;
  const base = { version: r.version, serverApi: r.serverApi, clientApi: r.clientApi, sha256, size, from };
  if (from === 'remote') {
    if (typeof r.url !== 'string' || !allowedReleaseUrl(r.url)) return null;
    return { ...base, url: r.url };
  }
  // A snapshot file is a bare name in the snapshot folder.
  if (typeof r.file !== 'string' || !/^[a-z0-9][a-z0-9.-]*\.atmod$/.test(r.file)) return null;
  return { ...base, file: r.file };
}

function parseModules(raw: unknown, from: 'remote' | 'snapshot'): CatalogModuleEntry[] {
  if (!Array.isArray(raw)) return [];
  const modules: CatalogModuleEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const m = row as Record<string, unknown>;
    if (!isValidModuleId(m.id)) continue;
    const name = text(m.name, 100);
    if (!name) continue;
    const releases = (Array.isArray(m.releases) ? m.releases : [])
      .map((release) => parseRelease(release, from))
      .filter((release): release is CatalogRelease => release !== null);
    if (releases.length === 0) continue;
    const icon = text(m.icon, 200);
    modules.push({
      id: m.id as string,
      name,
      description: text(m.description),
      icon: icon && !/^[a-z][a-z0-9+.-]*:/i.test(icon) && !icon.startsWith('/') ? icon : null,
      releases,
    });
  }
  return modules;
}

function parsePacks(raw: unknown): CatalogPackEntry[] {
  if (!Array.isArray(raw)) return [];
  const packs: CatalogPackEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const p = row as Record<string, unknown>;
    const slug = text(p.slug, 80)?.toLowerCase();
    const name = text(p.name, 100);
    const file = text(p.file, 200);
    const engine = text(p.engine, 80);
    if (!slug || !name || !file || !engine) continue;
    packs.push({
      slug,
      name,
      version: text(p.version, 40),
      engine,
      description: text(p.description),
      file,
      icon: text(p.icon, 200),
    });
  }
  return packs;
}

function parseFeed(body: string): { packs: CatalogPackEntry[]; modules: CatalogModuleEntry[] } {
  const parsed = JSON.parse(body) as { schema?: unknown; packs?: unknown; modules?: unknown };
  if (parsed.schema !== 1) throw new Error('the catalog is written for a newer Auto Tournament');
  return { packs: parsePacks(parsed.packs), modules: parseModules(parsed.modules, 'remote') };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchBytes(url: string, limit: number, timeoutMs: number): Promise<Buffer> {
  // node-fetch's own timeout covers the whole request, body included; `size`
  // stops reading past the limit instead of buffering a huge body first.
  const response = await fetch(url, { timeout: timeoutMs, size: limit, redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw new Error('the file is too large');
  return response.buffer();
}

function describe(error: unknown): string {
  const err = error as { type?: string; message?: string };
  if (err?.type === 'request-timeout' || err?.type === 'body-timeout') return 'it did not answer in time';
  if (err?.type === 'max-size') return 'the file is too large';
  return err?.message || 'unknown error';
}

/** The remote feed now, or its last copy, or nothing. Never throws. */
export async function readRemoteFeed(): Promise<RemoteFeed> {
  const url = catalogUrl();
  const base = new URL('.', url).toString();
  if (catalogOffline()) {
    const cached = await readCachedFeed();
    return cached
      ? { base, ...cached, from: 'cache', error: 'CATALOG_OFFLINE is set' }
      : { base: null, packs: [], modules: [], from: 'none', error: 'CATALOG_OFFLINE is set' };
  }
  try {
    const body = (await fetchBytes(url, MAX_FEED_BYTES, overrides.feedTimeoutMs ?? FEED_TIMEOUT_MS)).toString('utf8');
    const feed = parseFeed(body);
    await writeCachedFeed(body);
    return { base, ...feed, from: 'remote', error: null };
  } catch (error) {
    const reason = describe(error);
    const cached = await readCachedFeed();
    if (cached) {
      log.warn(`[CATALOG] Using the cached catalog: ${reason}`);
      return { base, ...cached, from: 'cache', error: reason };
    }
    log.warn(`[CATALOG] No catalog feed; offering the offline snapshot only: ${reason}`);
    return { base: null, packs: [], modules: [], from: 'none', error: reason };
  }
}

async function readCachedFeed(): Promise<{ packs: CatalogPackEntry[]; modules: CatalogModuleEntry[] } | null> {
  try {
    return parseFeed(await fs.readFile(cacheFile(), 'utf8'));
  } catch {
    return null;
  }
}

async function writeCachedFeed(body: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cacheFile()), { recursive: true });
    await fs.writeFile(cacheFile(), body, 'utf8');
  } catch (error) {
    log.warn(`[CATALOG] Could not cache the catalog: ${(error as Error).message}`);
  }
}

/** The modules the image's snapshot carries. Never throws. */
export async function readSnapshotModules(): Promise<CatalogModuleEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(snapshotDir(), 'index.json'), 'utf8')) as {
      schema?: unknown;
      modules?: unknown;
    };
    if (parsed.schema !== 1) return [];
    return parseModules(parsed.modules, 'snapshot');
  } catch {
    return [];
  }
}

export interface ReleaseBytes {
  archive: Buffer;
  signature: Buffer;
}

/** Download a remote release and its `.sig`. Throws with a sentence. */
export async function downloadRelease(release: CatalogRelease): Promise<ReleaseBytes> {
  if (release.from !== 'remote' || !release.url || !allowedReleaseUrl(release.url)) {
    throw new Error('the release URL is not one this platform downloads from');
  }
  const timeout = downloadTimeoutMs();
  let archive: Buffer;
  try {
    archive = await fetchBytes(release.url, MAX_ARCHIVE_BYTES, timeout);
  } catch (error) {
    throw new Error(`downloading the release failed: ${describe(error)}`);
  }
  let signature: Buffer;
  try {
    signature = await fetchBytes(`${release.url}.sig`, MAX_SIGNATURE_BYTES, timeout);
  } catch (error) {
    throw new Error(`downloading the release's signature failed: ${describe(error)}`);
  }
  return { archive, signature };
}

/** A release from the snapshot folder. Throws with a sentence. */
export async function readSnapshotRelease(release: CatalogRelease): Promise<ReleaseBytes> {
  if (release.from !== 'snapshot' || !release.file) throw new Error('not a snapshot release');
  const dir = snapshotDir();
  const file = path.join(dir, release.file);
  if (path.dirname(file) !== path.resolve(dir)) throw new Error('the snapshot file is outside the snapshot');
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new Error(`the offline copy ${release.file} is missing from this image`);
  if (stat.size > MAX_ARCHIVE_BYTES) throw new Error('the offline copy is too large');
  const signature = await fs.readFile(`${file}.sig`).catch(() => null);
  if (!signature) throw new Error(`the offline copy ${release.file} has no signature`);
  if (signature.length > MAX_SIGNATURE_BYTES) throw new Error('the signature file is too large');
  return { archive: await fs.readFile(file), signature };
}

/**
 * The newest release whose API ranges hold this platform's versions, or why
 * there is none.
 */
export function pickRelease(
  releases: CatalogRelease[],
  versions = platformApiVersions()
): { ok: true; release: CatalogRelease } | { ok: false; reason: string } {
  const compatible = releases.filter(
    (release) =>
      semver.satisfies(versions.serverApi, release.serverApi) &&
      semver.satisfies(versions.clientApi, release.clientApi)
  );
  if (compatible.length === 0) {
    const newest = [...releases].sort((a, b) => semver.rcompare(a.version, b.version))[0];
    return {
      ok: false,
      reason: newest
        ? `Version ${newest.version} is built for server API ${newest.serverApi} and client API ${newest.clientApi}; this platform provides ${versions.serverApi} and ${versions.clientApi}.`
        : 'No release is listed.',
    };
  }
  // Newest first; for the same version the remote copy first (the snapshot is the fallback).
  compatible.sort((a, b) => semver.rcompare(a.version, b.version) || (a.from === 'remote' ? -1 : 1));
  return { ok: true, release: compatible[0] };
}

/** A tile path from the feed, resolved inside it, or null. */
export function feedAssetUrl(base: string, relative: string): string | null {
  return resolveInsideIndex(base, base, relative);
}
