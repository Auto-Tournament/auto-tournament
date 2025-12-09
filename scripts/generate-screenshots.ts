#!/usr/bin/env tsx
/**
 * Screenshot Generation Script
 *
 * This script uses Playwright to generate high-resolution screenshots of the application.
 * It creates test data (players, teams, servers, map pools, tournaments) by clicking buttons
 * on the /dev page, then navigates through the app taking screenshots of all major pages.
 *
 * Usage:
 *
 * Option 1 - Automatic (recommended): Starts Docker, generates screenshots, stops Docker
 *   yarn screenshot
 *
 * Option 2 - Keep Docker running after screenshots
 *   yarn screenshot:keep
 *
 * Option 3 - Manual: Requires server already running on http://localhost:3069
 *   yarn screenshot:generate
 *   or
 *   tsx scripts/generate-screenshots.ts
 *
 * Environment variables:
 *   PLAYWRIGHT_BASE_URL - Base URL of the application (default: http://localhost:3069)
 *   API_TOKEN - API token for authentication (default: admin123)
 */

import { chromium, Page, APIRequestContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { getAuthHeader } from '../tests/helpers/auth';

const SCREENSHOT_WIDTH = 2560;
const SCREENSHOT_HEIGHT = 1440;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const API_TOKEN = process.env.API_TOKEN || 'admin123';
const SCREENSHOT_DIR = path.join(process.cwd(), 'docs', 'assets', 'preview');

// Logging configuration – all console output is also written to log files
const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
const LOG_FILE = path.join(LOG_DIR, 'screenshots.log');

// Truncate log file at start of run so we only keep the latest execution
try {
  fs.writeFileSync(LOG_FILE, '');
} catch {
  // Ignore logging init errors
}

function appendLogLine(level: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Ignore logging errors – should never break screenshot generation
  }
}

// Patch console methods so all logs go to file + stdout
(function patchConsoleForLogging() {
  const levels: Array<'log' | 'info' | 'warn' | 'error'> = ['log', 'info', 'warn', 'error'];
  for (const level of levels) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      try {
        const text = args
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(' ');
        appendLogLine(level.toUpperCase(), text);
      } catch {
        // Ignore logging wrapper errors, but still write to original console
        original(...args);
        return;
      }
      // Still write to original console
      original(...args);
    };
  }
})();

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

interface ScreenshotConfig {
  path: string;
  name: string;
  waitFor?: string; // Selector to wait for
  waitTime?: number; // Time to wait in ms
  scrollToBottom?: boolean; // Whether to scroll to bottom before screenshot
}

/**
 * Helper to make API requests with full URL
 */
async function apiRequest(
  request: APIRequestContext,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  options?: { headers?: Record<string, string>; data?: unknown }
): Promise<unknown> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  return request[method](url, options);
}

/**
 * Create a server via API
 */
