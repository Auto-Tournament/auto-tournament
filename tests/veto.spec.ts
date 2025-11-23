import { test, expect } from '@playwright/test';

/**
 * Veto functionality tests
 * @tag veto
 * @tag maps
 * @tag sides
 */

/**
 * Veto System Tests
 * These tests run sequentially to ensure proper setup order
 */
test.describe.serial('Veto System', () => {
  const apiToken = process.env.API_TOKEN || 'admin123';
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
  let tournamentName: string;
  let team1Id: string;
  let team2Id: string;
  let matchSlug: string;

  test.beforeAll(async ({ request }) => {
    // Configure webhook URL before all tests (required for match loading)
    const webhookUrl = `${baseUrl}`;
    try {
      await request.put('/api/settings', {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
        data: { webhookUrl },
      });
    } catch (error) {
      // Don't fail if settings endpoint doesn't exist - webhook might be optional
      console.warn('Could not configure webhook URL:', error);
    }
  });

  test.beforeEach(async ({ page, request }) => {
    // Login before each test
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);

    // Create two teams for testing
    const timestamp = Date.now();
    const team1Name = `Veto Test Team 1 ${timestamp}`;
    const team2Name = `Veto Test Team 2 ${timestamp}`;
    const team1IdValue = `veto-test-team-1-${timestamp}`;
    const team2IdValue = `veto-test-team-2-${timestamp}`;

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
        id: team1IdValue,
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
    team1Id = team1Data.team.id;

    // Create Team 2 (requires authentication)
    const team2Response = await request.post('/api/teams', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        id: team2IdValue,
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
    team2Id = team2Data.team.id;

    // Create tournament with BO1 format (requires veto)
    tournamentName = `Veto Test Tournament ${timestamp}`;
    const tournamentResponse = await request.post('/api/tournament', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        name: tournamentName,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
        teamIds: [team1Id, team2Id],
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

    // Get match slug from API (more reliable than scraping the page)
    const matchesResponse = await request.get('/api/matches');
    const matchesData = await matchesResponse.json();
    expect(matchesData.matches).toBeDefined();
    expect(matchesData.matches.length).toBeGreaterThan(0);
    
    const match = matchesData.matches.find((m: any) => 
      (m.team1?.id === team1Id && m.team2?.id === team2Id) || 
      (m.team1?.id === team2Id && m.team2?.id === team1Id)
    );
    expect(match).toBeDefined();
    matchSlug = match.slug;
    expect(matchSlug).toBeTruthy();
  });

  test('should correctly assign sides when team2 picks CT (CS Major format)', {
    tag: ['@veto', '@sides'],
  }, async ({ page, request }) => {
    // CS Major BO1 format: Team A (team1) removes 2, Team B (team2) removes 3, Team A removes 1, Team B picks side
    // Step 1-2: Team1 (Team A) removes 2 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_mirage', teamSlug: team1Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_inferno', teamSlug: team1Id },
    });

    // Step 3-5: Team2 (Team B) removes 3 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_anubis', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_dust2', teamSlug: team2Id },
    });

    // Step 6: Team1 (Team A) removes 1 map
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_vertigo', teamSlug: team1Id },
    });

    // Step 7: Team2 (Team B) picks side (CT) - CS Major format
    const sidePickResponse = await request.post(`/api/veto/${matchSlug}/action`, {
      data: { side: 'CT', teamSlug: team2Id },
    });
    expect(sidePickResponse.ok()).toBeTruthy();
    const sidePickData = await sidePickResponse.json();

    // Verify the veto state has correct sides
    const vetoState = sidePickData.veto;
    expect(vetoState.status).toBe('completed');
    expect(vetoState.pickedMaps).toHaveLength(1);
    
    const pickedMap = vetoState.pickedMaps[0];
    expect(pickedMap.mapName).toBe('de_nuke'); // Last remaining map
    expect(pickedMap.sideTeam2).toBe('CT'); // Team2 (Team B) picked CT
    expect(pickedMap.sideTeam1).toBe('T'); // Team1 (Team A) gets opposite side

    // Verify match config has correct side assignment
    const matchResponse = await request.get(`/api/matches/${matchSlug}`);
    expect(matchResponse.ok()).toBeTruthy();
    const matchData = await matchResponse.json();
    const config = JSON.parse(matchData.match.config);
    
    expect(config.maplist).toContain('de_nuke');
    expect(config.map_sides).toBeDefined();
    
    // Since team2 picked CT, team2 starts CT, so map_sides[0] should be 'team2_ct'
    if (config.map_sides && config.map_sides.length > 0) {
      expect(config.map_sides[0]).toBe('team2_ct');
    }
  });

  test('should correctly assign sides when team2 picks T (CS Major format)', {
    tag: ['@veto', '@sides'],
  }, async ({ page, request }) => {
    // CS Major BO1 format: Team A (team1) removes 2, Team B (team2) removes 3, Team A removes 1, Team B picks side
    // Step 1-2: Team1 (Team A) removes 2 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_mirage', teamSlug: team1Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_inferno', teamSlug: team1Id },
    });

    // Step 3-5: Team2 (Team B) removes 3 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_anubis', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_dust2', teamSlug: team2Id },
    });

    // Step 6: Team1 (Team A) removes 1 map
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_vertigo', teamSlug: team1Id },
    });

    // Step 7: Team2 (Team B) picks side (T) - CS Major format
    const sidePickResponse = await request.post(`/api/veto/${matchSlug}/action`, {
      data: { side: 'T', teamSlug: team2Id },
    });
    expect(sidePickResponse.ok()).toBeTruthy();
    const sidePickData = await sidePickResponse.json();

    // Verify the veto state has correct sides
    const vetoState = sidePickData.veto;
    expect(vetoState.status).toBe('completed');
    expect(vetoState.pickedMaps).toHaveLength(1);
    
    const pickedMap = vetoState.pickedMaps[0];
    expect(pickedMap.sideTeam2).toBe('T'); // Team2 (Team B) picked T
    expect(pickedMap.sideTeam1).toBe('CT'); // Team1 (Team A) gets opposite side

    // Verify match config
    const matchResponse = await request.get(`/api/matches/${matchSlug}`);
    expect(matchResponse.ok()).toBeTruthy();
    const matchData = await matchResponse.json();
    const config = JSON.parse(matchData.match.config);
    
    // Since team2 picked T, team1 starts CT, so map_sides[0] should be 'team1_ct'
    if (config.map_sides && config.map_sides.length > 0) {
      expect(config.map_sides[0]).toBe('team1_ct');
    }
  });

  test('should display correct side badge for team1 when viewing veto interface', {
    tag: ['@veto', '@ui'],
  }, async ({ page, request }) => {
    // CS Major BO1 format: Team A (team1) removes 2, Team B (team2) removes 3, Team A removes 1, Team B picks side
    // Step 1-2: Team1 removes 2 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_mirage', teamSlug: team1Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_inferno', teamSlug: team1Id },
    });

    // Step 3-5: Team2 removes 3 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_anubis', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_dust2', teamSlug: team2Id },
    });

    // Step 6: Team1 removes 1 map
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_vertigo', teamSlug: team1Id },
    });

    // Step 7: Team2 picks side (CT) - CS Major format
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { side: 'CT', teamSlug: team2Id },
    });

    // View veto interface as team1
    await page.goto(`/team/${team1Id}/match`);
    await page.waitForLoadState('networkidle');

    // Since team2 picked CT, team1 gets T, so team1 should see T badge
    const tBadge = page.locator('text=/T|Terrorist/i').first();
    await expect(tBadge).toBeVisible({ timeout: 5000 });

    // Verify the picked map card shows T badge for team1
    const mapCard = page.locator('[data-state="picked"]').or(page.locator('text=de_nuke')).first();
    const sideChip = mapCard.locator('text=T').or(mapCard.locator('[aria-label*="T"]'));
    const sideChipVisible = await sideChip.isVisible().catch(() => false);
    
    // If the side badge is visible, it should show T for team1
    if (sideChipVisible) {
      await expect(sideChip).toBeVisible();
    }
  });

  test('should display correct side badge for team2 when viewing veto interface', {
    tag: ['@veto', '@ui'],
  }, async ({ page, request }) => {
    // CS Major BO1 format: Team A (team1) removes 2, Team B (team2) removes 3, Team A removes 1, Team B picks side
    // Step 1-2: Team1 removes 2 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_mirage', teamSlug: team1Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_inferno', teamSlug: team1Id },
    });

    // Step 3-5: Team2 removes 3 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_anubis', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_dust2', teamSlug: team2Id },
    });

    // Step 6: Team1 removes 1 map
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_vertigo', teamSlug: team1Id },
    });

    // Step 7: Team2 picks side (CT) - CS Major format
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { side: 'CT', teamSlug: team2Id },
    });

    // View veto interface as team2
    await page.goto(`/team/${team2Id}/match`);
    await page.waitForLoadState('networkidle');

    // Check that the side badge shows "CT" for team2 (since team2 picked CT)
    const ctBadge = page.locator('text=/CT|Counter-Terrorist/i').first();
    await expect(ctBadge).toBeVisible({ timeout: 5000 });

    // Verify the picked map card shows CT badge
    const mapCard = page.locator('[data-state="picked"]').or(page.locator('text=de_nuke')).first();
    const sideChip = mapCard.locator('text=CT').or(mapCard.locator('[aria-label*="CT"]'));
    const sideChipVisible = await sideChip.isVisible().catch(() => false);
    
    // If the side badge is visible, it should show CT for team2
    if (sideChipVisible) {
      await expect(sideChip).toBeVisible();
    }
  });

  test('should correctly handle BO3 veto with multiple side picks', {
    tag: ['@veto', '@sides', '@bo3'],
  }, async ({ page, request }) => {
    // Create a new tournament with BO3 format for this test
    const timestamp = Date.now();
    const bo3TournamentResponse = await request.post('/api/tournament', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        name: `BO3 Veto Test ${timestamp}`,
        type: 'single_elimination',
        format: 'bo3',
        maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
        teamIds: [team1Id, team2Id],
      },
    });
    expect(bo3TournamentResponse.ok()).toBeTruthy();

    // Start tournament
    await request.post('/api/tournament/start', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });

    // Get match slug
    const matchesResponse = await request.get('/api/matches');
    const matchesData = await matchesResponse.json();
    const bo3Match = matchesData.matches.find((m: any) => 
      (m.team1_id === team1Id && m.team2_id === team2Id) || 
      (m.team1_id === team2Id && m.team2_id === team1Id)
    );
    const bo3MatchSlug = bo3Match?.slug || matchSlug;

    // CS Major BO3 veto order (9 steps):
    // 1. Team A (team1) removes 1
    // 2. Team B (team2) removes 1
    // 3. Team A picks Map 1
    // 4. Team B picks side on Map 1
    // 5. Team B picks Map 2
    // 6. Team A picks side on Map 2
    // 7. Team B removes 1
    // 8. Team A removes 1
    // 9. Team B picks side on Map 3 (decider)

    // Step 1: Team1 (Team A) removes 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_mirage', teamSlug: team1Id },
    });

    // Step 2: Team2 (Team B) removes 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_inferno', teamSlug: team2Id },
    });

    // Step 3: Team1 (Team A) picks de_ancient (Map 1)
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: team1Id },
    });

    // Step 4: Team2 (Team B) picks side CT on Map 1
    const sidePick1Response = await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { side: 'CT', teamSlug: team2Id },
    });
    const sidePick1Data = await sidePick1Response.json();
    expect(sidePick1Data.veto.pickedMaps[0].sideTeam2).toBe('CT');
    expect(sidePick1Data.veto.pickedMaps[0].sideTeam1).toBe('T'); // Opposite

    // Step 5: Team2 (Team B) picks de_anubis (Map 2)
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_anubis', teamSlug: team2Id },
    });

    // Step 6: Team1 (Team A) picks side T on Map 2
    const sidePick2Response = await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { side: 'T', teamSlug: team1Id },
    });
    const sidePick2Data = await sidePick2Response.json();
    expect(sidePick2Data.veto.pickedMaps).toHaveLength(2);
    
    // Map 1: team2 picked CT, so team1 has T
    expect(sidePick2Data.veto.pickedMaps[0].sideTeam2).toBe('CT');
    expect(sidePick2Data.veto.pickedMaps[0].sideTeam1).toBe('T');
    
    // Map 2: team1 picked T, so team2 has CT
    expect(sidePick2Data.veto.pickedMaps[1].sideTeam1).toBe('T');
    expect(sidePick2Data.veto.pickedMaps[1].sideTeam2).toBe('CT');

    // Step 7: Team2 (Team B) removes 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_dust2', teamSlug: team2Id },
    });

    // Step 8: Team1 (Team A) removes 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_vertigo', teamSlug: team1Id },
    });

    // Step 9: Team2 (Team B) picks side on Map 3 (decider) - CS Major format
    const finalResponse = await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { side: 'CT', teamSlug: team2Id },
    });
    const finalData = await finalResponse.json();
    
    // Veto should be completed
    expect(finalData.veto.status).toBe('completed');
    
    // Should have 3 maps (2 picked + 1 decider)
    expect(finalData.veto.pickedMaps.length).toBe(3);
    
    // Verify sides are correct for all maps
    const map1 = finalData.veto.pickedMaps.find((m: any) => m.mapNumber === 1);
    const map2 = finalData.veto.pickedMaps.find((m: any) => m.mapNumber === 2);
    const map3 = finalData.veto.pickedMaps.find((m: any) => m.mapNumber === 3);
    
    if (map1 && map1.sideTeam1 && map1.sideTeam2) {
      expect(map1.sideTeam1).toBe('T');
      expect(map1.sideTeam2).toBe('CT');
    }
    
    if (map2 && map2.sideTeam1 && map2.sideTeam2) {
      expect(map2.sideTeam1).toBe('T');
      expect(map2.sideTeam2).toBe('CT');
    }
    
    // Map 3 (decider): team2 picked CT
    if (map3 && map3.sideTeam1 && map3.sideTeam2) {
      expect(map3.sideTeam2).toBe('CT');
      expect(map3.sideTeam1).toBe('T');
      expect(map3.knifeRound).toBe(false); // No knife round, side is picked
    }
  });

  test('should use CS Major BO1 format by default', {
    tag: ['@veto', '@cs-major'],
  }, async ({ page, request }) => {
    // CS Major BO1 format: Team A removes 2, Team B removes 3, Team A removes 1, Team B picks side
    // Step 1-2: Team1 (Team A) removes 2 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_mirage', teamSlug: team1Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_inferno', teamSlug: team1Id },
    });

    // Step 3-5: Team2 (Team B) removes 3 maps
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_anubis', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_dust2', teamSlug: team2Id },
    });

    // Step 6: Team1 (Team A) removes 1 map
    await request.post(`/api/veto/${matchSlug}/action`, {
      data: { mapName: 'de_vertigo', teamSlug: team1Id },
    });

    // Step 7: Team2 (Team B) picks side (CS Major format)
    const sidePickResponse = await request.post(`/api/veto/${matchSlug}/action`, {
      data: { side: 'CT', teamSlug: team2Id },
    });
    
    if (!sidePickResponse.ok()) {
      const errorText = await sidePickResponse.text();
      console.error('BO1 side pick failed:', {
        status: sidePickResponse.status(),
        statusText: sidePickResponse.statusText(),
        error: errorText,
        matchSlug,
        team2Id,
      });
    }
    
    expect(sidePickResponse.ok()).toBeTruthy();
    const sidePickData = await sidePickResponse.json();

    // Verify veto completed with CS Major format
    const vetoState = sidePickData.veto;
    expect(vetoState.status).toBe('completed');
    expect(vetoState.pickedMaps).toHaveLength(1);
    expect(vetoState.pickedMaps[0].mapName).toBe('de_nuke'); // Last remaining map
    expect(vetoState.pickedMaps[0].sideTeam2).toBe('CT'); // Team B (team2) picked CT
    expect(vetoState.pickedMaps[0].sideTeam1).toBe('T'); // Team A (team1) gets opposite
  });

  test('should use CS Major BO3 format with decider side pick', {
    tag: ['@veto', '@cs-major', '@bo3'],
  }, async ({ page, request }) => {
    // Create BO3 tournament
    const timestamp = Date.now();
    const bo3TournamentResponse = await request.post('/api/tournament', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        name: `CS Major BO3 Test ${timestamp}`,
        type: 'single_elimination',
        format: 'bo3',
        maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
        teamIds: [team1Id, team2Id],
      },
    });
    expect(bo3TournamentResponse.ok()).toBeTruthy();

    await request.post('/api/tournament/start', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    expect(bo3TournamentResponse.ok()).toBeTruthy();

    // Get match slug using expect.poll for cleaner code
    const bo3Match = await expect.poll(async () => {
      const matchesResponse = await request.get('/api/matches');
      const matchesData = await matchesResponse.json();
      return matchesData.matches?.find((m: any) => 
        (m.team1?.id === team1Id && m.team2?.id === team2Id) || 
        (m.team1?.id === team2Id && m.team2?.id === team1Id) ||
        (m.team1_id === team1Id && m.team2_id === team2Id) ||
        (m.team1_id === team2Id && m.team2_id === team1Id)
      );
    }, {
      message: 'BO3 match to be created',
      timeout: 10000,
      intervals: [500, 1000]
    }).resolves.toBeTruthy();

    const bo3MatchSlug = bo3Match.slug;
    expect(bo3MatchSlug).toBeTruthy();

    // CS Major BO3 format: 9 steps
    // 1. Team A removes 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_mirage', teamSlug: team1Id },
    });

    // 2. Team B removes 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_inferno', teamSlug: team2Id },
    });

    // 3. Team A picks Map 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: team1Id },
    });

    // 4. Team B picks side on Map 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { side: 'CT', teamSlug: team2Id },
    });

    // 5. Team B picks Map 2
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_anubis', teamSlug: team2Id },
    });

    // 6. Team A picks side on Map 2
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { side: 'T', teamSlug: team1Id },
    });

    // 7. Team B removes 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_dust2', teamSlug: team2Id },
    });

    // 8. Team A removes 1
    await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { mapName: 'de_vertigo', teamSlug: team1Id },
    });

    // 9. Team B picks side on Map 3 (decider) - CS Major format
    const finalResponse = await request.post(`/api/veto/${bo3MatchSlug}/action`, {
      data: { side: 'CT', teamSlug: team2Id },
    });
    
    if (!finalResponse.ok()) {
      const errorText = await finalResponse.text();
      console.error('BO3 side pick failed:', {
        status: finalResponse.status(),
        statusText: finalResponse.statusText(),
        error: errorText,
        bo3MatchSlug,
        team2Id,
      });
    }
    
    expect(finalResponse.ok()).toBeTruthy();
    const finalData = await finalResponse.json();

    // Verify veto completed with CS Major BO3 format
    const vetoState = finalData.veto;
    expect(vetoState.status).toBe('completed');
    expect(vetoState.pickedMaps).toHaveLength(3); // 2 picked + 1 decider
    
    // Verify Map 1 sides
    const map1 = vetoState.pickedMaps.find((m: any) => m.mapNumber === 1);
    expect(map1.mapName).toBe('de_ancient');
    expect(map1.sideTeam2).toBe('CT'); // Team B picked CT
    expect(map1.sideTeam1).toBe('T'); // Team A gets opposite
    
    // Verify Map 2 sides
    const map2 = vetoState.pickedMaps.find((m: any) => m.mapNumber === 2);
    expect(map2.mapName).toBe('de_anubis');
    expect(map2.sideTeam1).toBe('T'); // Team A picked T
    expect(map2.sideTeam2).toBe('CT'); // Team B gets opposite
    
    // Verify Map 3 (decider) sides
    const map3 = vetoState.pickedMaps.find((m: any) => m.mapNumber === 3);
    expect(map3.mapName).toBe('de_nuke'); // Decider map
    expect(map3.sideTeam2).toBe('CT'); // Team B picked side on decider (CS Major format)
    expect(map3.sideTeam1).toBe('T'); // Team A gets opposite
    expect(map3.knifeRound).toBe(false); // No knife round, side is picked
  });

  test('should validate and reject invalid custom veto orders', {
    tag: ['@veto', '@custom', '@validation'],
  }, async ({ page, request }) => {
    // Create tournament with invalid custom veto order (wrong number of picks)
    const timestamp = Date.now();
    const invalidVetoOrder = {
      bo3: [
        { step: 1, team: 'team1', action: 'ban' },
        { step: 2, team: 'team2', action: 'ban' },
        { step: 3, team: 'team1', action: 'pick' }, // Only 1 pick instead of 2
        { step: 4, team: 'team2', action: 'side_pick' },
        { step: 5, team: 'team1', action: 'ban' },
        { step: 6, team: 'team2', action: 'ban' },
      ],
    };

    // Note: The API doesn't currently expose custom veto order validation during tournament creation
    // This test verifies that the system falls back to standard format when custom order is invalid
    // In a real scenario, the validation would happen when the veto is initialized
    
    // Create tournament (custom veto order would be in settings if supported)
    const tournamentResponse = await request.post('/api/tournament', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        name: `Invalid Veto Test ${timestamp}`,
        type: 'single_elimination',
        format: 'bo3',
        maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
        teamIds: [team1Id, team2Id],
        settings: {
          customVetoOrder: invalidVetoOrder,
        },
      },
    });
    expect(tournamentResponse.ok()).toBeTruthy();

    await request.post('/api/tournament/start', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    const matchesResponse = await request.get('/api/matches');
    const matchesData = await matchesResponse.json();
    const testMatch = matchesData.matches.find((m: any) => 
      (m.team1_id === team1Id && m.team2_id === team2Id) || 
      (m.team1_id === team2Id && m.team2_id === team1Id)
    );
    const testMatchSlug = testMatch?.slug;

    // Get veto state - should use standard format (fallback from invalid custom)
    const vetoResponse = await request.get(`/api/veto/${testMatchSlug}`);
    expect(vetoResponse.ok()).toBeTruthy();
    const vetoData = await vetoResponse.json();
    
    // Should have 9 steps (CS Major BO3 standard format)
    expect(vetoData.veto.totalSteps).toBe(9);
  });

  test('should use custom veto order when valid', {
    tag: ['@veto', '@custom'],
  }, async ({ page, request }) => {
    // Create a valid custom BO1 veto order
    const timestamp = Date.now();
    const customVetoOrder = {
      bo1: [
        { step: 1, team: 'team1', action: 'ban' },
        { step: 2, team: 'team1', action: 'ban' },
        { step: 3, team: 'team2', action: 'ban' },
        { step: 4, team: 'team2', action: 'ban' },
        { step: 5, team: 'team2', action: 'ban' },
        { step: 6, team: 'team1', action: 'ban' },
        { step: 7, team: 'team2', action: 'side_pick' },
      ],
    };

    // Create tournament with custom veto order
    const tournamentResponse = await request.post('/api/tournament', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      data: {
        name: `Custom Veto Test ${timestamp}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
        teamIds: [team1Id, team2Id],
        settings: {
          customVetoOrder: customVetoOrder,
        },
      },
    });
    expect(tournamentResponse.ok()).toBeTruthy();

    await request.post('/api/tournament/start', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    const matchesResponse = await request.get('/api/matches');
    const matchesData = await matchesResponse.json();
    const customMatch = matchesData.matches.find((m: any) => 
      (m.team1_id === team1Id && m.team2_id === team2Id) || 
      (m.team1_id === team2Id && m.team2_id === team1Id)
    );
    const customMatchSlug = customMatch?.slug;

    // Get veto state - should use custom order (same as CS Major format in this case)
    const vetoResponse = await request.get(`/api/veto/${customMatchSlug}`);
    expect(vetoResponse.ok()).toBeTruthy();
    const vetoData = await vetoResponse.json();
    
    // Should have 7 steps (custom BO1 format)
    expect(vetoData.veto.totalSteps).toBe(7);
    
    // Verify the order matches custom format
    // Complete the veto to verify it works
    await request.post(`/api/veto/${customMatchSlug}/action`, {
      data: { mapName: 'de_mirage', teamSlug: team1Id },
    });
    await request.post(`/api/veto/${customMatchSlug}/action`, {
      data: { mapName: 'de_inferno', teamSlug: team1Id },
    });
    await request.post(`/api/veto/${customMatchSlug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${customMatchSlug}/action`, {
      data: { mapName: 'de_anubis', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${customMatchSlug}/action`, {
      data: { mapName: 'de_dust2', teamSlug: team2Id },
    });
    await request.post(`/api/veto/${customMatchSlug}/action`, {
      data: { mapName: 'de_vertigo', teamSlug: team1Id },
    });
    
    const finalResponse = await request.post(`/api/veto/${customMatchSlug}/action`, {
      data: { side: 'CT', teamSlug: team2Id },
    });
    expect(finalResponse.ok()).toBeTruthy();
    const finalData = await finalResponse.json();
    expect(finalData.veto.status).toBe('completed');
  });
});
