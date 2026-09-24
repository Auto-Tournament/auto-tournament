/* global AbortController, AbortSignal */
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
 * Nothing is fetched until an admin opens the catalog. Opening it waits on
 * the network for at most `PAGE_WAIT_MS`; a slower fetch finishes in the
 * background while the page shows the cache. Every connection is retried
 * once when it stalls or is reset: on a path that drops some TLS handshakes
 * (seen behind a WireGuard tunnel with a smaller MTU than the container's
 * bridge) one try in three hung until its deadline, a second try did not.
 */

import fs from 'fs/promises';
import http from 'http';
import https from 'https';
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
/** One try at the feed, body included; a stalled try is retried once. */
const FEED_ATTEMPT_TIMEOUT_MS = 4_000;
/** How long opening the catalog waits on the network before showing the cache. */
const PAGE_WAIT_MS = 2_000;
/** After a failed fetch, list from the cache for this long before trying the network again. */
const RETRY_AFTER_FAILURE_MS = 15_000;
/** A whole release download, both tries and both files. */
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** One try at a release file, until its answer starts; retried once. */
const DOWNLOAD_ATTEMPT_TIMEOUT_MS = 10_000;

interface Overrides {
  catalogUrl?: string | null;
  releasePrefix?: string | null;
  /** One try at the feed. */
  feedTimeoutMs?: number;
  pageWaitMs?: number;
  retryAfterFailureMs?: number;
  downloadTimeoutMs?: number;
  downloadAttemptTimeoutMs?: number;
  snapshotDir?: string | null;
  cacheFile?: string | null;
  /** Origins a release download may redirect to, besides GitHub's asset hosts. */
  redirectOrigins?: string[] | null;
}

let overrides: Overrides = {};

/** Test-only: point the catalog at the fixture feed and snapshot. `null` resets. */
export function setCatalogOverridesForTests(next: Overrides | null): void {
  overrides = next ?? {};
  generation++;
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
  /** Why the feed is not fresh, as a code (`FeedErrorCode`). */
  error: FeedErrorCode | null;
  /** When the entries listed were fetched (for `cache`, when the copy was written). */
  fetchedAt: string | null;
  /** A fetch is still running in the background; reading again soon may get the live feed. */
  refreshing: boolean;
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
  const parsed = JSON.parse(body) as { schema?: unknown; packs?: unknown; modules?: unknown } | null;
  if (!parsed || typeof parsed !== 'object') throw new CatalogFetchError('bad_response', SENTENCES.bad_response);
  if (parsed.schema !== 1) throw new CatalogFetchError('newer_schema', SENTENCES.newer_schema);
  return { packs: parsePacks(parsed.packs), modules: parseModules(parsed.modules, 'remote') };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Why the feed is not fresh, as a code the client translates (never a
 * sentence). `http_<status>` is an answer that was not a 2xx.
 */
export type FeedErrorCode =
  | 'timeout'
  | 'unreachable'
  | 'bad_response'
  | 'newer_schema'
  | 'too_large'
  | 'offline'
  | `http_${number}`;

class CatalogFetchError extends Error {
  constructor(
    readonly code: FeedErrorCode,
    message: string
  ) {
    super(message);
  }
}

const SENTENCES: Record<string, string> = {
  timeout: 'it did not answer in time',
  unreachable: 'it could not be reached',
  bad_response: 'its answer was not a catalog',
  newer_schema: 'the catalog is written for a newer Auto Tournament',
  too_large: 'the file is too large',
  offline: 'CATALOG_OFFLINE is set',
};

function errorCode(error: unknown): FeedErrorCode {
  if (error instanceof CatalogFetchError) return error.code;
  if (error instanceof SyntaxError) return 'bad_response';
  const err = error as { type?: string; name?: string };
  if (err?.type === 'request-timeout' || err?.type === 'body-timeout' || err?.type === 'aborted') return 'timeout';
  if (err?.name === 'AbortError') return 'timeout';
  if (err?.type === 'max-size') return 'too_large';
  return 'unreachable';
}

/** A sentence, for the log and for a failed install's message. */
function describe(error: unknown): string {
  if (error instanceof CatalogFetchError) return error.message;
  const code = errorCode(error);
  if (code === 'unreachable') return (error as Error)?.message || SENTENCES.unreachable;
  return SENTENCES[code] ?? code;
}

/**
 * Connections for the feed and the downloads. With `autoSelectFamily` a
 * connection moves on to the next address (IPv4 and IPv6 interleaved) 250 ms
 * after one that does not answer instead of waiting on it; Node 20 does that
 * by default, it is set here so the catalog does not depend on the default.
 * No keep-alive: a retry gets a new connection, not the one that stalled.
 */
const AGENT_OPTIONS = { keepAlive: false, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250 };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url: URL): http.Agent => (url.protocol === 'http:' ? httpAgent : httpsAgent);

