/**
 * Utility to fetch CS2 maps from Valve Developer Community wiki
 * Used during database initialization to get the latest maps list
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { log } from './logger';

const WIKI_URL = 'https://developer.valvesoftware.com/wiki/Counter-Strike_2/Maps';
const GITHUB_IMAGE_BASE =
  'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2';

/**
 * Blacklist of non-competitive maps that should never be included
 * Only includes maps that are confirmed to exist in CS2 but are not competitive
 * This is a safety net in case the Competitive column detection fails
 *
 * Verified maps that exist but are non-competitive:
 * - de_palacio: Community map, not in competitive pool
 * - cs_office, de_office: Hostage rescue maps, not competitive
 * - cs_italy, de_italy: Hostage rescue maps, not competitive
 * - de_canals: Removed from competitive pool
 * - de_cobblestone (de_cbble): Removed from competitive pool
 */
const NON_COMPETITIVE_MAPS = new Set([
  'de_palacio', // Community map, not competitive
  'cs_office', // Hostage rescue, not competitive
  'de_office', // Hostage rescue, not competitive
  'cs_italy', // Hostage rescue, not competitive
  'de_italy', // Hostage rescue, not competitive
  'de_canals', // Removed from competitive pool
  'de_cbble', // Cobblestone - removed from competitive pool
  'de_golden', // Golden
]);

