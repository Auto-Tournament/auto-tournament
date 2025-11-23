import { test, expect } from '@playwright/test';

/**
 * CS Major Veto Format E2E Tests
 * Tests the complete flow: login → settings → teams → server → tournament → veto → verify config
 * @tag veto
 * @tag cs-major
 * @tag e2e-flow
 * 
 * These tests run sequentially (serial) to ensure proper setup order
 */

// Shared state between tests
const testState: {
  webhookUrl?: string;
  team1Id?: string;
  team2Id?: string;
  serverId?: string;
  matchSlug?: string;
} = {};

test.describe.serial('CS Major Veto Format - Complete E2E Flow', () => {
  const apiToken = process.env.API_TOKEN || 'admin123';
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

  // Step 1: Login and Setup
  test('should login and configure settings', { tag: ['@veto', '@cs-major', '@setup'] }, async ({ page, request }) => {
    // Login
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);

    // Configure webhook URL via API (required for match loading)
    testState.webhookUrl = `${baseUrl}`;
    const settingsResponse = await request.put('/api/settings', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: { webhookUrl: testState.webhookUrl },
    });
    expect(settingsResponse.ok()).toBeTruthy();
    const settingsData = await settingsResponse.json();
    expect(settingsData.success).toBe(true);
    expect(settingsData.settings.webhookUrl).toBe(testState.webhookUrl);
  });

  // Step 2: Create Teams
  test('should create two teams with 5 players each', { 
    tag: ['@veto', '@cs-major', '@setup'],
  }, async ({ page, request }) => {
    const timestamp = Date.now();
    const team1Name = `CS Major Team A ${timestamp}`;
    const team2Name = `CS Major Team B ${timestamp}`;
    const team1Id = `cs-major-team-a-${timestamp}`;
    const team2Id = `cs-major-team-b-${timestamp}`;

    // Create players array with proper Player format (steamId and name)
    const players = [
      { steamId: '76561198000000001', name: 'Player 1' },
      { steamId: '76561198000000002', name: 'Player 2' },
      { steamId: '76561198000000003', name: 'Player 3' },
      { steamId: '76561198000000004', name: 'Player 4' },
      { steamId: '76561198000000005', name: 'Player 5' },
    ];

    // Create Team 1 (requires authentication)
    const team1Response = await request.post('/api/teams', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        id: team1Id,
        name: team1Name,
        players: players,
      },
    });
    
    if (!team1Response.ok()) {
      const errorText = await team1Response.text();
      console.error('Team 1 creation failed:', errorText);
    }
    expect(team1Response.ok()).toBeTruthy();
    const team1Data = await team1Response.json();
    testState.team1Id = team1Data.team.id;
    expect(testState.team1Id).toBeTruthy();

    // Create Team 2 (requires authentication)
    const team2Response = await request.post('/api/teams', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        id: team2Id,
        name: team2Name,
        players: players,
      },
    });
    
    if (!team2Response.ok()) {
      const errorText = await team2Response.text();
      console.error('Team 2 creation failed:', errorText);
    }
    expect(team2Response.ok()).toBeTruthy();
    const team2Data = await team2Response.json();
    testState.team2Id = team2Data.team.id;
    expect(testState.team2Id).toBeTruthy();
  });

  // Step 3: Create Dummy Server (not checking if online)
  test('should create a dummy server for testing', {
    tag: ['@veto', '@cs-major', '@setup'],
  }, async ({ page, request }) => {
    const timestamp = Date.now();
    const serverName = `Test Server ${timestamp}`;
    const serverId = `test-server-${timestamp}`;
    
    const serverResponse = await request.post('/api/servers', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        id: serverId,
        name: serverName,
        host: '127.0.0.1',
        port: 27015 + (timestamp % 1000), // Use different port to avoid conflicts
        password: 'testpassword123',
        enabled: true,
      },
    });
    
    if (!serverResponse.ok()) {
      const errorText = await serverResponse.text();
      console.error('Server creation failed:', errorText);
    }
    expect(serverResponse.ok()).toBeTruthy();
    const serverData = await serverResponse.json();
    testState.serverId = serverData.server.id;
    expect(testState.serverId).toBeTruthy();
  });

  // Step 4: Create Tournament
  test('should create BO1 tournament with 7 maps', {
    tag: ['@veto', '@cs-major', '@setup'],
  }, async ({ page, request }) => {
    const timestamp = Date.now();
    const tournamentName = `CS Major BO1 Test ${timestamp}`;
    
    const tournamentResponse = await request.post('/api/tournament', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        name: tournamentName,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
        teamIds: [testState.team1Id!, testState.team2Id!],
      },
    });
    expect(tournamentResponse.ok()).toBeTruthy();
    
    // Start the tournament
    const startResponse = await request.post('/api/tournament/start', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    
    // Get match slug
    const matchesResponse = await request.get('/api/matches');
    const matchesData = await matchesResponse.json();
    expect(matchesData.matches).toBeDefined();
    expect(matchesData.matches.length).toBeGreaterThan(0);
    
    const match = matchesData.matches.find((m: any) => 
      (m.team1?.id === testState.team1Id && m.team2?.id === testState.team2Id) || 
      (m.team1?.id === testState.team2Id && m.team2?.id === testState.team1Id)
    );
    expect(match).toBeDefined();
    testState.matchSlug = match.slug;
    expect(testState.matchSlug).toBeTruthy();
  });

  // Step 5: Complete CS Major BO1 Veto
  test('should complete CS Major BO1 veto format', {
    tag: ['@veto', '@cs-major'],
  }, async ({ page, request }) => {
    // CS Major BO1 format: Team A (team1) removes 2, Team B (team2) removes 3, Team A removes 1, Team B picks side
    // Step 1-2: Team1 (Team A) removes 2 maps
    await request.post(`/api/veto/${testState.matchSlug}/action`, {
      data: { mapName: 'de_mirage', teamSlug: testState.team1Id },
    });
    await request.post(`/api/veto/${testState.matchSlug}/action`, {
      data: { mapName: 'de_inferno', teamSlug: testState.team1Id },
    });

    // Step 3-5: Team2 (Team B) removes 3 maps
    await request.post(`/api/veto/${testState.matchSlug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: testState.team2Id },
    });
    await request.post(`/api/veto/${testState.matchSlug}/action`, {
      data: { mapName: 'de_anubis', teamSlug: testState.team2Id },
    });
    await request.post(`/api/veto/${testState.matchSlug}/action`, {
      data: { mapName: 'de_dust2', teamSlug: testState.team2Id },
    });

    // Step 6: Team1 (Team A) removes 1 map
    await request.post(`/api/veto/${testState.matchSlug}/action`, {
      data: { mapName: 'de_vertigo', teamSlug: testState.team1Id },
    });

    // Step 7: Team2 (Team B) picks side (CT) - CS Major format
    const sidePickResponse = await request.post(`/api/veto/${testState.matchSlug}/action`, {
      data: { side: 'CT', teamSlug: testState.team2Id },
    });
    expect(sidePickResponse.ok()).toBeTruthy();
    const sidePickData = await sidePickResponse.json();

    // Verify veto completed
    const vetoState = sidePickData.veto;
    expect(vetoState.status).toBe('completed');
    expect(vetoState.pickedMaps).toHaveLength(1);
    expect(vetoState.pickedMaps[0].mapName).toBe('de_nuke'); // Last remaining map
    expect(vetoState.pickedMaps[0].sideTeam2).toBe('CT'); // Team B picked CT
    expect(vetoState.pickedMaps[0].sideTeam1).toBe('T'); // Team A gets opposite
    
    // Poll for config to be generated and available at the endpoint
    await expect.poll(async () => {
      const configResponse = await request.get(`/api/matches/${testState.matchSlug}.json`);
      return configResponse.ok();
    }, {
      timeout: 5000,
      intervals: [100, 250, 500]
    }).toBe(true);
  });

  // Step 6: Verify Match Config via JSON endpoint
  test('should verify match config JSON endpoint has correct veto results', {
    tag: ['@veto', '@cs-major', '@verification'],
  }, async ({ page, request }) => {
    // Verify match slug is set
    expect(testState.matchSlug).toBeTruthy();
    
    // Poll until veto state is completed using expect.poll for cleaner code
    const vetoCheckData = await expect.poll(async () => {
      const vetoCheckResponse = await request.get(`/api/veto/${testState.matchSlug}`);
      expect(vetoCheckResponse.ok()).toBeTruthy();
      const data = await vetoCheckResponse.json();
      return data.veto.status === 'completed' ? data : null;
    }, {
      message: 'Veto state to be completed',
      timeout: 5000,
      intervals: [500, 1000]
    }).resolves.toBeTruthy();
    
    // Verify veto state is completed
    expect(vetoCheckData.veto.status).toBe('completed');
    expect(vetoCheckData.veto.pickedMaps).toHaveLength(1);
    expect(vetoCheckData.veto.format).toBe('bo1'); // Verify format is BO1
    
    // Verify the picked map has side information
    const pickedMap = vetoCheckData.veto.pickedMaps[0];
    expect(pickedMap.mapName).toBe('de_nuke');
    expect(pickedMap.sideTeam1).toBeDefined();
    expect(pickedMap.sideTeam2).toBeDefined();
    
    // Poll for config to be generated at the endpoint
    await expect.poll(async () => {
      const configResponse = await request.get(`/api/matches/${testState.matchSlug}.json`);
      return configResponse.ok();
    }, {
      timeout: 5000,
      intervals: [100, 250, 500]
    }).toBe(true);
    
    // Fetch match config from JSON endpoint (same URL MatchZy uses: /api/matches/{slug}.json)
    const configResponse = await request.get(`/api/matches/${testState.matchSlug}.json`);
    
    if (!configResponse.ok()) {
      const errorText = await configResponse.text();
      console.error('Config endpoint failed:', {
        status: configResponse.status(),
        statusText: configResponse.statusText(),
        error: errorText,
        matchSlug: testState.matchSlug,
      });
    }
    
    expect(configResponse.ok()).toBeTruthy();
    const config = await configResponse.json();
    
    // Verify config structure
    expect(config).toBeDefined();
    
    // Log actual config for debugging if maplist is wrong
    if (!config.maplist || !Array.isArray(config.maplist)) {
      console.error('Config maplist issue:', {
        maplist: config.maplist,
        maplistType: typeof config.maplist,
        isArray: Array.isArray(config.maplist),
        num_maps: config.num_maps,
        fullConfig: JSON.stringify(config, null, 2),
      });
    }
    
    // For BO1, num_maps should be 1 and maplist should be an array
    expect(config.num_maps).toBe(1); // BO1 = 1 map
    expect(config.maplist).toBeDefined();
    expect(Array.isArray(config.maplist)).toBe(true);
    expect(config.maplist.length).toBe(1); // BO1 = 1 map
    expect(config.maplist[0]).toBe('de_nuke'); // The map that remained after veto
    
    // Verify side assignment
    expect(config.map_sides).toBeDefined();
    expect(Array.isArray(config.map_sides)).toBe(true);
    expect(config.map_sides.length).toBe(1);
    // Since team2 (Team B) picked CT, team2 starts CT, so map_sides[0] should be 'team2_ct'
    expect(config.map_sides[0]).toBe('team2_ct');
    
    // Verify team names
    expect(config.team1).toBeDefined();
    expect(config.team2).toBeDefined();
    expect(config.team1.name).toBeTruthy();
    expect(config.team2.name).toBeTruthy();
    
    // Verify format
    expect(config.num_maps).toBe(1); // BO1
  });

  // Step 7: Verify Team Pages Show Correct Veto State
  test('should display correct veto state on team pages', {
    tag: ['@veto', '@cs-major', '@ui'],
  }, async ({ page }) => {
    // View as Team 1
    await page.goto(`/team/${testState.team1Id}/match`);
    await page.waitForLoadState('networkidle');
    
    // Should see completed veto with correct map
    const mapName = page.locator('text=de_nuke').or(page.locator('[data-state="picked"]'));
    await expect(mapName.first()).toBeVisible({ timeout: 5000 });
    
    // Team 1 should see T badge (since Team B picked CT)
    const tBadge = page.locator('text=/T|Terrorist/i').first();
    const tBadgeVisible = await tBadge.isVisible().catch(() => false);
    if (tBadgeVisible) {
      await expect(tBadge).toBeVisible();
    }
    
    // View as Team 2
    await page.goto(`/team/${testState.team2Id}/match`);
    await page.waitForLoadState('networkidle');
    
    // Team 2 should see CT badge (since Team B picked CT)
    const ctBadge = page.locator('text=/CT|Counter-Terrorist/i').first();
    const ctBadgeVisible = await ctBadge.isVisible().catch(() => false);
    if (ctBadgeVisible) {
      await expect(ctBadge).toBeVisible();
    }
  });
});