async function createServer(
  request: APIRequestContext,
  input: {
    id: string;
    name: string;
    host: string;
    port: number;
    password: string;
    enabled?: boolean;
  }
): Promise<unknown> {
  try {
    const response = await apiRequest(request, 'post', '/api/servers', {
      headers: getAuthHeader(),
      data: {
        ...input,
        enabled: input.enabled ?? true,
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Server creation failed:', errorText);
      return null;
    }

    const data = (await response.json()) as { server?: unknown };
    return data.server;
  } catch (error) {
    console.error('Server creation error:', error);
    return null;
  }
}

/**
 * Create a tournament (without starting it)
 */
async function createTournament(
  request: APIRequestContext,
  input: { name: string; type: string; format: string; maps: string[]; teamIds: string[] }
): Promise<unknown> {
  // Delete any existing tournament first to avoid conflicts
  try {
    await apiRequest(request, 'delete', '/api/tournament', {
      headers: getAuthHeader(),
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch {
    // Ignore errors if no tournament exists
  }

  // Create tournament
  try {
    const createResponse = await apiRequest(request, 'post', '/api/tournament', {
      headers: getAuthHeader(),
      data: input,
    });

    if (!createResponse.ok()) {
      const errorText = await createResponse.text();
      console.error('Tournament creation failed:', errorText);
      return null;
    }

    const createData = await createResponse.json();
    if (!createData.tournament) {
      console.error('Tournament creation response missing tournament:', createData);
      return null;
    }

    const tournament = createData.tournament;

    // Wait for bracket generation to complete
    // Bracket generation happens asynchronously, so we need to wait
    console.log('⏳ Waiting for bracket generation...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    return tournament;
  } catch (error) {
    console.error('Tournament creation error:', error);
    return null;
  }
}

/**
 * Start a tournament
 */
async function startTournament(request: APIRequestContext): Promise<boolean> {
  try {
    const startResponse = await apiRequest(request, 'post', '/api/tournament/start', {
      headers: getAuthHeader(),
    });

    if (!startResponse.ok()) {
      const errorText = await startResponse.text();
      console.error('Failed to start tournament:', errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Tournament start error:', error);
    return false;
  }
}

/**
 * Create map pool via API
 */
async function createMapPool(
  request: APIRequestContext,
  name: string,
  mapIds: string[]
): Promise<boolean> {
  try {
    const response = await apiRequest(request, 'post', '/api/map-pools', {
      headers: getAuthHeader(),
      data: {
        name,
        mapIds,
        enabled: true,
      },
    });
    return response.ok();
  } catch (error) {
    console.error(`Failed to create map pool ${name}:`, error);
    return false;
  }
}

/**
 * Wipe database via API
 */
async function wipeDatabase(request: APIRequestContext): Promise<boolean> {
  try {
    // Use the correct endpoint: POST /api/tournament/wipe-database
    const response = await apiRequest(request, 'post', '/api/tournament/wipe-database', {
      headers: getAuthHeader(),
    });
    if (response.ok()) {
      const data = await response.json();
      if (data.success) {
        console.log('✅ Database wiped successfully');
        return true;
      }
    }
    const errorText = await response.text();
    console.error('Database wipe failed:', errorText);
    return false;
  } catch (error) {
    console.error('Database wipe error:', error);
    return false;
  }
}

/**
 * Sign in via API (faster)
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/`);
  await page.evaluate((token) => {
    // eslint-disable-next-line no-undef
    localStorage.setItem('api_token', token);
  }, API_TOKEN);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for page to be ready - optimized with proper waits
 */
async function waitForPageReady(page: Page, selector?: string, waitTime?: number): Promise<void> {
  if (selector) {
    // Try multiple selectors if comma-separated
    const selectors = selector.split(',').map((s) => s.trim());
    let found = false;
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 2000, state: 'visible' });
        found = true;
        break;
      } catch {
        // Try next selector
      }
    }
    if (!found && selectors.length > 0) {
      // Try waiting for network idle as fallback
      await page.waitForLoadState('networkidle');
    }
  } else {
    // If no selector, just wait for network idle
    await page.waitForLoadState('networkidle');
  }
  // Wait a short time after element appears (0.5-1s)
  const finalWait = waitTime ? Math.min(waitTime, 1000) : 500;
  await page.waitForTimeout(finalWait);
}

/**
 * Compare two PNG images pixel-by-pixel
 * Returns true if images are identical (within threshold)
 */
function compareImages(img1Path: string, img2Path: string, threshold = 0.01): boolean {
  try {
    const img1 = PNG.sync.read(fs.readFileSync(img1Path));
    const img2 = PNG.sync.read(fs.readFileSync(img2Path));

    // Check if dimensions match
    if (img1.width !== img2.width || img1.height !== img2.height) {
      return false;
    }

    // Compare pixels
    const diff = new PNG({ width: img1.width, height: img1.height });
    const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {
      threshold: 0.1, // Color difference threshold (0-1)
    });

    // Calculate difference percentage
    const totalPixels = img1.width * img1.height;
    const diffPercentage = numDiffPixels / totalPixels;

    // Images are considered identical if difference is below threshold
    return diffPercentage < threshold;
  } catch (error) {
    // If comparison fails (e.g., file doesn't exist), consider them different
    return false;
  }
}

/**
 * Take screenshot with proper naming
 * Compares with existing screenshot and discards if identical
 */
async function takeScreenshot(page: Page, config: ScreenshotConfig): Promise<void> {
  const filePath = path.join(SCREENSHOT_DIR, `${config.name}.png`);
  const tempPath = path.join(SCREENSHOT_DIR, `${config.name}.tmp.png`);
  const existingPath = filePath;

  console.log(`📸 Taking screenshot: ${config.name}...`);

  // Wait for page to be ready
  if (config.waitFor || config.waitTime) {
    await waitForPageReady(page, config.waitFor, config.waitTime);
  } else {
    await page.waitForLoadState('networkidle');
  }

  // Scroll to bottom if requested
  if (config.scrollToBottom) {
    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(300);
    // Scroll back to top
    await page.evaluate(() => {
       
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(200);
  }

  // Take screenshot to temporary file first
  await page.screenshot({
    path: tempPath,
    fullPage: true,
  });

  // Check if existing screenshot exists and compare
  if (fs.existsSync(existingPath)) {
    const isIdentical = compareImages(tempPath, existingPath);
    if (isIdentical) {
      // Images are identical, discard the new one and keep the old
      fs.unlinkSync(tempPath);
      console.log(`⏭️  Skipped (unchanged): ${filePath}`);
      return;
    }
  }

  // Images are different or no existing image, move temp to final location
  fs.renameSync(tempPath, filePath);
  console.log(`✅ Saved: ${filePath}`);
}

/**
 * Generate test data by clicking buttons on the /dev page
 */
async function generateTestDataViaUI(page: Page): Promise<void> {
  console.log('\n📦 Generating test data by clicking buttons on /dev page...\n');

  // Navigate to dev page
  console.log(`🌐 Navigating to ${BASE_URL}/dev...`);
  await page.goto(`${BASE_URL}/dev`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // Wait for page to fully load

  // Check if we're on the dev page
  const currentUrl = page.url();
  console.log(`📍 Current URL: ${currentUrl}`);

  // Wait for page content to load
  try {
    await page.waitForSelector('button, .MuiCard-root', { timeout: 10000 });
    console.log('✅ Dev page loaded');
  } catch {
    console.warn('⚠️  Dev page may not be available, trying to find buttons anyway...');
  }

  // Generate players (click "Create 20 Players" button)
  try {
    console.log('👥 Creating players...');
    await page.waitForTimeout(1000);

    // Try multiple ways to find the button
    let clicked = false;

    // Method 1: By role with text
    try {
      const playerButton = page.getByRole('button', { name: /create 20 players/i });
      if (await playerButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await playerButton.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await playerButton.click();
        await page.waitForTimeout(1500); // Wait for operation
        console.log('✅ Created players (method 1)');
        clicked = true;
      }
    } catch {
      // Try next method
    }

    // Method 2: Find by text content
    if (!clicked) {
      try {
        const allButtons = await page.locator('button').all();
        for (const btn of allButtons) {
          const text = (await btn.textContent().catch(() => ''))?.trim() || '';
          if (text && /create.*20.*player/i.test(text)) {
            await btn.scrollIntoViewIfNeeded();
            await page.waitForTimeout(200);
            await btn.click();
            await page.waitForTimeout(1500);
            console.log(`✅ Created players (method 2: "${text}")`);
            clicked = true;
            break;
          }
        }
      } catch {
        // Continue
      }
    }

    if (!clicked) {
      console.warn('⚠️  Could not find player creation button');
    }
  } catch (error) {
    console.warn('⚠️  Could not create players:', error);
  }

  // Generate teams (click "Create 8 Teams" button)
  try {
    console.log('🏆 Creating teams...');
    await page.waitForTimeout(1000);

    let clicked = false;

    // Method 1: By role with text
    try {
      const teamButton = page.getByRole('button', { name: /create 8 teams/i });
      if (await teamButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await teamButton.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await teamButton.click();
        await page.waitForTimeout(1500);
        console.log('✅ Created teams (method 1)');
        clicked = true;
      }
    } catch {
      // Try next method
    }

    // Method 2: Find by text content
    if (!clicked) {
      try {
        const allButtons = await page.locator('button').all();
        for (const btn of allButtons) {
          const text = (await btn.textContent().catch(() => ''))?.trim() || '';
          if (text && /create.*8.*team/i.test(text)) {
            await btn.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await btn.click();
            await page.waitForTimeout(1500);
            console.log(`✅ Created teams (method 2: "${text}")`);
            clicked = true;
            break;
          }
        }
      } catch {
        // Continue
      }
    }

    if (!clicked) {
      console.warn('⚠️  Could not find team creation button');
    }
  } catch (error) {
    console.warn('⚠️  Could not create teams:', error);
  }

  // Generate servers (click "Create 3 Servers" button)
  try {
    console.log('🖥️  Creating servers...');
    await page.waitForTimeout(1000);

    let clicked = false;

    // Method 1: By role with text
    try {
      const serverButton = page.getByRole('button', { name: /create 3 servers/i });
      if (await serverButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await serverButton.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await serverButton.click();
        await page.waitForTimeout(1500);
        console.log('✅ Created servers (method 1)');
        clicked = true;
      }
    } catch {
      // Try next method
    }

    // Method 2: Find by text content
    if (!clicked) {
      try {
        const allButtons = await page.locator('button').all();
        for (const btn of allButtons) {
          const text = (await btn.textContent().catch(() => ''))?.trim() || '';
          if (text && /create.*3.*server/i.test(text)) {
            await btn.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await btn.click();
            await page.waitForTimeout(1500);
            console.log(`✅ Created servers (method 2: "${text}")`);
            clicked = true;
            break;
          }
        }
      } catch {
        // Continue
      }
    }

    if (!clicked) {
      console.warn('⚠️  Could not find server creation button');
    }
  } catch (error) {
    console.warn('⚠️  Could not create servers:', error);
  }

  console.log('\n✅ Test data generation complete!\n');
}

/**
 * Create players via API (fallback/helper)
 * @deprecated Currently unused - kept for reference
 */
async function createPlayers(request: APIRequestContext, count: number): Promise<unknown[]> {
  try {
    const players: Array<{ id: string; name: string; elo?: number }> = [];
    const playerNames = [
      'TestPlayer',
      'DemoUser',
      'DevGamer',
      'TestAccount',
      'DevPlayer',
      'TestUser',
      'DemoAccount',
      'DevAccount',
      'RandomPlayer',
      'TestGamer',
      'DevUser',
      'DemoGamer',
      'TestPro',
      'DevPro',
      'DemoPro',
    ];

    const baseTimestamp = Date.now();
    for (let i = 0; i < count; i++) {
      const uniquePart = String(baseTimestamp + i)
        .padStart(10, '0')
        .slice(-10);
      const steamId = `7656119${uniquePart}`;
      const nameIndex = Math.floor(i / playerNames.length);
      const baseName = playerNames[i % playerNames.length];
      const name = nameIndex > 0 ? `${baseName} ${nameIndex + 1}` : baseName;
      const elo = 2500 + (i % 10) * 100;

      players.push({ id: steamId, name, elo });
    }

    const response = await apiRequest(request, 'post', '/api/players/bulk-import', {
      headers: getAuthHeader(),
      data: players,
    });

    if (response.ok()) {
      const data = await response.json();
      return data.created || [];
    }
    return [];
  } catch (error) {
    console.error('Error creating players:', error);
    return [];
  }
}

/**
 * Create teams via API
 */
async function createTeams(request: APIRequestContext, count: number): Promise<any[]> {
  try {
    const teams: Array<{
      id: string;
      name: string;
      tag: string;
      players: Array<{ steamId: string; name: string }>;
    }> = [];
    const teamNames = [
      'Astralis',
      'Natus Vincere',
      'FaZe Clan',
      'Team Liquid',
      'G2 Esports',
      'Ninjas in Pyjamas',
      'Fnatic',
      'Vitality',
      'MOUZ',
      'Heroic',
      'FURIA',
      'Cloud9',
      'Team Spirit',
      'BIG',
      'Complexity',
      'ENCE',
    ];

    const realSteamIds = [
      '76561197960287930',
      '76561198013825972',
      '76561198067146383',
      '76561198021466528',
      '76561198059949467',
      '76561198077860982',
      '76561198041282941',
      '76561198012563928',
      '76561198063472351',
      '76561198084126937',
    ];

    const slugify = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

    for (let i = 0; i < count; i++) {
      const teamName = teamNames[i % teamNames.length];
      const suffixIndex = Math.floor(i / teamNames.length);
      const suffix = suffixIndex > 0 ? ` ${suffixIndex + 1}` : '';
      const fullName = `${teamName}${suffix}`;
      const slug = slugify(fullName);

      teams.push({
        id: `test-team-${slug}`,
        name: fullName,
        tag:
          teamName
            .replace(/[^A-Za-z0-9]/g, '')
            .substring(0, 3)
            .toUpperCase() || 'TST',
        players: Array.from({ length: 5 }, (_, playerIndex) => ({
          steamId: realSteamIds[(i * 5 + playerIndex) % realSteamIds.length],
          name: `Player ${playerIndex + 1}`,
        })),
      });
    }

    const response = await apiRequest(request, 'post', '/api/teams', {
      headers: getAuthHeader(),
      data: teams,
    });

    if (response.ok()) {
      const data = await response.json();
      return data.successful || [];
    }
    return [];
  } catch (error) {
    console.error('Error creating teams:', error);
    return [];
  }
}

/**
 * Create servers via API
 */
async function createServers(request: APIRequestContext, count: number): Promise<any[]> {
  try {
    const servers: Array<{
      id: string;
      name: string;
      host: string;
      port: number;
      password: string;
    }> = [];

    const baseTimestamp = Date.now();
    for (let i = 0; i < count; i++) {
      servers.push({
        id: `test-server-${baseTimestamp}-${i}`,
        name: `Test Server #${i + 1}`,
        host: '0.0.0.0', // IP 0.0.0.0 = always online (fake server)
        port: 27015 + i,
        password: 'test123',
      });
    }

    const response = await apiRequest(request, 'post', '/api/servers/batch', {
      headers: getAuthHeader(),
      data: servers,
    });

    if (response.ok()) {
      const data = await response.json();
      return data.successful || [];
    }
    return [];
  } catch (error) {
    console.error('Error creating servers:', error);
    return [];
  }
}

/**
 * Generate test data using UI (dev page)
 * This is the default method - it clicks buttons on the /dev page to create test data
 */
async function generateTestData(
  request: APIRequestContext,
  page: Page
): Promise<{
  players: unknown[];
  teams: unknown[];
  servers: unknown[];
  tournament: unknown | null;
}> {
  console.log('\n📦 Generating test data via UI (clicking buttons on /dev page)...\n');

  // Wipe database first
  console.log('🧹 Wiping database...');
  const wiped = await wipeDatabase(request);
  if (!wiped) {
    console.warn('⚠️  Database wipe may have failed, continuing anyway...');
  } else {
    // Wait a bit longer after successful wipe to ensure database is ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Generate data by clicking buttons on dev page
  await generateTestDataViaUI(page);

  // Fetch the created data to get the actual objects (needed for tournament creation)
  console.log('📥 Fetching created data...');
  let players: unknown[] = [];
  let teams: unknown[] = [];
  let servers: unknown[] = [];

  const playersResponse = await apiRequest(request, 'get', '/api/players', {
    headers: getAuthHeader(),
  });
  if (playersResponse.ok()) {
    const playersData = await playersResponse.json();
    players = playersData.players || [];
    console.log(`✅ Found ${players.length} players`);
  }

  const teamsResponse = await apiRequest(request, 'get', '/api/teams', {
    headers: getAuthHeader(),
  });
  if (teamsResponse.ok()) {
    const teamsData = await teamsResponse.json();
    teams = teamsData.teams || [];
    console.log(`✅ Found ${teams.length} teams`);
  }

  const serversResponse = await apiRequest(request, 'get', '/api/servers', {
    headers: getAuthHeader(),
  });
  if (serversResponse.ok()) {
    const serversData = await serversResponse.json();
    servers = serversData.servers || [];
    console.log(`✅ Found ${servers.length} servers`);
  }

  // Create map pools
  console.log('🗺️  Creating map pools...');
  const standardMaps = [
    'de_ancient',
    'de_anubis',
    'de_inferno',
    'de_mirage',
    'de_nuke',
    'de_overpass',
    'de_vertigo',
  ];
  const activeDutyMaps = [
    'de_ancient',
    'de_anubis',
    'de_inferno',
    'de_mirage',
    'de_nuke',
    'de_overpass',
    'de_vertigo',
  ];
  const cacheMaps = ['de_cache', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass'];

  await createMapPool(request, 'Active Duty', activeDutyMaps);
  await createMapPool(request, 'Standard', standardMaps);
  await createMapPool(request, 'Cache Pool', cacheMaps);
  console.log('✅ Created 3 map pools');

  // Create fake servers that will show as "online" (use IP 0.0.0.0)
  // Note: Dev page already creates servers with 0.0.0.0, so we don't need to create more
  // Just use the existing ones from the dev page
  console.log('🖥️  Using existing fake servers from dev page (IP 0.0.0.0 = always online)...');
  const fakeServers: unknown[] = [];

  // The dev page creates servers with 0.0.0.0, so we can just use those
  // No need to create additional ones
  if (servers.length > 0) {
    console.log(`✅ Using ${servers.length} existing servers (some may have IP 0.0.0.0)`);
  }

  // Configure webhook URL (required to start tournament)
  console.log('🔗 Configuring webhook URL...');
  try {
    await apiRequest(request, 'put', '/api/settings', {
      headers: getAuthHeader(),
      data: {
        webhookUrl: 'http://localhost:3000/webhook', // Dummy webhook for screenshots
      },
    });
    console.log('✅ Webhook configured');
  } catch (error) {
    console.warn('⚠️  Could not configure webhook:', error);
  }

  // Create tournament (4 teams, double elimination, BO3 for veto) - but don't start it yet
  console.log('🏟️  Creating tournament...');
  const tournament = await createTournament(request, {
    name: 'Screenshot Tournament',
    type: 'double_elimination',
    format: 'bo3',
    maps: standardMaps,
    teamIds: teams.slice(0, 4).map((t) => t.id),
  });
  if (!tournament) {
    console.warn('⚠️  Failed to create tournament, continuing without it...');
  } else {
    console.log('✅ Created tournament (not started yet - will start after screenshots)');
  }

  console.log('\n✅ Test data generation complete!\n');

  return { players, teams, servers: [...servers, ...fakeServers], tournament };
}

/**
 * Take screenshots of the tournament creation wizard (single elimination + shuffle config)
 */
async function takeTournamentCreationScreenshots(page: Page): Promise<void> {
  console.log('\n📸 Taking tournament creation wizard screenshots...\n');

  try {
    // Ensure we are on the welcome screen
    await page.goto(`${BASE_URL}/tournament`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="tournament-welcome-create-new"]', {
      timeout: 5000,
      state: 'visible',
    });
    await page.waitForTimeout(500);

    // Open the creation wizard
    await page.click('[data-testid="tournament-welcome-create-new"]');
    await page.waitForSelector('[data-testid="tournament-name-input"]', {
      timeout: 5000,
      state: 'visible',
    });
    await page.waitForTimeout(500);

    // Step 0: Name
    await page.fill('[data-testid="tournament-name-input"]', 'Weekend Cup – Single Elimination');
    await takeScreenshot(page, {
      path: '/tournament',
      name: 'tournament-step-name',
      waitFor: '[data-testid="tournament-name-input"]',
      waitTime: 500,
    });

    // Step 1: Type
    try {
      const nextButton = page.locator('[data-testid="tournament-next-button"]').first();
      await nextButton.waitFor({ timeout: 5000, state: 'visible' });
      await nextButton.click();
    } catch (error) {
      console.warn(
        '⚠️  Could not find "Next" button on Name step, skipping wizard screenshots:',
        error
      );
      return;
    }
    await page.waitForSelector('[data-testid="tournament-type-selector"]', {
      timeout: 5000,
      state: 'visible',
    });
    await page.waitForTimeout(500);

    // Single Elimination type selected
    try {
      await page.click('[data-testid="tournament-type-option-single_elimination"]');
      await page.waitForTimeout(300);
      await takeScreenshot(page, {
        path: '/tournament',
        name: 'tournament-type-single-elimination',
        waitFor: '[data-testid="tournament-type-selector"]',
        waitTime: 500,
      });
    } catch (error) {
      console.warn('⚠️  Could not capture single elimination type screenshot:', error);
    }

    // Double Elimination type
    try {
      await page.click('[data-testid="tournament-type-option-double_elimination"]');
      await page.waitForTimeout(300);
      await takeScreenshot(page, {
        path: '/tournament',
        name: 'tournament-type-double-elimination',
        waitFor: '[data-testid="tournament-type-selector"]',
        waitTime: 500,
      });
    } catch (error) {
      console.warn('⚠️  Could not capture double elimination type screenshot:', error);
    }

    // Shuffle tournament type
    try {
      await page.click('[data-testid="tournament-type-option-shuffle"]');
      await page.waitForTimeout(300);
      await takeScreenshot(page, {
        path: '/tournament',
        name: 'tournament-type-shuffle',
        waitFor: '[data-testid="tournament-type-option-shuffle"]',
        waitTime: 500,
      });
    } catch (error) {
      console.warn('⚠️  Could not capture shuffle type screenshot:', error);
    }

    // Set type back to single_elimination for the generic flow
    try {
      await page.click('[data-testid="tournament-type-option-single_elimination"]');
      await page.waitForTimeout(300);
    } catch {
      // Ignore if it fails; flow can still continue
    }

    // Step 2: Format (Best of X)
    try {
      const nextButton = page.locator('[data-testid="tournament-next-button"]').first();
      await nextButton.waitFor({ timeout: 5000, state: 'visible' });
      await nextButton.click();
      await page.waitForTimeout(500);
      await page.waitForSelector('text=Best of 3', { timeout: 5000 });
      await takeScreenshot(page, {
        path: '/tournament',
        name: 'tournament-step-format',
        waitFor: 'text=Best of 3',
        waitTime: 500,
      });
    } catch (error) {
      console.warn('⚠️  Could not capture format step screenshot:', error);
    }

    // Step 3: Maps (map pool selection)
    try {
      const nextButton = page.locator('[data-testid="tournament-next-button"]').first();
      await nextButton.waitFor({ timeout: 5000, state: 'visible' });
      await nextButton.click();
      await page.waitForTimeout(500);
      await page.waitForSelector('[data-testid="tournament-map-pool-select"]', {
        timeout: 5000,
        state: 'visible',
      });
      await takeScreenshot(page, {
        path: '/tournament',
        name: 'tournament-step-maps',
        waitFor: '[data-testid="tournament-map-pool-select"]',
        waitTime: 500,
      });
    } catch (error) {
      console.warn('⚠️  Could not capture maps step screenshot:', error);
    }

    // Step 4: Teams (team selection) for non-shuffle
    try {
      const nextButton = page.locator('[data-testid="tournament-next-button"]').first();
      await nextButton.waitFor({ timeout: 5000, state: 'visible' });
      await nextButton.click();
      await page.waitForTimeout(500);
      await takeScreenshot(page, {
        path: '/tournament',
        name: 'tournament-step-teams',
        waitFor: 'text=You need at least 2 teams, text=Add All',
        waitTime: 500,
      });
    } catch (error) {
      console.warn('⚠️  Could not capture teams step screenshot:', error);
    }

    // Step 5: Review
    try {
      const nextButton = page.locator('[data-testid="tournament-next-button"]').first();
      const hasNext = await nextButton.isVisible({ timeout: 3000 }).catch(() => false);

      // In most cases we're on the Teams step here and need one more "Next" to reach Review.
      // If the button isn't visible, assume we're already on the Review step.
      if (hasNext) {
        await nextButton.click();
        await page.waitForTimeout(500);
      } else {
        console.warn(
          '⚠️  Review step: "Next" button not visible, assuming we are already on the Review step'
        );
      }

      // Wait for either the review title or the primary action button ("Create Tournament"/"Save & Generate Brackets")
      await Promise.race([
        page.waitForSelector('[data-testid="tournament-name-display"]', {
          timeout: 10000,
          state: 'visible',
        }),
        page.waitForSelector('[data-testid="tournament-save-button"]', {
          timeout: 10000,
          state: 'visible',
        }),
      ]);

      await takeScreenshot(page, {
        path: '/tournament',
        name: 'tournament-step-review',
        waitFor: '[data-testid="tournament-save-button"], [data-testid="tournament-name-display"]',
        waitTime: 500,
      });
    } catch (error) {
      console.warn('⚠️  Could not capture review step screenshot:', error);
    }

    // Shuffle-specific configuration step (reuse the same wizard by going back to Type step)
    try {
      console.log('\n📸 Taking shuffle configuration step screenshot...\n');

      // Try to navigate back to the "Type" step inside the current wizard
      let atTypeStep = false;
      for (let i = 0; i < 6; i++) {
        const typeVisible = await page
          .locator('[data-testid="tournament-type-selector"]')
          .isVisible({ timeout: 1000 })
          .catch(() => false);

        if (typeVisible) {
          atTypeStep = true;
          break;
        }

        const backButton = page.locator('[data-testid="tournament-back-button"]').first();
        const canGoBack = await backButton.isVisible({ timeout: 1000 }).catch(() => false);
        if (!canGoBack) {
          break;
        }

        await backButton.click();
        await page.waitForTimeout(300);
      }

      if (!atTypeStep) {
        console.warn(
          '⚠️  Shuffle flow: could not navigate back to Type step, falling back to skipping shuffle screenshots'
        );
        return;
      }

      // We are now on the Type step – switch to Shuffle
      await page.click('[data-testid="tournament-type-option-shuffle"]');
      await page.waitForTimeout(300);

      // Go to Format step (info-only for shuffle)
      try {
        const nextButton2 = page.locator('[data-testid="tournament-next-button"]').first();
        const hasNext2 = await nextButton2.isVisible({ timeout: 3000 }).catch(() => false);
        if (hasNext2) {
          await nextButton2.click();
        } else {
          console.warn('⚠️  Shuffle flow: "Next" button not visible on Type step');
          return;
        }
      } catch (error) {
        console.warn('⚠️  Could not find "Next" button on Shuffle Type step:', error);
        return;
      }

      try {
        await page.waitForSelector('text=Shuffle tournaments use Best of 1 format', {
          timeout: 10000,
        });
      } catch (error) {
        console.warn('⚠️  Shuffle flow: format info text did not appear:', error);
        return;
      }

      await takeScreenshot(page, {
        path: '/tournament',
        name: 'shuffle-tournament-format',
        waitFor: 'text=Shuffle tournaments use Best of 1 format',
        waitTime: 500,
      });

      // Maps step
      try {
        const nextButton3 = page.locator('[data-testid="tournament-next-button"]').first();
        const hasNext3 = await nextButton3.isVisible({ timeout: 3000 }).catch(() => false);
        if (hasNext3) {
          await nextButton3.click();
        } else {
          console.warn('⚠️  Shuffle flow: "Next" button not visible on Format step');
          return;
        }
      } catch (error) {
        console.warn('⚠️  Could not find "Next" button on Shuffle Format step:', error);
        return;
      }

      try {
        await page.waitForSelector('[data-testid="tournament-map-pool-select"]', {
          timeout: 10000,
          state: 'visible',
        });
      } catch (error) {
        console.warn('⚠️  Shuffle flow: map pool select did not appear:', error);
        return;
      }

      await page.waitForTimeout(300);

      // Shuffle configuration step (step 4)
      try {
        const nextButton4 = page.locator('[data-testid="tournament-next-button"]').first();
        const hasNext4 = await nextButton4.isVisible({ timeout: 3000 }).catch(() => false);
        if (hasNext4) {
          await nextButton4.click();
        } else {
          console.warn('⚠️  Shuffle flow: "Next" button not visible on Maps step');
          return;
        }
      } catch (error) {
        console.warn('⚠️  Could not find "Next" button on Shuffle Maps step:', error);
        return;
      }

      await page.waitForSelector('[data-testid="shuffle-team-size-field"]', {
        timeout: 10000,
        state: 'visible',
      });

      await takeScreenshot(page, {
        path: '/tournament',
        name: 'shuffle-tournament-config',
        waitFor: '[data-testid="shuffle-team-size-field"]',
        waitTime: 500,
      });
    } catch (error) {
      console.warn('⚠️  Could not capture shuffle tournament config screenshots:', error);
    }
  } catch (error) {
    console.error('❌ Error during tournament wizard screenshots:', error);
  }
}

/**
 * Main screenshot generation function
 */
async function generateScreenshots(): Promise<void> {
  console.log('🚀 Starting screenshot generation...\n');
  console.log(`📐 Resolution: ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT}`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`📁 Output: ${SCREENSHOT_DIR}\n`);

  const browser = await chromium.launch({
    headless: false, // Show browser so user can watch
  });

  const context = await browser.newContext({
    viewport: {
      width: SCREENSHOT_WIDTH,
      height: SCREENSHOT_HEIGHT,
    },
  });

  const page = await context.newPage();
  const request = context.request;

  try {
    // Sign in
    console.log('🔐 Signing in...');
    await signIn(page);
    console.log('✅ Signed in\n');

    // Generate test data by clicking buttons on /dev page
    const testData = await generateTestData(request, page);

    // Take screenshots of modals and special UI states
    // Note: We need to take these BEFORE creating the tournament, but AFTER data generation
    console.log('\n📸 Taking modal and special UI screenshots...\n');

    // 1. Tournament Welcome Screen (before creating tournament)
    // Delete any existing tournament first to show welcome screen
    try {
      console.log('📸 Taking tournament welcome screen screenshot...');
      await apiRequest(request, 'delete', '/api/tournament', {
        headers: getAuthHeader(),
      });
      await page.waitForTimeout(500);

      await page.goto(`${BASE_URL}/tournament`, { waitUntil: 'networkidle' });

      // Wait for welcome screen using data-testid
      await page.waitForSelector('[data-testid="tournament-welcome-create-new"]', {
        timeout: 3000,
        state: 'visible',
      });
      await page.waitForTimeout(500);

      await takeScreenshot(page, {
        path: '/tournament',
        name: 'tournament-welcome',
        waitFor: '[data-testid="tournament-welcome-create-new"]',
        waitTime: 500,
      });
    } catch (error) {
      console.error('❌ Failed to screenshot tournament welcome screen:', error);
    }

    // 1b. Tournament creation wizard (single elimination + shuffle config)
    await takeTournamentCreationScreenshots(page);

    // 2. Add Player Modal (from Players page)
    // Take this AFTER players are created (they're created in generateTestData)
    // Players should exist now since we just generated them
    try {
      console.log('📸 Taking add player modal screenshot...');
      await page.goto(`${BASE_URL}/players`, { waitUntil: 'networkidle' });

      // Wait for players to load - the button only appears when players.length > 0
      // So we wait for either the table OR the empty state, then check for the button
      await page.waitForSelector(
        'table tbody tr, .MuiDataGrid-row, [data-testid="add-player-button"], .MuiCard-root',
        { timeout: 5000, state: 'visible' }
      );
      // Give time for React to update header actions
      await page.waitForTimeout(1500);

      // Find Add Player button using data-testid
      const addPlayerButton = page.locator('[data-testid="add-player-button"]');
      const buttonVisible = await addPlayerButton.isVisible({ timeout: 3000 }).catch(() => false);

      if (buttonVisible) {
        await addPlayerButton.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await addPlayerButton.click();
        await page.waitForTimeout(500);

        // Wait for modal to appear using data-testid
        await page.waitForSelector('[data-testid="player-modal"]', {
          timeout: 3000,
          state: 'visible',
        });
        await page.waitForTimeout(500);

        await takeScreenshot(page, {
          path: '/players',
          name: 'add-player-modal',
          waitFor: '[data-testid="player-modal"]',
          waitTime: 500,
        });

        // Close modal
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else {
        console.warn('⚠️  Add Player button not visible (players may not be loaded yet)');
      }
    } catch (error) {
      console.error('❌ Failed to screenshot add player modal:', error);
    }

    // 3. Select Player Modal (from Teams page - edit a team)
    try {
      console.log('📸 Taking select player modal screenshot...');
      await page.goto(`${BASE_URL}/teams`, { waitUntil: 'networkidle' });

      // Wait for teams to load - teams page uses Grid with Cards
      await page.waitForSelector('[data-testid^="team-card-"]', {
        timeout: 5000,
        state: 'visible',
      });
      await page.waitForTimeout(500);

      // Find first team card using data-testid
      const teamCard = page.locator('[data-testid^="team-card-"]').first();
      await teamCard.waitFor({ timeout: 3000, state: 'visible' });
      await teamCard.click();
      await page.waitForTimeout(500);

      // Wait for team modal to appear using data-testid
      await page.waitForSelector('[data-testid="team-modal"]', { timeout: 3000, state: 'visible' });
      // Wait for modal animation to complete
      await page.waitForTimeout(500);

      // Find and click "Select Players" button using data-testid
      const selectPlayersButton = page.locator('[data-testid="select-players-button"]');
      await selectPlayersButton.waitFor({ timeout: 3000, state: 'visible' });
      await page.waitForTimeout(500);
      await selectPlayersButton.click();
      await page.waitForTimeout(500);

      // Wait for player selection modal to appear using data-testid
      await page.waitForSelector('[data-testid="player-selection-modal"]', {
        timeout: 3000,
        state: 'visible',
      });
      await page.waitForTimeout(500);

      await takeScreenshot(page, {
        path: '/teams',
        name: 'select-player-modal',
        waitFor: '[data-testid="player-selection-modal"]',
        waitTime: 500,
      });

      // Close modals - close dialog first, then drawer
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } catch (error) {
      console.error('❌ Failed to screenshot select player modal:', error);
    }

    // Now recreate tournament (since we deleted it for welcome screen)
    // Always recreate to ensure we have a tournament for remaining screenshots
    console.log('\n🏟️  Creating tournament for remaining screenshots...');
    const teams = testData.teams as Array<{ id: string }>;
    if (teams.length >= 2) {
      const standardMaps = [
        'de_dust2',
        'de_mirage',
        'de_inferno',
        'de_overpass',
        'de_vertigo',
        'de_ancient',
        'de_anubis',
      ];
      const tournament = await createTournament(request, {
        name: 'Screenshot Tournament',
        type: 'double_elimination',
        format: 'bo3',
        maps: standardMaps,
        teamIds: teams.slice(0, 4).map((t) => t.id),
      });
      if (tournament) {
        testData.tournament = tournament;
        console.log('✅ Tournament created');

        // Start tournament immediately so teams are assigned to matches
        // This is needed for screenshots that require matches with teams (bracket, matches page, etc.)
        console.log('🚀 Starting tournament immediately...');
        const started = await startTournament(request);
        if (started) {
          console.log('✅ Tournament started');
          // Wait a bit for bracket to be fully processed and teams assigned
          console.log('⏳ Waiting for bracket to be fully processed...');
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Verify matches have teams
          let retries = 0;
          const maxRetries = 10;
          let matchesReady = false;

          while (retries < maxRetries && !matchesReady) {
            const checkResponse = await apiRequest(request, 'get', '/api/matches', {
              headers: getAuthHeader(),
            });
            if (checkResponse.ok()) {
              const checkData = await checkResponse.json();
              const checkMatches = checkData.matches || [];

              // Log API response for debugging
              console.log(`\n📊 API Response (attempt ${retries + 1}/${maxRetries}):`);
              console.log(`   Total matches: ${checkMatches.length}`);
              if (checkMatches.length > 0) {
                // Log full first match structure to see all fields
                console.log(`   First match (full):`, JSON.stringify(checkMatches[0], null, 2));

                // Log all matches with their team IDs
                checkMatches.forEach(
                  (
                    m: {
                      slug?: string;
                      team1_id?: string;
                      team2_id?: string;
                      round?: number;
                      team1?: unknown;
                      team2?: unknown;
                    },
                    idx: number
                  ) => {
                    const team1Info = m.team1
                      ? typeof m.team1 === 'object' && m.team1 !== null && 'id' in m.team1
                        ? (m.team1 as { id?: string }).id
                        : 'object'
                      : 'null';
                    const team2Info = m.team2
                      ? typeof m.team2 === 'object' && m.team2 !== null && 'id' in m.team2
                        ? (m.team2 as { id?: string }).id
                        : 'object'
                      : 'null';
                    console.log(
                      `   Match ${idx + 1}: slug=${m.slug}, round=${m.round}, team1_id=${
                        m.team1_id || 'null'
                      }, team2_id=${
                        m.team2_id || 'null'
                      }, team1.id=${team1Info}, team2.id=${team2Info}`
                    );
                  }
                );
              } else {
                console.log(`   No matches found in API response`);
              }

              // Consider teams "assigned" if either the direct team*_id fields are set
              // OR if the joined team objects have an id (as seen in the API response).
              const hasTeamsAssigned = (
                m: {
                  team1_id?: string;
                  team2_id?: string;
                  team1?: unknown;
                  team2?: unknown;
                }
              ) => {
                const team1HasId =
                  !!m.team1_id ||
                  (m.team1 &&
                    typeof m.team1 === 'object' &&
                    m.team1 !== null &&
                    'id' in m.team1 &&
                    !!(m.team1 as { id?: string }).id);
                const team2HasId =
                  !!m.team2_id ||
                  (m.team2 &&
                    typeof m.team2 === 'object' &&
                    m.team2 !== null &&
                    'id' in m.team2 &&
                    !!(m.team2 as { id?: string }).id);
                return team1HasId && team2HasId;
              };

              matchesReady = checkMatches.some(hasTeamsAssigned);
              if (matchesReady) {
                const readyCount = checkMatches.filter(hasTeamsAssigned).length;
                console.log(`✅ Found ${readyCount} match(es) with teams assigned`);
              } else if (retries % 2 === 0) {
                console.log(
                  `   Still waiting for teams to be assigned... (${retries + 1}/${maxRetries})`
                );
              }
            } else {
              const errorText = await checkResponse.text();
              console.error(`❌ API Error: ${checkResponse.status()} - ${errorText}`);
            }
            if (!matchesReady) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            retries++;
          }

          if (!matchesReady) {
            console.warn(
              '⚠️  Matches may not have teams assigned yet, some screenshots may be incomplete'
            );
          }
        } else {
          console.warn('⚠️  Failed to start tournament');
        }
      } else {
        console.warn('⚠️  Failed to create tournament');
      }
    } else {
      console.warn('⚠️  Not enough teams to create tournament');
    }

    // Define screenshots to take
    // Note: Dashboard is captured after tournament starts to show statistics
    const screenshots: ScreenshotConfig[] = [
      // Players page
      {
        path: '/players',
        name: 'players',
        waitFor: 'table, .MuiDataGrid-root, [role="grid"], .MuiCard-root, button',
        scrollToBottom: true,
      },

      // Teams page
      {
        path: '/teams',
        name: 'teams',
        waitFor: 'table, .MuiDataGrid-root, [role="grid"], .MuiCard-root',
        scrollToBottom: true,
      },

      // Servers page
      {
        path: '/servers',
        name: 'servers',
        waitFor: 'table, .MuiDataGrid-root, [role="grid"], .MuiCard-root',
      },

      // Maps page
      {
        path: '/maps',
        name: 'maps',
        waitFor: '.MuiTabs-root, .MuiCard-root',
        waitTime: 1000,
      },

      // Maps page - Map Pools tab
      {
        path: '/maps',
        name: 'maps-pools-tab',
        waitFor: '.MuiTabs-root',
        waitTime: 2000,
        // We'll click the tab in the screenshot function
      },

      // Admin Tools page
      {
        path: '/admin',
        name: 'admin-tools',
        waitFor: '.MuiCard-root, button, table',
        waitTime: 1000,
      },

      // Tournament page (before starting - capture the setup view)
      {
        path: '/tournament',
        name: 'tournament',
        waitFor: '.MuiCard-root, form, button',
        waitTime: 1500,
      },

      // Bracket page (if tournament exists)
      {
        path: '/bracket',
        name: 'bracket',
        waitFor: '.brackets-viewer, svg, canvas',
        waitTime: 2000,
      },

      // Matches page
      {
        path: '/matches',
        name: 'matches',
        waitFor: 'table, .MuiDataGrid-root, [role="grid"], .MuiCard-root',
        scrollToBottom: true,
      },

      // Settings page
      {
        path: '/settings',
        name: 'settings',
        waitFor: '.MuiCard-root, form, button, .MuiPaper-root',
        scrollToBottom: true,
      },

      // Templates page
      {
        path: '/templates',
        name: 'templates',
        waitFor: 'table, .MuiDataGrid-root, [role="grid"], .MuiCard-root',
      },

      // ELO Templates page
      {
        path: '/elo-templates',
        name: 'elo-templates',
        waitFor: 'table, .MuiDataGrid-root, [role="grid"], .MuiCard-root',
      },

      // Find Player page (public)
      {
        path: '/player',
        name: 'find-player',
        waitFor: 'input, button, .MuiCard-root, form',
        waitTime: 1000,
      },
    ];

    // Take regular page screenshots (before starting tournament)
    console.log('📸 Taking regular page screenshots...\n');
    for (const config of screenshots) {
      try {
        await page.goto(`${BASE_URL}${config.path}`, { waitUntil: 'networkidle' });

        // Special handling for maps-pools-tab - click the tab first
        if (config.name === 'maps-pools-tab') {
          try {
            // Wait for tabs to load
            await page.waitForSelector('.MuiTabs-root', { timeout: 2000, state: 'visible' });
            await page.waitForTimeout(300);

            // Find and click the "Map Pools" tab
            const poolsTab = page.getByRole('tab', { name: /map pools/i });
            const tabVisible = await poolsTab.isVisible({ timeout: 2000 }).catch(() => false);
            if (tabVisible) {
              await poolsTab.click();
              await page.waitForTimeout(500);
            } else {
              // Try to find tab by text
              const allTabs = await page.locator('[role="tab"]').all();
              for (const tab of allTabs) {
                const text = await tab.textContent().catch(() => '');
                if (text && /pool/i.test(text)) {
                  await tab.click();
                  await page.waitForTimeout(500);
                  break;
                }
              }
            }
          } catch (error) {
            console.warn('⚠️  Could not click Map Pools tab, taking screenshot anyway');
          }
        }

        await takeScreenshot(page, config);
      } catch (error) {
        console.error(`❌ Failed to screenshot ${config.name}:`, error);
      }
    }

    // Tournament is already started earlier, so we can take dashboard screenshot now
    if (testData.tournament) {
      // Take dashboard screenshot after tournament is started (shows statistics)
      try {
        console.log('📸 Taking dashboard screenshot (after tournament started)...');
        await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
        await takeScreenshot(page, {
          path: '/dashboard',
          name: 'dashboard',
          waitFor: '.MuiCard-root, table, [class*="Chart"], .MuiGrid-root',
          waitTime: 1500,
        });
      } catch (error) {
        console.error('❌ Failed to screenshot dashboard:', error);
      }
    }

    // Take screenshot of public tournament leaderboard if tournament exists and is shuffle type
    // Leaderboard is only available for shuffle tournaments
    if (testData.tournament && testData.tournament.type === 'shuffle') {
      try {
        console.log('📸 Taking public tournament leaderboard screenshot (shuffle tournament)...');
        await page.goto(`${BASE_URL}/tournament/${testData.tournament.id}/leaderboard`);
        await takeScreenshot(page, {
          path: `/tournament/${testData.tournament.id}/leaderboard`,
          name: 'tournament-leaderboard',
          waitFor: 'table, .MuiCard-root, .MuiPaper-root, .MuiTable-root',
          waitTime: 1500,
        });
      } catch (error) {
        console.error('❌ Failed to screenshot tournament leaderboard:', error);
      }
    } else if (testData.tournament) {
      console.log('⏭️  Skipping tournament leaderboard (only available for shuffle tournaments)');
    }

    // Take screenshot of team page, veto process, and connect to server
    // Navigate via UI: go to matches page, click a match, use team link from modal
    if (testData.tournament) {
      try {
        console.log('📸 Navigating to matches page to find a match...');
        await page.goto(`${BASE_URL}/matches`, { waitUntil: 'networkidle' });

        // Wait for matches to load
        await page.waitForSelector('.MuiCard-root, [role="button"]', {
          timeout: 5000,
          state: 'visible',
        });
        await page.waitForTimeout(1000);

        // Log what's on the page
        const allCards = await page.locator('.MuiCard-root').all();
        console.log(`\n📊 Matches Page: Found ${allCards.length} card(s) on page`);

        // Find and click the first match card (could be live, upcoming, or history)
        const matchCard = page.locator('.MuiCard-root').first();
        const cardVisible = await matchCard.isVisible({ timeout: 3000 }).catch(() => false);

        if (!cardVisible) {
          console.warn('⚠️  No match cards found on matches page, skipping team page screenshots');
          // Log page content for debugging
          const pageContent = await page.content();
          console.log(`   Page has ${pageContent.length} characters`);
          const hasMatchesText = pageContent.includes('match') || pageContent.includes('Match');
          console.log(`   Page contains match-related text: ${hasMatchesText}`);
          return;
        }

        // Get card text for debugging
        const cardText = await matchCard.textContent().catch(() => 'could not read');
        console.log(`   First card text preview: ${cardText?.substring(0, 100)}...`);

        console.log('   Clicking first match card to open modal...');
        await matchCard.click();
        await page.waitForTimeout(1000);

        // Check for dialog - log what we find
        const dialogs = await page.locator('[role="dialog"]').all();
        console.log(`\n📊 After click: Found ${dialogs.length} dialog(s)`);
        for (let i = 0; i < dialogs.length; i++) {
          const isVisible = await dialogs[i].isVisible().catch(() => false);
          const classes = await dialogs[i].getAttribute('class').catch(() => 'no class');
          console.log(`   Dialog ${i + 1}: visible=${isVisible}, classes=${classes}`);
        }

        // Wait for match modal to appear - try multiple approaches
        try {
          await page.waitForSelector('[role="dialog"]', { timeout: 3000, state: 'visible' });
          console.log('✅ Dialog is visible');
        } catch (error) {
          // Try waiting for it to exist (even if hidden)
          const dialogExists = await page.locator('[role="dialog"]').count();
          console.log(`⚠️  Dialog exists but may be hidden: count=${dialogExists}`);

          // Try waiting for drawer (MUI Drawer)
          try {
            await page.waitForSelector('.MuiDrawer-paper', { timeout: 2000, state: 'visible' });
            console.log('✅ Drawer is visible');
          } catch {
            console.log('⚠️  Drawer also not visible');
          }

          // Log all dialogs and their states
          const allDialogs = await page.locator('[role="dialog"]').all();
          for (let i = 0; i < allDialogs.length; i++) {
            const dialog = allDialogs[i];
            const visible = await dialog.isVisible().catch(() => false);
            const display = await dialog
              .evaluate((el) => window.getComputedStyle(el).display)
              .catch(() => 'unknown');
            const visibility = await dialog
              .evaluate((el) => window.getComputedStyle(el).visibility)
              .catch(() => 'unknown');
            console.log(
              `   Dialog ${i + 1}: visible=${visible}, display=${display}, visibility=${visibility}`
            );
          }

          // Continue anyway - maybe it's a drawer that's open but not "visible" in the strict sense
          console.log('   Continuing anyway - will try to find team link...');
        }
        await page.waitForTimeout(500);

        // Find the team link button (the one with OpenInNewIcon for team1)
        // Look for IconButton with href containing "/team/"
        // Also check for buttons that might navigate to team pages
        const teamLinks = await page.locator('a[href*="/team/"]').all();
        const teamButtons = await page
          .locator('button, a')
          .filter({ hasText: /team|open/i })
          .all();
        console.log(
          `\n📊 Found ${teamLinks.length} team link(s) and ${teamButtons.length} potential team button(s) on page`
        );

        for (let i = 0; i < teamLinks.length; i++) {
          const href = await teamLinks[i].getAttribute('href').catch(() => 'no href');
          const visible = await teamLinks[i].isVisible().catch(() => false);
          const text = await teamLinks[i].textContent().catch(() => 'no text');
          console.log(
            `   Link ${i + 1}: href=${href}, visible=${visible}, text=${text?.substring(0, 50)}`
          );
        }

        // Try to find team link in the drawer/modal - it might be in a specific location
        const drawer = page.locator('.MuiDrawer-paper, [role="dialog"]').first();
        const drawerTeamLinks = drawer.locator('a[href*="/team/"]').all();
        const drawerLinkCount = await drawerTeamLinks.then((links) => links.length).catch(() => 0);
        console.log(`   Team links in drawer/modal: ${drawerLinkCount}`);

        // Try clicking on team name or any clickable element that might lead to team page
        const teamNameElements = await drawer.locator('text=/team|Team/').all();
        console.log(`   Team name elements in drawer: ${teamNameElements.length}`);

        const teamLinkButton = page.locator('a[href*="/team/"]').first();
        const linkVisible = await teamLinkButton.isVisible({ timeout: 3000 }).catch(() => false);

        if (!linkVisible) {
          console.warn(
            '⚠️  No team link found in match modal, trying to get team ID from match data...'
          );
          // Fallback: try to extract team ID from the page or use API
          const matchesResponse = await apiRequest(request, 'get', '/api/matches', {
            headers: getAuthHeader(),
          });

          console.log(`\n📊 Fallback API call to /api/matches:`);
          if (matchesResponse.ok()) {
            const matchesData = await matchesResponse.json();
            const matches = matchesData.matches || [];
            console.log(
              `   Response: ${JSON.stringify(
                { success: matchesData.success, matchCount: matches.length },
                null,
                2
              )}`
            );

            if (matches.length > 0) {
              // Prefer a match that actually has a concrete team attached
              const firstWithTeam =
                matches.find(
                  (m: {
                    team1_id?: string | null;
                    team2_id?: string | null;
                    team1?: { id?: string };
                    team2?: { id?: string };
                  }) =>
                    (m.team1_id && m.team1_id !== 'null') ||
                    (m.team2_id && m.team2_id !== 'null') ||
                    (m.team1 && (m.team1 as { id?: string }).id) ||
                    (m.team2 && (m.team2 as { id?: string }).id)
                ) || matches[0];

              console.log(
                `   Chosen match details:`,
                JSON.stringify(
                  {
                    slug: firstWithTeam.slug,
                    round: firstWithTeam.round,
                    status: firstWithTeam.status,
                    team1_id: firstWithTeam.team1_id || 'null',
                    team2_id: firstWithTeam.team2_id || 'null',
                    team1: firstWithTeam.team1
                      ? {
                          id: (firstWithTeam.team1 as { id?: string }).id,
                          name: (firstWithTeam.team1 as { name?: string }).name,
                        }
                      : 'null',
                    team2: firstWithTeam.team2
                      ? {
                          id: (firstWithTeam.team2 as { id?: string }).id,
                          name: (firstWithTeam.team2 as { name?: string }).name,
                        }
                      : 'null',
                  },
                  null,
                  2
                )
              );

              const candidateTeamId =
                firstWithTeam.team1_id && firstWithTeam.team1_id !== 'null'
                  ? firstWithTeam.team1_id
                  : firstWithTeam.team2_id && firstWithTeam.team2_id !== 'null'
                  ? firstWithTeam.team2_id
                  : (firstWithTeam.team1 as { id?: string } | undefined)?.id ||
                    (firstWithTeam.team2 as { id?: string } | undefined)?.id;

              if (candidateTeamId) {
                const team1Id = candidateTeamId as string;
                console.log(`   Using team ID from API/nested team: ${team1Id}`);
                await page.goto(`${BASE_URL}/team/${team1Id}`, { waitUntil: 'networkidle' });
                await takeScreenshot(page, {
                  path: `/team/${team1Id}`,
                  name: 'team-page',
                  waitFor: '.MuiCard-root, table, button, .MuiAlert-root',
                  waitTime: 1000,
                });
              } else {
                console.warn(`   Could not find any team ID in matches, cannot proceed`);
              }
            } else {
              console.warn(`   No matches in API response`);
            }
          } else {
            const errorText = await matchesResponse.text();
            console.error(`❌ API Error: ${matchesResponse.status()} - ${errorText}`);
          }
          // Close modal
          await page.keyboard.press('Escape');
          return;
        }

        // Get the href from the link
        const teamUrl = await teamLinkButton.getAttribute('href');
        if (!teamUrl) {
          console.warn('⚠️  Team link has no href, skipping');
          await page.keyboard.press('Escape');
          return;
        }

        // Extract team ID from URL (format: /team/{teamId})
        const teamIdMatch = teamUrl.match(/\/team\/([^/]+)/);
        const team1Id = teamIdMatch ? teamIdMatch[1] : null;

        if (!team1Id) {
          console.warn('⚠️  Could not extract team ID from URL, skipping');
          await page.keyboard.press('Escape');
          return;
        }

        console.log(`   Found team ID: ${team1Id}`);

        // Close the modal first
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Don't take team-page.png yet - we'll take it AFTER veto completes
        // Get match slug from the team page or API for veto process
        // The team page should show the current match
        let matchSlug: string | null = null;
        let team2Id: string | null = null;

        // Try to get match info from API
        const matchesResponse = await apiRequest(request, 'get', '/api/matches', {
          headers: getAuthHeader(),
        });
        if (matchesResponse.ok()) {
          const matchesData = await matchesResponse.json();
          const matches = matchesData.matches || [];
          // Find a match with this team
          const teamMatch = matches.find(
            (m: { team1_id?: string; team2_id?: string }) =>
              m.team1_id === team1Id || m.team2_id === team1Id
          );
          if (teamMatch) {
            matchSlug = teamMatch.slug;
            team2Id = teamMatch.team1_id === team1Id ? teamMatch.team2_id : teamMatch.team1_id;
          }
        }

        // Perform veto process via API and capture screenshots
        // Only proceed if we have both team IDs and a match slug
        if (matchSlug && team1Id && team2Id) {
          console.log('📸 Performing veto process via API...');

          // Get initial veto state
          const vetoStateResponse = await apiRequest(request, 'get', `/api/veto/${matchSlug}`, {
            headers: getAuthHeader(),
          });

          if (vetoStateResponse.ok()) {
            const vetoData = await vetoStateResponse.json();
            const vetoState = vetoData.veto;

            if (vetoState && vetoState.status !== 'completed') {
              // Screenshot initial veto state (before any actions)
              console.log(
                '📸 Taking veto process screenshot (initial state - your turn to ban a map)...'
              );
              await page.goto(`${BASE_URL}/team/${team1Id}`, { waitUntil: 'networkidle' });

              await takeScreenshot(page, {
                path: `/team/${team1Id}`,
                name: 'veto-process',
                waitFor: '.MuiCard-root, button, [class*="map"], [class*="Veto"]',
                waitTime: 500,
              });

              // Perform veto actions via API for both teams
              let currentVetoState = vetoState;
              let actionCount = 0;
              const maxActions = 6; // Limit to prevent infinite loops

              while (currentVetoState.status !== 'completed' && actionCount < maxActions) {
                const currentTeam = currentVetoState.currentTurn;
                const currentAction = currentVetoState.currentAction;
                const teamId = currentTeam === 'team1' ? team1Id : team2Id;
                const availableMaps = currentVetoState.availableMaps || [];

                if (availableMaps.length === 0) {
                  break;
                }

                // Navigate to the team's page
                await page.goto(`${BASE_URL}/team/${teamId}`, { waitUntil: 'networkidle' });

                if (currentAction === 'side_pick') {
                  // Screenshot side pick interface
                  console.log('📸 Taking side pick screenshot...');
                  await takeScreenshot(page, {
                    path: `/team/${teamId}`,
                    name: 'veto-side-pick',
                    waitFor: 'button, .MuiCard-root, [class*="side"]',
                    waitTime: 500,
                  });

                  // Pick a side (CT)
                  // teamSlug must be the actual team ID
                  const sideResponse = await apiRequest(
                    request,
                    'post',
                    `/api/veto/${matchSlug}/action`,
                    {
                      headers: getAuthHeader(),
                      data: {
                        side: 'CT',
                        teamSlug: teamId, // teamId is already the team's ID/slug
                      },
                    }
                  );

                  if (sideResponse.ok()) {
                    const sideData = await sideResponse.json();
                    currentVetoState = sideData.veto;
                    actionCount++;
                    await new Promise((resolve) => setTimeout(resolve, 500));
                  }
                } else if (currentAction === 'ban' || currentAction === 'pick') {
                  // Pick first available map
                  const mapToAction = availableMaps[0];

                  const actionResponse = await apiRequest(
                    request,
                    'post',
                    `/api/veto/${matchSlug}/action`,
                    {
                      headers: getAuthHeader(),
                      data: {
                        mapName: mapToAction,
                        teamSlug: teamId, // teamId is already the team's ID/slug
                      },
                    }
                  );

                  if (actionResponse.ok()) {
                    const actionData = await actionResponse.json();
                    currentVetoState = actionData.veto;
                    actionCount++;

                    // Screenshot after action if it's team1's turn (to show progress)
                    if (currentTeam === 'team1' && actionCount <= 2) {
                      await page.waitForTimeout(300);
                      await takeScreenshot(page, {
                        path: `/team/${team1Id}`,
                        name: 'veto-process-action',
                        waitFor: '.MuiCard-root, button',
                        waitTime: 500,
                      });
                    }

                    await new Promise((resolve) => setTimeout(resolve, 300));
                  } else {
                    const errorText = await actionResponse.text();
                    console.warn(`⚠️  Veto action failed: ${errorText}`);
                    break;
                  }
                } else {
                  break;
                }
              }

              // Screenshot after both teams have banned maps (veto in progress)
              if (
                currentVetoState.status === 'in_progress' ||
                currentVetoState.status === 'completed'
              ) {
                console.log('📸 Taking veto process screenshot (after bans)...');
                await page.goto(`${BASE_URL}/team/${team1Id}`, { waitUntil: 'networkidle' });

                await takeScreenshot(page, {
                  path: `/team/${team1Id}`,
                  name: 'veto-process-action',
                  waitFor: '.MuiCard-root, button',
                  waitTime: 500,
                });
              }

              // After veto completes, wait for server allocation and take team-page.png
              if (currentVetoState.status === 'completed') {
                console.log('✅ Veto completed! Waiting for server allocation...');

                // Wait a bit for server allocation to happen (it's automatic)
                await page.waitForTimeout(2000);

                // Poll for match status to check if server is allocated
                let serverAllocated = false;
                let attempts = 0;
                const maxAttempts = 10; // 10 attempts * 1s = 10 seconds max wait

                while (!serverAllocated && attempts < maxAttempts) {
                  if (matchSlug) {
                    const matchResponse = await apiRequest(request, 'get', `/api/matches`, {
                      headers: getAuthHeader(),
                    });

                    if (matchResponse.ok()) {
                      const matchesData = await matchResponse.json();
                      const matches = matchesData.matches || [];
                      const match = matches.find((m: { slug: string }) => m.slug === matchSlug);

                      if (match && match.server_id) {
                        serverAllocated = true;
                        console.log('✅ Server allocated to match!');
                      } else if (match && match.status === 'loaded') {
                        // Match is loaded, server is definitely allocated
                        serverAllocated = true;
                        console.log('✅ Match loaded, server allocated!');
                      }
                    }
                  }

                  if (!serverAllocated) {
                    attempts++;
                    await page.waitForTimeout(1000);
                  }
                }

                // Navigate to team page and take full screenshot AFTER veto completes
                console.log(
                  '📸 Taking team page screenshot (after veto complete with server info)...'
                );
                await page.goto(`${BASE_URL}/team/${team1Id}`, { waitUntil: 'networkidle' });

                // Wait a bit more for the UI to update with server info
                await page.waitForTimeout(1000);

                // Scroll to top to show full page
                await page.evaluate(() => {
                   
                  window.scrollTo(0, 0);
                });
                await page.waitForTimeout(500);

                await takeScreenshot(page, {
                  path: `/team/${team1Id}`,
                  name: 'team-page',
                  waitFor:
                    '.MuiCard-root, table, button, .MuiAlert-root, [data-test-id="match-details"]',
                  waitTime: 1000,
                  scrollToBottom: false, // Don't scroll, show top of page with match details and server info
                });
              }
            } else {
              console.log('⚠️  Veto already completed or not available');

              // If veto was already completed, still try to take team-page.png
              if (vetoState && vetoState.status === 'completed') {
                console.log('📸 Taking team page screenshot (veto already completed)...');
                await page.goto(`${BASE_URL}/team/${team1Id}`, { waitUntil: 'networkidle' });
                await page.waitForTimeout(1000);

                await page.evaluate(() => {
                   
                  window.scrollTo(0, 0);
                });
                await page.waitForTimeout(500);

                await takeScreenshot(page, {
                  path: `/team/${team1Id}`,
                  name: 'team-page',
                  waitFor:
                    '.MuiCard-root, table, button, .MuiAlert-root, [data-test-id="match-details"]',
                  waitTime: 1000,
                });
              }
            }
          }
        }

        // Screenshot connect to server section (always try, even if veto didn't work)
        if (team1Id) {
          console.log('📸 Taking connect to server screenshot...');
          await page.goto(`${BASE_URL}/team/${team1Id}`, { waitUntil: 'networkidle' });

          // Look for server panel or connect button
          const connectButton = page.getByRole('button', { name: /connect to server/i });
          const connectVisible = await connectButton
            .isVisible({ timeout: 5000 })
            .catch(() => false);

          if (connectVisible) {
            // Scroll to button to center it
            await connectButton.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);

            // Screenshot the server connection section
            await takeScreenshot(page, {
              path: `/team/${team1Id}`,
              name: 'connect-to-server',
              waitFor: 'button, .MuiCard-root',
              waitTime: 500,
            });
          } else {
            // Look for server panel by text content
            const serverPanel = page.locator('text=/server|connect|ip|password/i').first();
            const serverPanelVisible = await serverPanel
              .isVisible({ timeout: 2000 })
              .catch(() => false);

            if (serverPanelVisible) {
              await serverPanel.scrollIntoViewIfNeeded();
              await page.waitForTimeout(300);
              await takeScreenshot(page, {
                path: `/team/${team1Id}`,
                name: 'connect-to-server',
                waitFor: '.MuiCard-root',
                waitTime: 500,
              });
            } else {
              // Scroll to bottom to find server section
              await page.evaluate(() => {
                // eslint-disable-next-line no-undef
                window.scrollTo(0, document.body.scrollHeight);
              });
              await page.waitForTimeout(300);
              await takeScreenshot(page, {
                path: `/team/${team1Id}`,
                name: 'connect-to-server',
                waitFor: '.MuiCard-root, button',
                waitTime: 500,
              });
            }
          }
        }
      } catch (error) {
        console.error('❌ Failed to screenshot team page/veto/connect:', error);
      }
    }

    // Take screenshot of player profile page (public page)
    // Need a player ID from the test data
    if (testData.players && testData.players.length > 0) {
      try {
        // Get first player's ID - players have either 'id' (steamId) or 'steamId' field
        const firstPlayer = testData.players[0] as {
          id?: string;
          steamId?: string;
          steam_id?: string;
        };
        const playerId = firstPlayer.id || firstPlayer.steamId || firstPlayer.steam_id;

        if (playerId) {
          console.log('📸 Taking player profile screenshot...');
          await page.goto(`${BASE_URL}/player/${playerId}`, { waitUntil: 'networkidle' });

          await takeScreenshot(page, {
            path: `/player/${playerId}`,
            name: 'player-profile',
            waitFor: '.MuiCard-root, table, .MuiPaper-root',
            waitTime: 500,
            scrollToBottom: true,
          });
        } else {
          console.warn('⚠️  Could not find player ID for profile screenshot');
        }
      } catch (error) {
        console.error('❌ Failed to screenshot player profile:', error);
      }
    }

    console.log('\n✅ Screenshot generation complete!');
    console.log(`📁 Screenshots saved to: ${SCREENSHOT_DIR}\n`);
  } catch (error) {
    console.error('❌ Error during screenshot generation:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run if executed directly
if (require.main === module) {
  generateScreenshots()
    .then(() => {
      console.log('✨ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Fatal error:', error);
      process.exit(1);
    });
}

export { generateScreenshots };