export interface MapData {
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
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Fetch and parse CS2 maps from the wiki
 * Returns empty array if fetch fails (caller should use fallback)
 */
export async function fetchCS2MapsFromWiki(): Promise<MapData[]> {
  try {
    log.info(`Fetching CS2 maps from ${WIKI_URL}...`);

    const response = await fetch(WIKI_URL, {
      timeout: 10000, // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch wiki page: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const maps: MapData[] = [];

    // Find the "Current Maps" section heading
    // Try different selectors - the wiki might use different heading levels
    let currentMapsHeading = $('h2')
      .filter((_, el) => {
        const text = $(el).text().trim();
        return text.includes('Current Maps');
      })
      .first();

    if (currentMapsHeading.length === 0) {
      // Try h3 as well
      currentMapsHeading = $('h3')
        .filter((_, el) => {
          const text = $(el).text().trim();
          return text.includes('Current Maps');
        })
        .first();
    }

    if (currentMapsHeading.length === 0) {
      // Try finding by span with id or class (MediaWiki structure)
      const headlineSpan = $('span.mw-headline')
        .filter((_, el) => {
          const text = $(el).text().trim();
          return text.includes('Current Maps');
        })
        .first();

      if (headlineSpan.length > 0) {
        currentMapsHeading = headlineSpan.parent();
      }
    }

    if (currentMapsHeading.length === 0) {
      log.warn('Could not find "Current Maps" heading, will search all tables');
    } else {
      log.info('Found "Current Maps" heading');
    }

    let targetTable: cheerio.Cheerio<cheerio.Element> | null = null;

    if (currentMapsHeading.length > 0) {
      // Find the table that comes after the Current Maps heading
      // Look through siblings and next elements (including nested tables)
      currentMapsHeading.nextAll().each((_, el) => {
        const $el = $(el);
        // Check if this element is a table
        if ($el.is('table.wikitable') || $el.is('table')) {
          targetTable = $el;
          return false; // Break the loop
        }
        // Also check if this element contains a table
        const nestedTable = $el.find('table.wikitable, table').first();
        if (nestedTable.length > 0) {
          targetTable = nestedTable;
          return false; // Break the loop
        }
        return undefined;
      });
    }

    // If still not found, try finding all tables and look for one with map data
    if (!targetTable || targetTable.length === 0) {
      const allTables = $('table.wikitable, table');
      log.info(`Found ${allTables.length} tables on the page`);

      // Look for a table that has map-like content (contains de_, cs_ prefixes)
      for (let i = 0; i < allTables.length; i++) {
        const table = $(allTables[i]);
        const tableText = table.text();
        // Check if table contains map IDs (de_ or cs_)
        if (/de_|cs_/.test(tableText)) {
          targetTable = table;
          log.info(`Found maps table at index ${i}`);
          break;
        }
      }
    }

    // Final fallback: use the first table
    if (!targetTable || targetTable.length === 0) {
      const tables = $('table.wikitable, table');
      if (tables.length > 0) {
        targetTable = tables.first();
        log.info('Using first table as fallback');
      }
    }

    // Ensure we have a valid table
    if (!targetTable || targetTable.length === 0) {
      throw new Error('Could not find maps table');
    }

    // Find the Competitive column index from header row
    // The wiki table has a complex structure with "Officially Playable CS2 Game Modes"
    // as a header spanning multiple columns, followed by individual game mode columns
    let competitiveColumnIndex = -1;

    // Check all rows for headers - the table might have multiple header rows
    const allRows = targetTable.find('tr');
    let headerRow = allRows.first();
    let secondHeaderRow: cheerio.Cheerio<cheerio.Element> | null = null;

    // Check if there's a second row that might have game mode headers
    if (allRows.length > 1) {
      const secondRow = allRows.eq(1);
      if (secondRow.find('th, td').length > 0) {
        secondHeaderRow = secondRow;
      }
    }

    const headerCells = headerRow.find('th, td');

    log.info(`Searching for Competitive column in ${headerCells.length} header cells`);

    // Log first row headers
    headerCells.each((index, cell) => {
      const cellText = $(cell).text().trim();
      log.info(`Header cell ${index}: "${cellText}"`);
    });

    // Look for "Officially Playable CS2 Game Modes" header to find where game modes start
    let gameModesStartIndex = -1;
    headerCells.each((index, cell) => {
      const cellText = $(cell).text().trim().toLowerCase();
      const colspan = parseInt($(cell).attr('colspan') || '1', 10);
      if (cellText.includes('officially playable') || cellText.includes('game modes')) {
        gameModesStartIndex = index;
        log.info(`Found "Game Modes" header at index ${index}, colspan: ${colspan}`);
        return false;
      }
      return undefined;
    });

    // If we found the Game Modes header, check the second header row for Competitive
    if (gameModesStartIndex >= 0 && secondHeaderRow) {
      const secondRowCells = secondHeaderRow.find('th, td');
      log.info(`Checking second header row with ${secondRowCells.length} cells for Competitive`);

      // Log second row cells for debugging
      secondRowCells.each((index, cell) => {
        const cellText = $(cell).text().trim();
        const cellHtml = $(cell).html() || '';
        log.info(
          `Second header cell ${index}: "${cellText}" (html: "${cellHtml.substring(0, 100)}")`
        );
      });

      // Count actual columns before Game Modes in first row (accounting for colspan)
      let columnsBeforeGameModes = 0;
      headerCells.each((idx, c) => {
        if (idx < gameModesStartIndex) {
          const cColspan = parseInt($(c).attr('colspan') || '1', 10);
          columnsBeforeGameModes += cColspan;
        }
        return undefined;
      });

      // The Competitive column should be in the second row
      // The second row cells correspond to columns starting from gameModesStartIndex
      secondRowCells.each((index, cell) => {
        const cellText = $(cell).text().trim().toLowerCase();
        const cellHtml = $(cell).html() || '';

        // Check both text and HTML (might be a link or have special formatting)
        if (
          cellText.includes('competitive') ||
          cellText === 'competitive' ||
          cellHtml.toLowerCase().includes('competitive')
        ) {
          // Calculate offset in second row (accounting for colspan)
          let offsetInSecondRow = 0;
          secondRowCells.each((idx, c) => {
            if (idx < index) {
              const cColspan = parseInt($(c).attr('colspan') || '1', 10);
              offsetInSecondRow += cColspan;
            }
            return undefined;
          });

          competitiveColumnIndex = columnsBeforeGameModes + offsetInSecondRow;
          log.info(
            `Found Competitive column at data index ${competitiveColumnIndex} (columns before Game Modes: ${columnsBeforeGameModes}, offset in second row: ${offsetInSecondRow})`
          );
          return false;
        }
        return undefined;
      });

      // If Competitive not found in second row, check a sample data row to find it
      // Look at the first data row and check which column has "Yes" for competitive maps
      if (competitiveColumnIndex === -1) {
        log.info('Competitive not found in second row, checking sample data row...');

        // Find first data row (skip header rows)
        // Calculate rowsToSkip here since we're inside the conditional block
        const rowsToSkipForSample = secondHeaderRow ? 2 : 1;
        const allTableRows = targetTable.find('tr');
        const dataRows = allTableRows.slice(rowsToSkipForSample);
        if (dataRows.length > 0) {
          const firstDataRow = $(dataRows[0]);
          const dataCells = firstDataRow.find('td');

          // Look for a cell that contains "Yes" - this is likely the Competitive column
          // Start from columnsBeforeGameModes (where game modes start)
          for (
            let i = columnsBeforeGameModes;
            i < Math.min(dataCells.length, columnsBeforeGameModes + 10);
            i++
          ) {
            const cellText = $(dataCells[i]).text().trim().toLowerCase();
            // Check if this looks like a Competitive cell (has "Yes" or "No")
            if (cellText === 'yes' || cellText === 'no') {
              // Check a few competitive maps to confirm this is the Competitive column
              let yesCount = 0;
              let noCount = 0;

              // Check first 5 data rows
              dataRows.slice(0, 5).each((_, row) => {
                const cells = $(row).find('td');
                if (cells.length > i) {
                  const cellVal = $(cells[i]).text().trim().toLowerCase();
                  if (cellVal === 'yes') yesCount++;
                  if (cellVal === 'no') noCount++;
                }
                return undefined;
              });

              // If we see both Yes and No, this is likely the Competitive column
              if (yesCount > 0 && noCount > 0) {
                competitiveColumnIndex = i;
                log.info(
                  `Found Competitive column at data index ${competitiveColumnIndex} by checking sample rows (Yes: ${yesCount}, No: ${noCount})`
                );
                break;
              }
            }
          }
        }

        // Final fallback: assume Competitive is the first game mode column
        if (competitiveColumnIndex === -1) {
          log.info(
            'Competitive not found by checking data, assuming it is the first game mode column'
          );
          competitiveColumnIndex = columnsBeforeGameModes;
          log.info(
            `Using Competitive column at data index ${competitiveColumnIndex} (first game mode column)`
          );
        }
      }
    }

    // Fallback: search for Competitive directly in first header row
    if (competitiveColumnIndex === -1) {
      headerCells.each((index, cell) => {
        const cellText = $(cell).text().trim().toLowerCase();
        if (cellText.includes('competitive') && !cellText.includes('game modes')) {
          competitiveColumnIndex = index;
          log.info(`Found Competitive column at index ${index} (fallback)`);
          return false;
        }
        return undefined;
      });
    }

    if (competitiveColumnIndex === -1) {
      log.warn(
        'Could not find Competitive column in table header - will use fallback: include all de_/cs_ maps'
      );
    }

    // Parse table rows (skip header rows)
    // If there's a second header row, we need to skip both
    // Declare rowsToSkip early so it can be used in the Competitive column detection logic
    const rowsToSkip = secondHeaderRow ? 2 : 1;
    let rowIndex = 0;

    targetTable.find('tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');

      // Skip header rows
      if (rowIndex < rowsToSkip) {
        rowIndex++;
        return; // Skip this header row
      }
      rowIndex++;

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
      const internalNameMatch = internalName.match(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/);
      if (internalNameMatch) {
        internalName = internalNameMatch[1];
      }

      // Clean up the internal name
      const mapId = internalName.trim();

      if (!mapId) {
        return; // Skip empty rows
      }

      // Only include de_ and cs_ maps (filter out ar_ maps)
      if (!/^(de_|cs_)/.test(mapId)) {
        return;
      }

      // Blacklist: Never include non-competitive maps
      if (NON_COMPETITIVE_MAPS.has(mapId)) {
        log.info(`Skipping ${mapId} - Blacklisted as non-competitive map`);
        return;
      }

      // Check if map is playable in Competitive mode
      // Only include maps where Competitive explicitly says "Yes" (whitelist approach)
      if (competitiveColumnIndex >= 0) {
        if (cells.length <= competitiveColumnIndex) {
          // Missing competitive column data - skip
          log.info(`Skipping ${mapId} - Missing Competitive column data`);
          return;
        }

        const competitiveCell = $(cells[competitiveColumnIndex]);
        const competitiveText = competitiveCell.text().trim();
        const competitiveTextLower = competitiveText.toLowerCase();

        // Check for various "No" indicators (more comprehensive)
        const isNo =
          competitiveTextLower === 'no' ||
          (competitiveTextLower.includes('no') && !competitiveTextLower.includes('yes')) ||
          competitiveText === '' ||
          competitiveText.trim() === '' ||
          competitiveTextLower === '‌no'; // Special no-break space

        // Only include if it explicitly contains "yes" (case insensitive)
        // This is a whitelist approach - only include maps that are explicitly marked as competitive
        const isYes = competitiveTextLower.includes('yes') || competitiveTextLower === 'yes';

        if (isNo || !isYes) {
          // Only log skipped maps for debugging problematic ones
          if (
            mapId.includes('rooftop') ||
            mapId.includes('golden') ||
            mapId.includes('palacio') ||
            mapId.includes('night')
          ) {
            log.info(
              `Skipping ${mapId} - Competitive: "${competitiveText}" (isNo: ${isNo}, isYes: ${isYes})`
            );
          }
          return; // Skip maps not explicitly marked as playable in competitive
        }
      } else {
        // If Competitive column not found, log warning but don't skip
        // This allows maps to be included if column detection fails
        // But we should try to fix the column detection
        log.warn(
          `Competitive column not found - including ${mapId} without competitive check (this should be fixed)`
        );
        // Don't return - allow the map to be included as fallback
      }

      // Clean up map name (remove wiki links, etc.)
      const mapNameMatch = mapName.match(/\[\[[^|]+\|([^\]]+)\]\]/);
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
    });

    if (maps.length === 0) {
      throw new Error('No maps found in table');
    }

    log.success(`Successfully fetched ${maps.length} maps from wiki`);
    return maps;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.warn(`Failed to fetch maps from wiki: ${errorMessage}. Using fallback maps.`);
    return []; // Return empty array to trigger fallback
  }
}
