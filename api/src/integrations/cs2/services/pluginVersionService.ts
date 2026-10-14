import { log } from '../../../utils/logger';
import fetch from 'node-fetch';
import {
  compareVersions,
  isPrereleaseVersion,
  parseVersion,
  type ReadyUpRelease,
} from './readyUpVersion';

// ---------------------------------------------------------------------------
// Ready Up (Auto-Tournament/ready-up)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour; GitHub allows 60 unauthenticated requests an hour

export const READY_UP_RELEASES_URL =
  'https://api.github.com/repos/Auto-Tournament/ready-up/releases?per_page=20';

interface ReadyUpGitHubRelease {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
}

type ReleaseFetch = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

// One cached lookup per channel: stable servers only compare against stable
// releases, pre-release servers against the newest release including betas.
const readyUpCache = new Map<
  'stable' | 'prerelease',
  { release: ReadyUpRelease | null; at: number }
>();

/** Test hook: forget the cached Ready Up lookup. */
export function resetReadyUpReleaseCache(): void {
  readyUpCache.clear();
}

/**
 * Latest Ready Up release on the right channel, or null when there is none.
 * `runningVersion` picks the channel: a pre-release build compares against the
 * newest release including pre-releases; anything else only against stable
 * ones. GitHub's 404 (or an empty list) is an expected "no release", not an
 * error; any other failure also yields null (and is not cached).
 */
export async function getLatestReadyUpRelease(options?: {
  runningVersion?: string | null;
  forceRefresh?: boolean;
  fetchImpl?: ReleaseFetch;
}): Promise<ReadyUpRelease | null> {
  const channel = isPrereleaseVersion(options?.runningVersion) ? 'prerelease' : 'stable';
  const now = Date.now();
  const cached = readyUpCache.get(channel);
  if (!options?.forceRefresh && cached && now - cached.at < CACHE_TTL_MS) {
    return cached.release;
  }
  const doFetch: ReleaseFetch = options?.fetchImpl ?? (fetch as unknown as ReleaseFetch);
  try {
    const response = await doFetch(READY_UP_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Auto-Tournament' },
    });
    if (response.status === 404) {
      readyUpCache.set(channel, { release: null, at: now });
      return null;
    }
    if (!response.ok) {
      log.warn('[PLUGIN-VERSION] Failed to fetch Ready Up releases from GitHub', {
        status: response.status,
      });
      return null;
    }
    const body = (await response.json()) as unknown;
    const list = Array.isArray(body) ? (body as ReadyUpGitHubRelease[]) : [];
    let best: ReadyUpRelease | null = null;
    for (const r of list) {
      if (!r || r.draft || !r.tag_name) continue;
      const version = r.tag_name.replace(/^v/i, '');
      if (parseVersion(version) === null) continue; // not a semver tag
      if (channel === 'stable' && (r.prerelease || isPrereleaseVersion(version))) continue;
      if (!best || (compareVersions(version, best.version) ?? 0) > 0) {
        best = {
          version,
          releaseUrl: r.html_url ?? 'https://github.com/Auto-Tournament/ready-up/releases',
        };
      }
    }
    readyUpCache.set(channel, { release: best, at: now });
    return best;
  } catch (error) {
    log.warn('[PLUGIN-VERSION] Exception fetching Ready Up releases from GitHub', { error });
    return null;
  }
}

const CSM_RELEASE_URL =
  'https://api.github.com/repos/Auto-Tournament/cs2-server-manager/releases/latest';
let csmCache: { version: string | null; at: number } | null = null;

/**
 * csm's newest release (GitHub's "latest": stable only), cached like Ready
 * Up's. Null when it cannot be read (not cached, so the next call asks again).
 */
export async function getLatestCsmVersion(options?: {
  forceRefresh?: boolean;
  fetchImpl?: ReleaseFetch;
}): Promise<string | null> {
  const now = Date.now();
  if (!options?.forceRefresh && csmCache && now - csmCache.at < CACHE_TTL_MS)
    return csmCache.version;
  const doFetch: ReleaseFetch = options?.fetchImpl ?? (fetch as unknown as ReleaseFetch);
  try {
    const response = await doFetch(CSM_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Auto-Tournament' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { tag_name?: string } | null;
    const version = body?.tag_name ? body.tag_name.replace(/^v/i, '') : null;
    csmCache = { version: version && parseVersion(version) ? version : null, at: now };
    return csmCache.version;
  } catch (error) {
    log.warn('[PLUGIN-VERSION] Failed to fetch the csm release from GitHub', {
      error: (error as Error).message,
    });
    return null;
  }
}