/** Failures worth one more connection: a stall or a reset, not an answer. */
const RETRY_SYSTEM_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT']);

function worthRetrying(error: unknown): boolean {
  if (error instanceof CatalogFetchError) return error.code === 'timeout';
  const err = error as { type?: string; code?: string; message?: string };
  if (err?.type === 'request-timeout' || err?.type === 'body-timeout') return true;
  return err?.type === 'system' && (RETRY_SYSTEM_CODES.has(err.code ?? '') || /socket hang up/i.test(err.message ?? ''));
}

interface GetOptions {
  limit: number;
  /** How long one connection may go without answering before it is dropped (and retried once). */
  attemptTimeoutMs: number;
  /** `all`: that deadline covers the body too. `headers`: only until the answer starts. */
  attemptCovers: 'all' | 'headers';
  redirect: 'follow' | 'manual';
  /** One deadline over every attempt, bodies included. */
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

type Got = { kind: 'redirect'; location: string | null } | { kind: 'body'; body: Buffer };

/** One GET on a new connection. `size` stops reading past the limit instead of buffering it first. */
async function getOnce(url: string, options: GetOptions): Promise<Got> {
  const controller = new AbortController();
  const outer = options.signal;
  const abort = () => controller.abort();
  if (outer?.aborted) abort();
  else outer?.addEventListener('abort', abort, { once: true });
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    stalled = true;
    controller.abort();
  }, options.attemptTimeoutMs);
  try {
    const response = await fetch(url, {
      agent: agentFor,
      redirect: options.redirect,
      size: options.limit,
      // node-fetch 2 declares its own AbortSignal type; Node's has the same shape.
      signal: controller.signal as unknown as NonNullable<Parameters<typeof fetch>[1]>['signal'],
      headers: options.headers,
    });
    if (options.redirect === 'manual' && response.status >= 300 && response.status < 400) {
      response.body.resume();
      return { kind: 'redirect', location: response.headers.get('location') };
    }
    if (!response.ok) {
      response.body.resume();
      throw new CatalogFetchError(`http_${response.status}`, `${response.status} ${response.statusText}`);
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > options.limit) throw new CatalogFetchError('too_large', SENTENCES.too_large);
    if (options.attemptCovers === 'headers' && timer) {
      clearTimeout(timer);
      timer = null;
    }
    return { kind: 'body', body: await response.buffer() };
  } catch (error) {
    if (stalled && !outer?.aborted) throw new CatalogFetchError('timeout', SENTENCES.timeout);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener('abort', abort);
  }
}

/** `getOnce`, and once more on a new connection when the first stalled or was reset. */
async function get(url: string, options: GetOptions): Promise<Got> {
  try {
    return await getOnce(url, options);
  } catch (error) {
    if (options.signal?.aborted || !worthRetrying(error)) throw error;
    log.info(`[CATALOG] ${url}: ${describe(error)}; trying once more on a new connection`);
    return getOnce(url, options);
  }
}

// ---------------------------------------------------------------------------
// The feed: fetched in the background, never waited on for long
// ---------------------------------------------------------------------------

/** Bumped when the test overrides change, so a fetch started before does not write the new cache. */
let generation = 0;
let inFlight: { generation: number; promise: Promise<RemoteFeed> } | null = null;
/** The last fetch failed: why and when, so the next few page loads do not each wait on it again. */
let lastFailure: { generation: number; code: FeedErrorCode; at: number } | null = null;

async function fetchFeedNow(gen: number): Promise<RemoteFeed> {
  const url = catalogUrl();
  const base = new URL('.', url).toString();
  const file = cacheFile();
  try {
    const got = await get(url, {
      limit: MAX_FEED_BYTES,
      attemptTimeoutMs: overrides.feedTimeoutMs ?? FEED_ATTEMPT_TIMEOUT_MS,
      attemptCovers: 'all',
      redirect: 'follow',
    });
    if (got.kind !== 'body') throw new CatalogFetchError('bad_response', SENTENCES.bad_response);
    const body = got.body.toString('utf8');
    const feed = parseFeed(body);
    if (gen === generation) {
      await writeCachedFeed(file, body);
      lastFailure = null;
    }
    return { base, ...feed, from: 'remote', error: null, fetchedAt: new Date().toISOString(), refreshing: false };
  } catch (error) {
    const code = errorCode(error);
    if (gen === generation) lastFailure = { generation: gen, code, at: Date.now() };
    const fallback = await fallbackFeed(base, file, code, false);
    log.warn(
      fallback.from === 'cache'
        ? `[CATALOG] Using the catalog cached at ${fallback.fetchedAt}: ${describe(error)}`
        : `[CATALOG] No catalog feed; offering the offline snapshot only: ${describe(error)}`
    );
    return fallback;
  }
}

