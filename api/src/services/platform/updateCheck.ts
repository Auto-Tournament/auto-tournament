/**
 * Is a newer Auto Tournament out? The running version (package.json) against
 * the platform's GitHub releases, on the same channel: a beta compares with
 * every release including betas, a stable build only with stable releases.
 * One lookup an hour; any failure is "don't know", never an error to show.
 * The admin UI shows a toast once per new version (UpdateToast).
 */
import fetch from 'node-fetch';
import semver from 'semver';
import packageJson from '../../../package.json';
import { log } from '../../utils/logger';

export const PLATFORM_RELEASES_URL =
  'https://api.github.com/repos/Auto-Tournament/auto-tournament/releases?per_page=30';
const CACHE_MS = 60 * 60 * 1000;

export interface PlatformUpdate {
  running: string;
  latest: string | null;
  available: boolean;
  releaseUrl: string | null;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
}

type ReleaseFetch = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

let cache: { at: number; latest: { version: string; url: string } | null; channel: string } | null =
  null;

/** Test hook. */
export function resetPlatformUpdateCache(): void {
  cache = null;
}

const clean = (v: string) => semver.valid(v.trim().replace(/^v/i, ''));

/**
 * The newest release on `running`'s channel (pure: tested on its own): betas
 * see every release, a stable build only stable ones; drafts never.
 */
export function newestRelease(
  releases: GitHubRelease[],
  running: string
): { version: string; url: string } | null {
  const beta = (semver.prerelease(clean(running) ?? '') ?? []).length > 0;
  let best: { version: string; url: string } | null = null;
  for (const r of releases) {
    if (r.draft || (!beta && r.prerelease)) continue;
    const v = clean(r.tag_name ?? '');
    if (!v || (!beta && semver.prerelease(v))) continue;
    if (!best || semver.gt(v, best.version)) best = { version: v, url: r.html_url ?? '' };
  }
  return best;
}

export async function checkPlatformUpdate(options?: {
  running?: string;
  fetchImpl?: ReleaseFetch;
  forceRefresh?: boolean;
}): Promise<PlatformUpdate> {
  const running = options?.running ?? packageJson.version;
  const channel = (semver.prerelease(clean(running) ?? '') ?? []).length > 0 ? 'beta' : 'stable';
  const now = Date.now();
  if (!options?.forceRefresh && cache && cache.channel === channel && now - cache.at < CACHE_MS) {
    return result(running, cache.latest);
  }
  const doFetch: ReleaseFetch = options?.fetchImpl ?? (fetch as unknown as ReleaseFetch);
  try {
    const res = await doFetch(PLATFORM_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Auto-Tournament' },
    });
    if (!res.ok) {
      log.warn('[UPDATE] Could not read the platform releases', { status: res.status });
      return result(running, null);
    }
    const latest = newestRelease((await res.json()) as GitHubRelease[], running);
    cache = { at: now, latest, channel };
    return result(running, latest);
  } catch (error) {
    log.warn('[UPDATE] Could not read the platform releases', { error: (error as Error).message });
    return result(running, null);
  }
}

function result(running: string, latest: { version: string; url: string } | null): PlatformUpdate {
  const r = clean(running);
  return {
    running,
    latest: latest?.version ?? null,
    available: !!(latest && r && semver.gt(latest.version, r)),
    releaseUrl: latest?.url || null,
  };
}
