import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import { executeVetoActions, getVetoState, getCSMajorBO1Actions, getCSMajorBO3Actions } from '../helpers/veto';

/**
 * CS Major Veto Format API tests
 * Tests complete veto flow and config generation via API
 * 
 * @tag api
 * @tag veto
 * @tag cs-major
 * @tag e2e-flow
 */

test.describe.serial('CS Major BO1 Veto - API E2E', () => {
  let team1Id: string;
  let team2Id: string;
  let matchSlug: string;
  const maps = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    
    // Create teams
    const teams = await createTestTeams(request, 'cs-major-bo1');
    expect(teams).toBeTruthy();
    if (!teams) return;
    
    [team1Id, team2Id] = [teams[0].id, teams[1].id];

    // Create and start BO1 tournament
    const tournament = await createAndStartTournament(request, {
      name: `CS Major BO1 Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    // Find match
    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();
    matchSlug = match!.slug;
  });

  test('should complete CS Major BO1 veto and generate match config', {
    tag: ['@api', '@veto', '@cs-major', '@bo1'],
  }, async ({ request }) => {
    // Execute CS Major BO1 veto (7 steps)
    const actions = getCSMajorBO1Actions(team1Id, team2Id);
    const finalResponse = await executeVetoActions(request, matchSlug, actions);
    expect(finalResponse).toBeTruthy();

    // Verify veto completed
    const vetoState = await getVetoState(request, matchSlug);
    expect(vetoState).toBeTruthy();
    expect(vetoState.status).toBe('completed');
    expect(vetoState.pickedMaps).toHaveLength(1);
    expect(vetoState.pickedMaps[0].mapName).toBe('de_nuke');
    expect(vetoState.pickedMaps[0].sideTeam2).toBe('CT');
    expect(vetoState.pickedMaps[0].sideTeam1).toBe('T');

    // Poll for config to be generated
    await expect.poll(async () => {
      const configResponse = await request.get(`/api/matches/${matchSlug}.json`);
      return configResponse.ok();
    }, {
      timeout: 5000,
      intervals: [100, 250, 500],
    }).toBe(true);
  });

  test('should verify match config JSON has correct veto results', {
    tag: ['@api', '@veto', '@cs-major', '@verification'],
  }, async ({ request }) => {
    // Complete veto first
    const actions = getCSMajorBO1Actions(team1Id, team2Id);
    await executeVetoActions(request, matchSlug, actions);

    // Poll until veto is completed
    const vetoCheckData = await expect.poll(async () => {
      const vetoCheckResponse = await request.get(`/api/veto/${matchSlug}`);
      expect(vetoCheckResponse.ok()).toBeTruthy();
      const data = await vetoCheckResponse.json();
      return data.veto.status === 'completed' ? data : null;
    }, {
      message: 'Veto state to be completed',
      timeout: 5000,
      intervals: [500, 1000],
    });
    expect(vetoCheckData).toBeTruthy();
    expect(vetoCheckData.veto.status).toBe('completed');
    expect(vetoCheckData.veto.tournament.format).toBe('bo1');

    // Poll for config
    await expect.poll(async () => {
      const configResponse = await request.get(`/api/matches/${matchSlug}.json`);
      return configResponse.ok();
    }, {
      timeout: 5000,
      intervals: [100, 250, 500],
    }).toBe(true);

    // Verify config
    const configResponse = await request.get(`/api/matches/${matchSlug}.json`);
    expect(configResponse.ok()).toBeTruthy();
    const config = await configResponse.json();

    expect(config.num_maps).toBe(1);
    expect(Array.isArray(config.maplist)).toBe(true);
    expect(config.maplist.length).toBe(1);
    expect(config.maplist[0]).toBe('de_nuke');
    expect(Array.isArray(config.map_sides)).toBe(true);
    expect(config.map_sides.length).toBe(1);
    expect(config.map_sides[0]).toBe('team2_ct'); // Team B (team2) picked CT
  });
});

test.describe.serial('CS Major BO3 Veto - API E2E', () => {
  let team1Id: string;
  let team2Id: string;
  let matchSlug: string;
  const maps = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    
    // Create teams
    const teams = await createTestTeams(request, 'cs-major-bo3');
    expect(teams).toBeTruthy();
    if (!teams) return;
    
    [team1Id, team2Id] = [teams[0].id, teams[1].id];

    // Create and start BO3 tournament
    const tournament = await createAndStartTournament(request, {
      name: `CS Major BO3 Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo3',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    // Find match
    const match = await expect.poll(async () => {
      return await findMatchByTeams(request, team1Id, team2Id);
    }, {
      message: 'BO3 match to be created',
      timeout: 10000,
      intervals: [500, 1000],
    }).resolves.toBeTruthy();
    
    expect(match).toBeTruthy();
    matchSlug = match!.slug;
  });

  test('should complete CS Major BO3 veto with all 9 steps', {
    tag: ['@api', '@veto', '@cs-major', '@bo3'],
  }, async ({ request }) => {
    // Execute CS Major BO3 veto (9 steps)
    const actions = getCSMajorBO3Actions(team1Id, team2Id);
    const finalResponse = await executeVetoActions(request, matchSlug, actions);
    expect(finalResponse).toBeTruthy();

    // Verify veto completed
    const vetoState = await getVetoState(request, matchSlug);
    expect(vetoState).toBeTruthy();
    expect(vetoState.status).toBe('completed');
    expect(vetoState.pickedMaps).toHaveLength(3);
    
    // Map 1: team2 picked CT, team1 has T
    expect(vetoState.pickedMaps[0].sideTeam2).toBe('CT');
    expect(vetoState.pickedMaps[0].sideTeam1).toBe('T');
    
    // Map 2: team1 picked T, team2 has CT
    expect(vetoState.pickedMaps[1].sideTeam1).toBe('T');
    expect(vetoState.pickedMaps[1].sideTeam2).toBe('CT');
    
    // Map 3: team2 picked CT, team1 has T (decider)
    expect(vetoState.pickedMaps[2].sideTeam2).toBe('CT');
    expect(vetoState.pickedMaps[2].sideTeam1).toBe('T');
    expect(vetoState.pickedMaps[2].knifeRound).toBe(false); // No knife round
  });

  test('should verify BO3 match config has correct veto results', {
    tag: ['@api', '@veto', '@cs-major', '@bo3', '@verification'],
  }, async ({ request }) => {
    // Complete veto first
    const actions = getCSMajorBO3Actions(team1Id, team2Id);
    await executeVetoActions(request, matchSlug, actions);

    // Poll for config
    await expect.poll(async () => {
      const configResponse = await request.get(`/api/matches/${matchSlug}.json`);
      return configResponse.ok();
    }, {
      timeout: 5000,
      intervals: [100, 250, 500],
    }).toBe(true);

    // Verify config
    const configResponse = await request.get(`/api/matches/${matchSlug}.json`);
    expect(configResponse.ok()).toBeTruthy();
    const config = await configResponse.json();

    expect(config.num_maps).toBe(3);
    expect(Array.isArray(config.maplist)).toBe(true);
    expect(config.maplist.length).toBe(3);
    expect(Array.isArray(config.map_sides)).toBe(true);
    expect(config.map_sides.length).toBe(3);
    // All maps should have team2_ct (Team B picked CT on all maps)
    expect(config.map_sides.every((side: string) => side === 'team2_ct')).toBe(true);
  });
});

