import { APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';
import { createTestTeams, type Team, createTeam } from './teams';
import { createTestServer, deleteServer, FAKE_SERVER_HOST, type Server } from './servers';
import {
  createAndStartTournament,
  type CreateTournamentInput,
  type Tournament,
} from './tournaments';

/**
 * Comprehensive tournament setup helper
 * Handles all prerequisites: webhook URL, servers, teams, and tournament creation
 */

export interface TournamentSetupOptions {
  /** Tournament name (auto-generated if not provided) */
  name?: string;
  /** Tournament type */
  type?: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';
  /** Match format */
  format?: 'bo1' | 'bo3' | 'bo5';
  /** Map pool (defaults to Active Duty) */
  maps?: string[];
  /** Number of teams to create (defaults to 2) */
  teamCount?: number;
  /** Number of servers to create (defaults to 1) */
  serverCount?: number;
  /** Webhook URL to configure (defaults to http://localhost:3069 to match test base URL) */
  webhookUrl?: string;
  /** Prefix for generated resources (defaults to 'test') */
  prefix?: string;
}

export interface TournamentSetupResult {
  tournament: Tournament;
  teams: Team[];
  servers: Server[];
  webhookUrl: string;
}

const DEFAULT_MAPS = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_vertigo',
];

/**
 * Set webhook URL in settings
 */
