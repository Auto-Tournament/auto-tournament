import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInAsPlayer } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import { executeVetoActions, getVetoState, getCSMajorBO1Actions, getCSMajorBO3Actions } from '../helpers/veto';

/**
 * Veto API tests
 * Tests veto functionality via API
 * 
 * @tag api
 * @tag veto
 * @tag maps
 * @tag sides
 */

test.describe.serial('Veto API', () => {
  let team1Id: string;
  let team2Id: string;
  let team1PlayerSteamId: string;
  let team2PlayerSteamId: string;
  const maps = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    
    // Setup tournament with all prerequisites (webhook, servers, teams)
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamCount: 2,
      serverCount: 1,
      prefix: 'veto-api',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;
    
    [team1Id, team2Id] = [setup.teams[0].id, setup.teams[1].id];
    team1PlayerSteamId = setup.teams[0].players[0].steamId;
    team2PlayerSteamId = setup.teams[1].players[0].steamId;
  });

  test('should give team2 the full BO1 veto turn after team1 bans twice', {
    tag: ['@api', '@veto', '@bo1', '@regression'],
  }, async ({ page, request }) => {
    let match: any = null;
    await expect.poll(async () => {
      const found = await findMatchByTeams(request, team1Id, team2Id);
      if (found) {
        match = found;
        return true;
      }
      return false;
    }, {
      message: 'BO1 match to be created',
      timeout: 10000,
      intervals: [500, 1000],
    }).toBe(true);

    expect(match?.slug).toBeTruthy();

    expect(await signInAsPlayer(page, team1PlayerSteamId)).toBe(true);

    for (const mapName of ['de_mirage', 'de_inferno']) {
      const actionResponse = await page.request.post(`/api/veto/${match.slug}/action`, {
        data: { mapName, teamSlug: team1Id },
      });

      expect(actionResponse.ok()).toBe(true);

      const actionData = await actionResponse.json();
      expect(actionData.success).toBe(true);
    }

    expect(await signInAsPlayer(page, team2PlayerSteamId)).toBe(true);

    const vetoResponse = await page.request.get(`/api/veto/${match.slug}`);
    expect(vetoResponse.ok()).toBe(true);

    const vetoData = await vetoResponse.json();
    expect(vetoData.success).toBe(true);
    expect(Array.isArray(vetoData.veto.availableMaps)).toBe(true);
    expect(vetoData.veto.availableMaps).toHaveLength(5);
    expect(vetoData.veto.currentTurn).toBe('team2');
    expect(vetoData.veto.currentAction).toBe('ban');
    expect(vetoData.veto.currentStep).toBe(3);

    const team2ActionResponse = await page.request.post(`/api/veto/${match.slug}/action`, {
      data: { mapName: 'de_ancient', teamSlug: team2Id },
    });
    expect(team2ActionResponse.ok()).toBe(true);

    const team2ActionData = await team2ActionResponse.json();
    expect(team2ActionData.success).toBe(true);
    expect(team2ActionData.veto.currentStep).toBe(4);
    expect(team2ActionData.veto.currentTurn).toBe('team2');
    expect(team2ActionData.veto.currentAction).toBe('ban');
  });

  test.skip('should complete CS Major BO1 veto and assign sides correctly', {
    tag: ['@api', '@veto', '@cs-major', '@bo1'],
  }, async ({ request }) => {
    // Create and start BO1 tournament
    const tournament = await createAndStartTournament(request, {
      name: `BO1 Veto Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    // Find match
    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();
    expect(match?.slug).toBeTruthy();

    // Execute CS Major BO1 veto (7 steps)
    const actions = getCSMajorBO1Actions(team1Id, team2Id);
    const finalResponse = await executeVetoActions(request, match!.slug, actions);
    expect(finalResponse).toBeTruthy();

    // Verify veto completed
    const vetoState = await getVetoState(request, match!.slug);
    expect(vetoState).toBeTruthy();
    expect(vetoState.status).toBe('completed');
    expect(vetoState.pickedMaps).toHaveLength(1);
    expect(vetoState.pickedMaps[0].mapName).toBe('de_nuke'); // Last remaining map
    expect(vetoState.pickedMaps[0].sideTeam2).toBe('CT'); // Team B picked CT
    expect(vetoState.pickedMaps[0].sideTeam1).toBe('T'); // Team A gets opposite
  });

  test('should complete CS Major BO3 veto with multiple side picks', {
    tag: ['@api', '@veto', '@cs-major', '@bo3'],
  }, async ({ request }) => {
    // Create and start BO3 tournament
    const tournament = await createAndStartTournament(request, {
      name: `BO3 Veto Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo3',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    // Find match using closure variable pattern
    let match: any = null;
    await expect.poll(async () => {
      const found = await findMatchByTeams(request, team1Id, team2Id);
      if (found) {
        match = found;
        return true;
      }
      return false;
    }, {
      message: 'BO3 match to be created',
      timeout: 10000,
      intervals: [500, 1000],
    }).toBe(true);

    // Verify match was actually found and set
    if (!match) {
      throw new Error('Match not found after polling completed');
    }
    expect(match).toBeTruthy();
    expect(match.slug).toBeTruthy();

    // Execute CS Major BO3 veto (9 steps)
    const actions = getCSMajorBO3Actions(team1Id, team2Id);
    const finalResponse = await executeVetoActions(request, match!.slug, actions);
    expect(finalResponse).toBeTruthy();

    // Verify veto completed
    const vetoState = await getVetoState(request, match!.slug);
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

  test('should handle side picks for CT and T correctly', {
    tag: ['@api', '@veto', '@sides'],
  }, async ({ request }) => {
    // Create BO1 tournament
    const tournament = await createAndStartTournament(request, {
      name: `Side Pick Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();

    // Test CT side pick
    const ctActions = [
      ...getCSMajorBO1Actions(team1Id, team2Id).slice(0, 6), // All bans
      { side: 'CT', teamSlug: team2Id }, // Team B picks CT
    ];
    const ctResponse = await executeVetoActions(request, match!.slug, ctActions);
    expect(ctResponse).toBeTruthy();
    
    let vetoState = await getVetoState(request, match!.slug);
    expect(vetoState.pickedMaps[0].sideTeam2).toBe('CT');
    expect(vetoState.pickedMaps[0].sideTeam1).toBe('T');

    // Create new tournament for T side pick test
    const tournament2 = await createAndStartTournament(request, {
      name: `Side Pick T Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament2).toBeTruthy();

    const match2 = await findMatchByTeams(request, team1Id, team2Id);
    expect(match2).toBeTruthy();

    // Test T side pick
    const tActions = [
      ...getCSMajorBO1Actions(team1Id, team2Id).slice(0, 6), // All bans
      { side: 'T', teamSlug: team2Id }, // Team B picks T
    ];
    const tResponse = await executeVetoActions(request, match2!.slug, tActions);
    expect(tResponse).toBeTruthy();
    
    vetoState = await getVetoState(request, match2!.slug);
    expect(vetoState.pickedMaps[0].sideTeam2).toBe('T');
    expect(vetoState.pickedMaps[0].sideTeam1).toBe('CT');
  });

  // TODO: Implement custom veto order validation in tournament creation endpoint
  // The API currently accepts invalid custom veto orders (missing side pick for BO1)
  // Once validation is implemented, uncomment and complete this test
  test.skip('should validate and reject invalid custom veto orders', {
    tag: ['@api', '@veto', '@custom'],
  }, async ({ request }) => {
    // Create tournament with invalid custom veto order (missing side pick)
    const invalidOrder = {
      bo1: [
        { step: 1, team: 'team1', action: 'ban' },
        { step: 2, team: 'team1', action: 'ban' },
        { step: 3, team: 'team2', action: 'ban' },
        // Missing side pick - should fail validation
      ],
    };

    const response = await request.post('/api/tournament', {
      data: {
        name: `Invalid Veto Test ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps,
        teamIds: [team1Id, team2Id],
        settings: {
          customVetoOrder: invalidOrder,
        },
      },
    });

    // Should reject invalid order (missing side pick for BO1)
    // The API should validate custom veto orders and reject invalid ones
    // For BO1, a side_pick action is required in the last step
    expect(response.ok()).toBeFalsy();
    
    // Verify error response indicates validation failure
    const responseData = await response.json().catch(() => ({}));
    expect(responseData.error || responseData.message).toBeTruthy();
  });

  test('should use custom veto order when valid', {
    tag: ['@api', '@veto', '@custom'],
  }, async ({ request }) => {
    // Create valid custom BO1 veto order (same as CS Major format)
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

    const tournament = await createAndStartTournament(request, {
      name: `Custom Veto Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamIds: [team1Id, team2Id],
      settings: {
        customVetoOrder,
      },
    });
    expect(tournament).toBeTruthy();

    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();

    // Get veto state - should use custom order
    const vetoState = await getVetoState(request, match!.slug);
    expect(vetoState).toBeTruthy();
    expect(vetoState.totalSteps).toBe(7);

    // Complete the veto to verify it works
    const actions = getCSMajorBO1Actions(team1Id, team2Id);
    const finalResponse = await executeVetoActions(request, match!.slug, actions);
    expect(finalResponse).toBeTruthy();
    
    const completedVeto = await getVetoState(request, match!.slug);
    expect(completedVeto.status).toBe('completed');
  });
});

