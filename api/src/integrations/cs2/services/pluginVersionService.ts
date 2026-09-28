import { log } from '../../../utils/logger';
import fetch from 'node-fetch';
import type { ReadyUpRelease } from './readyUpVersion';

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
}

let cachedVersion: string | null = null;
let cachedReleaseUrl: string | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch the latest Auto Tournament CS2 release from GitHub
 * Uses caching to avoid rate limits (60 req/hour for unauthenticated)
 */
export async function getLatestPluginVersion(options?: {
  forceRefresh?: boolean;
}): Promise<{ version: string; releaseUrl: string } | null> {
  const now = Date.now();
  const cacheValid = cachedVersion && now - lastFetchTime < CACHE_TTL_MS;

  if (cacheValid && !options?.forceRefresh) {
    return {
      version: cachedVersion!,
      releaseUrl: cachedReleaseUrl!,
    };
  }

  try {
    log.debug('[PLUGIN-VERSION] Fetching latest Auto Tournament CS2 version from GitHub...');
    const response = await fetch(
      'https://api.github.com/repos/Auto-Tournament/cs2-plugin/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Auto-Tournament',
        },
      }
    );

    if (!response.ok) {
      log.warn('[PLUGIN-VERSION] Failed to fetch Auto Tournament CS2 version from GitHub', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const release = (await response.json()) as GitHubRelease;
    const version = release.tag_name.replace(/^v/, ''); // Strip leading 'v'

    cachedVersion = version;
    cachedReleaseUrl = release.html_url;
    lastFetchTime = now;

    log.info('[PLUGIN-VERSION] Fetched latest Auto Tournament CS2 version', {
      version,
      published: release.published_at,
    });

    return {
      version,
      releaseUrl: cachedReleaseUrl,
    };
  } catch (error) {
    log.warn('[PLUGIN-VERSION] Exception fetching Auto Tournament CS2 version from GitHub', { error });
    return null;
  }
}

/**
 * Initialize: fetch on startup (fire-and-forget)
 */
export function initPluginVersionService() {
  void getLatestPluginVersion({ forceRefresh: true });
}

// ---------------------------------------------------------------------------
// Ready Up (Auto-Tournament/ready-up)
// ---------------------------------------------------------------------------

export const READY_UP_RELEASE_URL =
  'https://api.github.com/repos/Auto-Tournament/ready-up/releases/latest';

type ReleaseFetch = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

let readyUpCache: { release: ReadyUpRelease | null; at: number } | null = null;

/** Test hook: forget the cached Ready Up lookup. */
export function resetReadyUpReleaseCache(): void {
  readyUpCache = null;
}

/**
 * Latest Ready Up release, or null when there is none. Ready Up has no
 * releases yet, so GitHub's 404 is an expected "no release", not an error; any
 * other failure also yields null (and is not cached).
 */
export async function getLatestReadyUpRelease(options?: {
  forceRefresh?: boolean;
  fetchImpl?: ReleaseFetch;
}): Promise<ReadyUpRelease | null> {
  const now = Date.now();
  if (!options?.forceRefresh && readyUpCache && now - readyUpCache.at < CACHE_TTL_MS) {
    return readyUpCache.release;
  }
  const doFetch: ReleaseFetch = options?.fetchImpl ?? (fetch as unknown as ReleaseFetch);
  try {
    const response = await doFetch(READY_UP_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Auto-Tournament' },
    });
    if (response.status === 404) {
      readyUpCache = { release: null, at: now };
      return null;
    }
    if (!response.ok) {
      log.warn('[PLUGIN-VERSION] Failed to fetch Ready Up release from GitHub', { status: response.status });
      return null;
    }
    const release = (await response.json()) as Partial<GitHubRelease>;
    if (!release.tag_name) {
      readyUpCache = { release: null, at: now };
      return null;
    }
    const result: ReadyUpRelease = {
      version: release.tag_name.replace(/^v/, ''),
      releaseUrl: release.html_url ?? 'https://github.com/Auto-Tournament/ready-up/releases',
    };
    readyUpCache = { release: result, at: now };
    return result;
  } catch (error) {
    log.warn('[PLUGIN-VERSION] Exception fetching Ready Up release from GitHub', { error });
    return null;
  }
}