/** Fetch the feed, or join the fetch already running. Never throws. */
export function refreshRemoteFeed(): Promise<RemoteFeed> {
  if (inFlight && inFlight.generation === generation) return inFlight.promise;
  const gen = generation;
  const promise = fetchFeedNow(gen).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { generation: gen, promise };
  return promise;
}

/** The last copy, or nothing, and why the live feed is not shown. */
async function fallbackFeed(base: string, file: string, code: FeedErrorCode, refreshing: boolean): Promise<RemoteFeed> {
  const cached = await readCachedFeed(file);
  return cached
    ? { base, ...cached.feed, from: 'cache', error: code, fetchedAt: cached.at, refreshing }
    : { base: null, packs: [], modules: [], from: 'none', error: code, fetchedAt: null, refreshing };
}

/**
 * The remote feed now, or its last copy, or nothing. Never throws, and never
 * waits on the network longer than `PAGE_WAIT_MS`: past that it returns the
 * last copy marked `refreshing`, and the fetch finishes in the background
 * for the next read. For `RETRY_AFTER_FAILURE_MS` after a failed fetch it
 * returns the last copy without trying again.
 */
export async function readRemoteFeed(): Promise<RemoteFeed> {
  const base = new URL('.', catalogUrl()).toString();
  if (catalogOffline()) return fallbackFeed(base, cacheFile(), 'offline', false);
  const failed = lastFailure?.generation === generation ? lastFailure : null;
  if (!inFlight && failed && Date.now() - failed.at < (overrides.retryAfterFailureMs ?? RETRY_AFTER_FAILURE_MS)) {
    return fallbackFeed(base, cacheFile(), failed.code, false);
  }
  const refresh = refreshRemoteFeed();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = await Promise.race([
    refresh,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), overrides.pageWaitMs ?? PAGE_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  return waited ?? fallbackFeed(base, cacheFile(), 'timeout', true);
}

async function readCachedFeed(
  file: string
): Promise<{ feed: { packs: CatalogPackEntry[]; modules: CatalogModuleEntry[] }; at: string } | null> {
  try {
    const [body, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    return { feed: parseFeed(body), at: stat.mtime.toISOString() };
  } catch {
    return null;
  }
}

async function writeCachedFeed(file: string, body: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, 'utf8');
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

/**
 * The hosts GitHub serves release assets from. A release URL on github.com
 * answers with one redirect to one of these; nothing else is followed.
 */
export const RELEASE_REDIRECT_HOSTS = ['objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

/** Whether a release download may be redirected to `url`: https, GitHub's asset hosts, nothing else. */
export function allowedRedirectUrl(url: URL): boolean {
  if (url.username || url.password) return false;
  if (overrides.redirectOrigins?.includes(url.origin)) return true;
  return url.protocol === 'https:' && url.port === '' && RELEASE_REDIRECT_HOSTS.includes(url.hostname);
}

/**
 * One release file. Redirects are not followed blindly — at most one hop, to
 * an allowed asset host (`allowedRedirectUrl`) — and the caller's signal is
 * one deadline for the whole download, bodies included. A connection that
 * does not start answering within `DOWNLOAD_ATTEMPT_TIMEOUT_MS`, or is
 * reset, is tried once more.
 */
async function fetchReleaseFile(url: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  let target = url;
  for (let hop = 0; ; hop++) {
    const got = await get(target, {
      limit,
      signal,
      attemptTimeoutMs: overrides.downloadAttemptTimeoutMs ?? DOWNLOAD_ATTEMPT_TIMEOUT_MS,
      attemptCovers: 'headers',
      redirect: 'manual',
      headers: { accept: 'application/octet-stream' },
    });
    if (got.kind === 'body') return got.body;
    if (hop >= 1) throw new Error('it redirected more than once');
    if (!got.location) throw new Error('it redirected nowhere');
    const next = new URL(got.location, target);
    if (!allowedRedirectUrl(next)) {
      throw new Error(`it redirected to ${next.protocol}//${next.host}, which this platform does not download from`);
    }
    target = next.toString();
  }
}

/** Download a remote release and its `.sig`, within one deadline. Throws with a sentence. */
export async function downloadRelease(release: CatalogRelease): Promise<ReleaseBytes> {
  if (release.from !== 'remote' || !release.url || !allowedReleaseUrl(release.url)) {
    throw new Error('the release URL is not one this platform downloads from');
  }
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), downloadTimeoutMs());
  try {
    let archive: Buffer;
    try {
      archive = await fetchReleaseFile(release.url, MAX_ARCHIVE_BYTES, controller.signal);
    } catch (error) {
      throw new Error(`downloading the release failed: ${describe(error)}`);
    }
    let signature: Buffer;
    try {
      signature = await fetchReleaseFile(`${release.url}.sig`, MAX_SIGNATURE_BYTES, controller.signal);
    } catch (error) {
      throw new Error(`downloading the release's signature failed: ${describe(error)}`);
    }
    return { archive, signature };
  } finally {
    clearTimeout(deadline);
  }
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
