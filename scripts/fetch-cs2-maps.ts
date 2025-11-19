#!/usr/bin/env tsx
/**
 * Script to fetch and parse CS2 maps from Valve Developer Community wiki
 * 
 * Usage: tsx scripts/fetch-cs2-maps.ts
 * 
 * This script fetches the official CS2 maps list from:
 * https://developer.valvesoftware.com/wiki/Counter-Strike_2/Maps
 * 
 * It extracts all "Current Maps" and generates the maps array format
 * used in database.schema.ts
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { writeFile } from 'fs/promises';

const WIKI_URL = 'https://developer.valvesoftware.com/wiki/Counter-Strike_2/Maps';
const GITHUB_IMAGE_BASE = 'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2';

interface MapData {
  id: string;
  displayName: string;
  imageUrl: string;
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
 * Fetch and parse the CS2 maps wiki page
 */
async function fetchCS2Maps(): Promise<MapData[]> {
  console.log(`Fetching CS2 maps from ${WIKI_URL}...`);
  
  const response = await fetch(WIKI_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch wiki page: ${response.statusText}`);
  }
  
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const maps: MapData[] = [];
  
  // Find all tables on the page
  const tables = $('table.wikitable');
  
  if (tables.length === 0) {
    throw new Error('Could not find any tables on the page');
  }
  
  // Find the "Current Maps" section heading
  const currentMapsHeading = $('h2, h3').filter((_, el) => {
    const text = $(el).text().trim();
    return text.includes('Current Maps');
  }).first();
  
  if (currentMapsHeading.length === 0) {
    throw new Error('Could not find "Current Maps" section');
  }
  
  // Find the table that comes after the Current Maps heading
  // Look for the first table after the heading
  let targetTable = null;
  currentMapsHeading.nextAll().each((_, el) => {
    if ($(el).is('table.wikitable')) {
      targetTable = $(el);
      return false; // Break the loop
    }
  });
  
  if (!targetTable || targetTable.length === 0) {
    // Fallback: use the first table
    targetTable = tables.first();
    console.log('Warning: Using first table as fallback');
  }
  
  console.log('Parsing maps table...');
  
  // Parse table rows (skip header row)
  let isFirstRow = true;
  targetTable.find('tr').each((index, row) => {
    const $row = $(row);
    const cells = $row.find('td');
    
    // Skip header row (usually has th elements or is the first row)
    if (isFirstRow) {
      isFirstRow = false;
      // Check if this is actually a header row
      if ($row.find('th').length > 0 || cells.length === 0) {
        return;
      }
    }
    
    if (cells.length < 3) {
      return; // Skip rows without enough cells
    }
    
    // Column 1: Icon (we can skip this)
    // Column 2: Map Name (display name)
    // Column 3: Internal Name (map ID)
    let mapName = $(cells[1]).text().trim();
    let internalName = $(cells[2]).text().trim();
    
    // Handle wiki link format: [[de_ancient|Ancient]] or [[de_ancient]]
    // Extract the actual map ID from wiki links
    const internalNameMatch = internalName.match(/\[\[([^\|\]]+)(?:\|[^\]]+)?\]\]/);
    if (internalNameMatch) {
      internalName = internalNameMatch[1];
    }
    
    // Clean up the internal name
    const mapId = internalName.trim();
    
    if (!mapId) {
      return; // Skip empty rows
    }
    
    // Skip if it's not a valid map ID format (de_, cs_, ar_)
    if (!/^(de_|cs_|ar_)/.test(mapId)) {
      return;
    }
    
    // Clean up map name (remove wiki links, etc.)
    const mapNameMatch = mapName.match(/\[\[[^\|]+\|([^\]]+)\]\]/);
    if (mapNameMatch) {
      mapName = mapNameMatch[1];
    } else {
      const simpleLinkMatch = mapName.match(/\[\[([^\]]+)\]\]/);
      if (simpleLinkMatch) {
        mapName = simpleLinkMatch[1];
      }
    }
    
    // Generate display name if map name is empty or use the provided one
    const displayName = mapName || mapIdToDisplayName(mapId);
    
    // Generate image URL
    const imageUrl = `${GITHUB_IMAGE_BASE}/${mapId}.png`;
    
    maps.push({
      id: mapId,
      displayName,
      imageUrl,
    });
    
    console.log(`  Found: ${mapId} - ${displayName}`);
  });
  
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

