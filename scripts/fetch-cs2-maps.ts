#!/usr/bin/env tsx
/**
 * Script to fetch and parse CS2 maps from GitHub repository
 * 
 * Usage: tsx scripts/fetch-cs2-maps.ts
 * 
 * This script fetches CS2 map thumbnails from:
 * https://github.com/sivert-io/cs2-server-manager/tree/master/map_thumbnails
 * 
 * It extracts all map files (de_, cs_, ar_ prefixes) and generates the maps array format
 * used in database.schema.ts
 */

import fetch from 'node-fetch';
import { writeFile } from 'fs/promises';

const GITHUB_REPO_API = 'https://api.github.com/repos/sivert-io/cs2-server-manager/contents/map_thumbnails';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails';

interface MapData {
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
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
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
 */
async function fetchCS2Maps(): Promise<MapData[]> {
  console.log(`Fetching CS2 maps from GitHub repository: ${GITHUB_REPO_API}...`);
  
  const response = await fetch(GITHUB_REPO_API, {
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
    
    console.log(`  Found: ${mapId} - ${displayName}`);
  }
  
  return maps;
}

/**
 * Generate the maps array code for database.schema.ts
 */
function generateMapsCode(maps: MapData[]): string {
  const mapEntries = maps.map((map) => {
    const escapedDisplayName = map.displayName.replace(/'/g, "\\'");
    return `    {
      id: '${map.id}',
      display_name: '${escapedDisplayName}',
      image_url:
        '${map.imageUrl}',
    }`;
  });
  
  return mapEntries.join(',\n');
}

/**
 * Main function
 */
async function main() {
  try {
    const maps = await fetchCS2Maps();
    
    if (maps.length === 0) {
      console.error('No maps found!');
      process.exit(1);
    }
    
    console.log(`\n✅ Found ${maps.length} maps\n`);
    
    // Generate code
    const code = generateMapsCode(maps);
    
    console.log('Generated maps array code:\n');
    console.log('='.repeat(80));
    console.log(code);
    console.log('='.repeat(80));
    
    // Also save to a file for easy copy-paste
    const outputPath = 'scripts/cs2-maps-output.txt';
    await writeFile(outputPath, code, 'utf-8');
    console.log(`\n✅ Code saved to ${outputPath}`);
    console.log('\nYou can copy this code and replace the maps array in src/config/database.schema.ts');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

