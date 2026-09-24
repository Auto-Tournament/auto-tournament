import { log } from '../../../utils/logger';
import fetch from 'node-fetch';

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
