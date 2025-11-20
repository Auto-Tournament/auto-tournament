/**
 * Utility to fetch CS2 maps from GitHub repository
 * Used during database initialization to get the latest maps list
 */

import fetch from 'node-fetch';
import { log } from './logger';

const GITHUB_REPO_API = 'https://api.github.com/repos/sivert-io/cs2-server-manager/contents/map_thumbnails';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails';

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
 */
function extractMapId(filename: string): string | null {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
  
  // Check if it starts with de_, cs_, or ar_
  if (/^(de_|cs_|ar_)/.test(nameWithoutExt)) {
    return nameWithoutExt;
  }
  
  return null;
}

/**
 * Fetch and parse CS2 maps from GitHub repository
 * Returns empty array if fetch fails (caller should use fallback)
 */
export async function fetchCS2MapsFromWiki(): Promise<MapData[]> {
  try {
    log.info(`Fetching CS2 maps from GitHub repository: ${GITHUB_REPO_API}...`);

    const response = await fetch(GITHUB_REPO_API, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'matchzy-auto-tournament',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch GitHub repository: ${response.statusText}`);
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
      throw new Error('No maps found in repository');
    }

    log.success(`Successfully fetched ${maps.length} maps from GitHub repository`);
    return maps;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.warn(`Failed to fetch maps from GitHub: ${errorMessage}. Using fallback maps.`);
    return []; // Return empty array to trigger fallback
  }
}
