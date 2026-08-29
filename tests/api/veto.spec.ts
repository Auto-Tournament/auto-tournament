import { test, expect } from '@playwright/test';
import {
  ensureSignedIn,
  signInViaRequest,
  impersonatePlayer,
  stopImpersonating,
} from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import {
  executeVetoActions,
  getVetoState,
  getCSMajorBO1Actions,
  getCSMajorBO3Actions,
  actingSteamIdFor,
} from '../helpers/veto';
import type { Team } from '../helpers/teams';

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
  let team1: Team;
  let team2: Team;
  let team1Id: string;
  let team2Id: string;
  const maps = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    // `page` and `request` have separate cookie jars – the API helpers below
    // use `request`, so it needs its own admin session.
    await signInViaRequest(request);
    
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
    
    [team1, team2] = [setup.teams[0], setup.teams[1]];
    [team1Id, team2Id] = [team1.id, team2.id];
  });

  test('should complete CS Major BO1 veto and assign sides correctly', {
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
    const actions = getCSMajorBO1Actions(team1, team2);
    const finalResponse = await executeVetoActions(request, match!.slug, actions);
    expect(finalResponse).toBeTruthy();

    // Verify veto completed
    const vetoState = await getVetoState(request, match!.slug, actingSteamIdFor(team1));
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
    const actions = getCSMajorBO3Actions(team1, team2);
    const finalResponse = await executeVetoActions(request, match!.slug, actions);
    expect(finalResponse).toBeTruthy();

    // Verify veto completed
    const vetoState = await getVetoState(request, match!.slug, actingSteamIdFor(team1));
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
      ...getCSMajorBO1Actions(team1, team2).slice(0, 6), // All bans
      { side: 'CT', teamSlug: team2Id, actAsSteamId: actingSteamIdFor(team2) }, // Team B picks CT
    ];
    const ctResponse = await executeVetoActions(request, match!.slug, ctActions);
    expect(ctResponse).toBeTruthy();
    
    let vetoState = await getVetoState(request, match!.slug, actingSteamIdFor(team1));
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
      ...getCSMajorBO1Actions(team1, team2).slice(0, 6), // All bans
      { side: 'T', teamSlug: team2Id, actAsSteamId: actingSteamIdFor(team2) }, // Team B picks T
    ];
    const tResponse = await executeVetoActions(request, match2!.slug, tActions);
    expect(tResponse).toBeTruthy();
    
    vetoState = await getVetoState(request, match2!.slug, actingSteamIdFor(team1));
    expect(vetoState.pickedMaps[0].sideTeam2).toBe('T');
    expect(vetoState.pickedMaps[0].sideTeam1).toBe('CT');
  });

  test('should tell the first team it is their turn before any action is taken', {
    tag: ['@api', '@veto', '@cta'],
  }, async ({ request }) => {
    const tournament = await createAndStartTournament(request, {
      name: `Veto CTA Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo1',
      maps,
      teamIds: [team1Id, team2Id],
    });
    expect(tournament).toBeTruthy();

    const match = await findMatchByTeams(request, team1Id, team2Id);
    expect(match).toBeTruthy();

    // Nothing has been vetoed yet, so matches.veto_state is still NULL. The
    // navbar CTA must still tell team1's players to act — reading the turn
    // straight off veto_state reports "waiting" here, which is exactly backwards
    // for the team that has to move first.
    expect(await impersonatePlayer(request, actingSteamIdFor(team1))).toBe(true);
    const first = await (await request.get('/api/players/me/match-status')).json();
    expect(first.matchSlug).toBe(match!.slug);
    expect(first.status).toBe('your_turn_veto');

    // Their opponent is correctly told to wait.
    expect(await impersonatePlayer(request, actingSteamIdFor(team2))).toBe(true);
    const second = await (await request.get('/api/players/me/match-status')).json();
    expect(second.status).toBe('waiting_veto');

    // BO1 opens with *two* team1 bans, so after the first the turn stays put.
    const actions = getCSMajorBO1Actions(team1, team2);
    expect(await executeVetoActions(request, match!.slug, [actions[0]])).toBeTruthy();

    expect(await impersonatePlayer(request, actingSteamIdFor(team1))).toBe(true);
    expect((await (await request.get('/api/players/me/match-status')).json()).status).toBe(
      'your_turn_veto'
    );

    expect(await impersonatePlayer(request, actingSteamIdFor(team2))).toBe(true);
    expect((await (await request.get('/api/players/me/match-status')).json()).status).toBe(
      'waiting_veto'
    );

    // Team1's second ban hands over to team2.
    expect(await executeVetoActions(request, match!.slug, [actions[1]])).toBeTruthy();

    expect(await impersonatePlayer(request, actingSteamIdFor(team2))).toBe(true);
    expect((await (await request.get('/api/players/me/match-status')).json()).status).toBe(
      'your_turn_veto'
    );

    expect(await impersonatePlayer(request, actingSteamIdFor(team1))).toBe(true);
    expect((await (await request.get('/api/players/me/match-status')).json()).status).toBe(
      'waiting_veto'
    );

    await stopImpersonating(request);
  });

  test('should validate and reject invalid custom veto orders', {
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
    const vetoState = await getVetoState(request, match!.slug, actingSteamIdFor(team1));
    expect(vetoState).toBeTruthy();
    expect(vetoState.totalSteps).toBe(7);

    // Complete the veto to verify it works
    const actions = getCSMajorBO1Actions(team1, team2);
    const finalResponse = await executeVetoActions(request, match!.slug, actions);
    expect(finalResponse).toBeTruthy();
    
    const completedVeto = await getVetoState(request, match!.slug, actingSteamIdFor(team1));
    expect(completedVeto.status).toBe('completed');
  });
});

