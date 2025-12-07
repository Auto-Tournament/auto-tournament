/**
 * Utility to fetch CS2 maps from GitHub repository
 * Used during database initialization to get the latest maps list
 */

import fetch from 'node-fetch';
import { log } from './logger';

const GITHUB_REPO_API =
  'https://api.github.com/repos/sivert-io/cs2-server-manager/contents/map_thumbnails';
const GITHUB_RAW_BASE =
  'https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails';

/**
 * Get GitHub API headers with optional authentication
 * Uses GITHUB_TOKEN environment variable if available to avoid rate limits
 */
function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'matchzy-auto-tournament',
  };

  // Use GitHub token if available (helps avoid rate limits)
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
    log.info('Using GITHUB_TOKEN for API authentication');
  } else {
    log.warn(
      'No GITHUB_TOKEN found. GitHub API rate limit is 60 requests/hour for unauthenticated requests. ' +
        'Set GITHUB_TOKEN environment variable to increase rate limit to 5000 requests/hour.'
    );
  }

  return headers;
}

export interface MapData {
  id: string;
  displayName: string;
  imageUrl: string;
}

/**
 * GitHub API response for file contents
 */
interface GitHubFile {
  name: string;
  path: string;
  download_url: string;
  type: string;
}

/**
 * Convert map ID to display name
 * Examples: de_ancient -> Ancient, de_dust2 -> Dust II
 */
function mapIdToDisplayName(mapId: string): string {
  // Remove prefix (de_, cs_, ar_)
  let name = mapId.replace(/^(de_|cs_|ar_)/, '');

  // Handle special cases
  const specialCases: Record<string, string> = {
    dust2: 'Dust II',
    shortdust: 'Shortdust',
    pool_day: 'Pool Day',
    ancient_night: 'Ancient (Night)',
    shoots_night: 'Shoots (Night)',
  };

  if (specialCases[name]) {
    return specialCases[name];
  }

  // Capitalize first letter of each word
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extract map ID from filename (e.g., "de_dust2.png" -> "de_dust2")
 * Filters out non-map files like lobby_mapveto.png and random.png
 */
function extractMapId(filename: string): string | null {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');

  // Skip non-map files
  const excludedFiles = ['lobby_mapveto', 'random'];
  if (excludedFiles.includes(nameWithoutExt)) {
    return null;
  }

  // Check if it starts with de_, cs_, or ar_
  if (/^(de_|cs_|ar_)/.test(nameWithoutExt)) {
    return nameWithoutExt;
  }

  return null;
}

/**
 * Fetch and parse CS2 maps from GitHub repository
 * Source: https://github.com/sivert-io/cs2-server-manager/tree/master/map_thumbnails
 * Throws error if fetch fails - no fallback to ensure we always use the actual repository
 */
export async function fetchCS2MapsFromWiki(): Promise<MapData[]> {
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log.info(
        `Fetching CS2 maps from GitHub repository (attempt ${attempt}/${maxRetries}): ${GITHUB_REPO_API}...`
      );

      const response = await fetch(GITHUB_REPO_API, {
        timeout: 15000, // 15 second timeout (increased from 10)
        headers: getGitHubHeaders(),
      });

      if (!response.ok) {
        // Handle rate limiting
        if (response.status === 403) {
          const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
          const rateLimitReset = response.headers.get('x-ratelimit-reset');
          throw new Error(
            `GitHub API rate limit exceeded. Remaining: ${rateLimitRemaining || 'unknown'}. ` +
              `Reset at: ${
                rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toISOString() : 'unknown'
              }. ` +
              `Repository: https://github.com/sivert-io/cs2-server-manager/tree/master/map_thumbnails`
          );
        }
        throw new Error(
          `Failed to fetch GitHub repository: ${response.status} ${response.statusText}`
        );
      }

      const files = (await response.json()) as GitHubFile[];

      if (!Array.isArray(files)) {
        throw new Error('Invalid response from GitHub API: expected array of files');
      }

      const maps: MapData[] = [];

      // Filter and process files
      for (const file of files) {
        // Only process files (not directories)
        if (file.type !== 'file') {
          continue;
        }

        // Extract map ID from filename
        const mapId = extractMapId(file.name);
        if (!mapId) {
          continue; // Skip files that don't match de_, cs_, or ar_ pattern
        }

        // Generate display name from map ID
        const displayName = mapIdToDisplayName(mapId);

        // Use the download_url from GitHub API, or construct raw URL
        const imageUrl = file.download_url || `${GITHUB_RAW_BASE}/${file.name}`;

        maps.push({
          id: mapId,
          displayName,
          imageUrl,
        });

        log.info(`Found map: ${mapId} - ${displayName}`);
      }

      if (maps.length === 0) {
        throw new Error(
          'No maps found in repository. ' +
            'Please ensure the repository contains map thumbnail files: ' +
            'https://github.com/sivert-io/cs2-server-manager/tree/master/map_thumbnails'
        );
      }

      log.success(`Successfully fetched ${maps.length} maps from GitHub repository`);
      return maps;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        log.error(`Failed to fetch maps from GitHub after ${maxRetries} attempts: ${errorMessage}`);
        throw new Error(
          `Failed to fetch maps from GitHub repository after ${maxRetries} attempts. ` +
            `Repository: https://github.com/sivert-io/cs2-server-manager/tree/master/map_thumbnails. ` +
            `Error: ${errorMessage}`
        );
      }

      // Otherwise, log warning and retry
      log.warn(
        `Attempt ${attempt}/${maxRetries} failed: ${errorMessage}. Retrying in ${retryDelay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new Error('Failed to fetch maps from GitHub repository');
}