async function setWebhookUrl(request: APIRequestContext, webhookUrl: string): Promise<boolean> {
  try {
    const response = await request.put('/api/settings', {
      headers: getAuthHeader(),
      data: { webhookUrl },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Failed to set webhook URL:', {
        status: response.status(),
        statusText: response.statusText(),
        error: errorText,
        webhookUrl,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to set webhook URL:', error);
    return false;
  }
}

/**
 * Get existing teams or create new ones
 */
async function ensureTeams(
  request: APIRequestContext,
  count: number,
  prefix: string
): Promise<Team[]> {
  // Try to get existing teams first
  try {
    const response = await request.get('/api/teams', {
      headers: getAuthHeader(),
    });
    if (response.ok()) {
      const data = await response.json();
      const existingTeams: Team[] = data.teams || [];

      // Reuse a leftover team only if it can actually play a match:
      //
      //  - every player must have a real 17-digit Steam ID. Some specs (shuffle)
      //    create players with synthetic ids like `match-test-player-3-...`;
      //    those cannot sign in, be impersonated, or take veto turns.
      //  - the two teams must have disjoint rosters. A match whose teams share a
      //    Steam ID is unusable: the veto API cannot tell which side that player
      //    acts for and rejects every action as "not on one of the
      //    participating teams".
      const isSteamId = (value: string) => /^\d{17}$/.test(value);

      const picked: Team[] = [];
      const claimed = new Set<string>();

      for (const team of existingTeams) {
        const steamIds = (team.players ?? []).map((player) => player.steamId);
        if (steamIds.length === 0) continue;
        if (!steamIds.every(isSteamId)) continue;
        if (steamIds.some((steamId) => claimed.has(steamId))) continue;

        steamIds.forEach((steamId) => claimed.add(steamId));
        picked.push(team);
        if (picked.length === count) break;
      }

      if (picked.length >= count) {
        return picked.slice(0, count);
      }
    }
  } catch (error) {
    // Ignore errors, will create new teams
  }

  // Real Steam IDs for testing avatars - public profiles that should exist
  // These will cycle through as needed for multiple teams
  const realSteamIds = [
    '76561197960287930', // Gabe Newell (public profile)
    '76561198013825972', // Popular public profile
    '76561198067146383', // Popular public profile
    '76561198021466528', // Popular public profile
    '76561198059949467', // Popular public profile
    '76561198077860982', // Popular public profile
    '76561198041282941', // Popular public profile
    '76561198012563928', // Popular public profile
    '76561198063472351', // Popular public profile
    '76561198084126937', // Popular public profile
  ];

  // Create new teams if needed
  const teams: Team[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = Date.now();
    const team = await createTeam(request, {
      id: `${prefix}-team-${i}-${timestamp}`,
      name: `${prefix} Team ${i + 1} ${timestamp}`,
      players: [
        { steamId: realSteamIds[(i * 5 + 0) % realSteamIds.length], name: 'Player 1' },
        { steamId: realSteamIds[(i * 5 + 1) % realSteamIds.length], name: 'Player 2' },
        { steamId: realSteamIds[(i * 5 + 2) % realSteamIds.length], name: 'Player 3' },
        { steamId: realSteamIds[(i * 5 + 3) % realSteamIds.length], name: 'Player 4' },
        { steamId: realSteamIds[(i * 5 + 4) % realSteamIds.length], name: 'Player 5' },
      ],
    });

    if (team) {
      teams.push(team);
    } else {
      console.error(`Failed to create team ${i + 1}`);
      return [];
    }
  }

  return teams;
}

/**
 * Does this server look like one the E2E suite created?
 *
 * Matches `createTestServer`'s `<prefix>-server-<timestamp>` ids and the
 * `ui_test_server_<timestamp>` id the app derives from the Servers-page test.
 * Anything else is treated as the operator's real infrastructure.
 */
function isTestFixtureServer(server: Server): boolean {
  return /-server-\d{10,}$/.test(server.id) || /^ui_test_server_\d{10,}$/.test(server.id);
}

/**
 * Get existing servers or create new ones
 */
async function ensureServers(
  request: APIRequestContext,
  count: number,
  prefix: string
): Promise<Server[]> {
  // Try to get existing servers first
  try {
    const response = await request.get('/api/servers', {
      headers: getAuthHeader(),
    });
    if (response.ok()) {
      const data = await response.json();
      const existingServers: Server[] = data.servers || [];

      // Tournament start refuses to run while any enabled server fails its RCON
      // version check, so a leftover server with a real host makes every later
      // tournament fail with `cs2_outdated_servers`.
      //
      // Only ever delete servers this suite created. Never touch a server we do
      // not recognise: the tests may be pointed at an instance that has real CS2
      // servers configured, and silently deleting those would be destructive.
      const blocking = existingServers.filter(
        (server) => server.enabled && server.host !== FAKE_SERVER_HOST
      );

      for (const server of blocking) {
        if (isTestFixtureServer(server)) {
          console.warn(
            `[tournamentSetup] Removing leftover test server ${server.id} (${server.host}) ` +
              'which would block tournament start'
          );
          await deleteServer(request, server.id);
        } else {
          console.warn(
            `[tournamentSetup] Enabled server ${server.id} (${server.host}) is not a test ` +
              'fixture and will not be modified. If it is unreachable, tournament start will ' +
              `fail with cs2_outdated_servers — disable it, or use host ${FAKE_SERVER_HOST}.`
          );
        }
      }

      const usableServers = existingServers.filter(
        (server) => server.enabled && server.host === FAKE_SERVER_HOST
      );
      if (usableServers.length >= count) {
        return usableServers.slice(0, count);
      }
    }
  } catch (error) {
    // Ignore errors, will create new servers
  }

  // Create new servers if needed
  const servers: Server[] = [];
  for (let i = 0; i < count; i++) {
    const server = await createTestServer(request, `${prefix}-${i}`);
    if (server) {
      servers.push(server);
    } else {
      console.error(`Failed to create server ${i + 1}`);
    }
  }

  return servers;
}

/**
 * Comprehensive tournament setup
 * Creates all prerequisites and the tournament itself
 */
export async function setupTournament(
  request: APIRequestContext,
  options: TournamentSetupOptions = {}
): Promise<TournamentSetupResult | null> {
  const {
    name,
    type = 'single_elimination',
    format = 'bo1',
    maps = DEFAULT_MAPS,
    teamCount = 2,
    serverCount = 1,
    webhookUrl = 'http://localhost:3069',
    prefix = 'test',
  } = options;

  // Step 1: Set webhook URL (non-blocking - warn but continue)
  const webhookSet = await setWebhookUrl(request, webhookUrl);
  if (!webhookSet) {
    console.warn(`Failed to set webhook URL to ${webhookUrl}, continuing anyway...`);
    // Don't fail the test setup if webhook URL setting fails
    // It's not strictly required for all test scenarios
  }

  // Step 2: Ensure teams exist
  const teams = await ensureTeams(request, teamCount, prefix);
  if (teams.length < teamCount) {
    console.error(`Failed to create ${teamCount} teams (only got ${teams.length})`);
    return null;
  }

  // Step 3: Ensure servers exist
  const servers = await ensureServers(request, serverCount, prefix);
  if (servers.length < serverCount) {
    console.warn(`Warning: Only created ${servers.length} servers (requested ${serverCount})`);
  }

  // Step 4: Create and start tournament
  const tournamentName = name || `${prefix} Tournament ${Date.now()}`;
  const tournamentInput: CreateTournamentInput = {
    name: tournamentName,
    type,
    format,
    maps,
    teamIds: teams.map((t) => t.id),
  };

  const tournament = await createAndStartTournament(request, tournamentInput);
  if (!tournament) {
    console.error('Failed to create and start tournament');
    return null;
  }

  return {
    tournament,
    teams,
    servers,
    webhookUrl,
  };
}
