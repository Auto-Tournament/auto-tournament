import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { wipeDatabaseAuto } from '../helpers/database';
import { createTournament, startTournament } from '../helpers/tournaments';
import { createTeams } from '../helpers/teams';

/**
 * MatchZy Enhanced v1.3.0 Configuration Tests
 * 
 * These tests verify that MatchZy Enhanced cvars are correctly applied
 * to tournament and manual matches based on tournament type.
 */

test.describe('MatchZy Enhanced Configuration', () => {
  test.beforeEach(async ({ page, request }) => {
    await wipeDatabaseAuto();
    await setupTestContext(page, request);
  });

  test('Single elimination tournament should use official profile', async ({ request }) => {
    // Create teams
    const team1 = await createTeams(request, 1, 'Official Team 1');
    const team2 = await createTeams(request, 1, 'Official Team 2');

    // Create single elimination tournament
    const tournament = await createTournament(request, {
      name: 'Official Tournament',
      type: 'single_elimination',
      format: 'bo3',
      teamIds: [team1[0].id, team2[0].id],
    });

    // Start tournament
    await startTournament(request, tournament.id);

    // Get first match
    const matchesResponse = await request.get(`/api/tournament/${tournament.id}/bracket`);
    expect(matchesResponse.ok()).toBeTruthy();
    const bracketData = await matchesResponse.json();
    const firstMatch = bracketData.matches[0];

    // Get match config
    const configResponse = await request.get(`/api/matches/${firstMatch.slug}/config`);
    expect(configResponse.ok()).toBeTruthy();
    const config = await configResponse.json();

    // Verify MatchZy Enhanced cvars (official profile)
    expect(config.cvars).toBeDefined();
    expect(config.cvars.matchzy_autoready_enabled).toBe(0); // Manual ready
    expect(config.cvars.matchzy_both_teams_unpause_required).toBe(1);
    expect(config.cvars.matchzy_max_pauses_per_team).toBe(2);
    expect(config.cvars.matchzy_pause_duration).toBe(300); // 5 minutes
    expect(config.cvars.matchzy_side_selection_enabled).toBe(1);
    expect(config.cvars.matchzy_side_selection_time).toBe(60);
    expect(config.cvars.matchzy_gg_enabled).toBe(0); // No forfeits
    expect(config.cvars.matchzy_ffw_enabled).toBe(1); // Handle disconnects
    expect(config.cvars.matchzy_ffw_time).toBe(240); // 4 minutes
  });

  test('Shuffle tournament should use shuffle profile', async ({ request }) => {
    // Create players
    const team = await createTeams(request, 1, 'Shuffle Players', 6); // 6 players for 2v2
    const playerIds = Object.keys(JSON.parse(team[0].players));

    // Create shuffle tournament
    const createResponse = await request.post('/api/tournament/shuffle', {
      data: {
        name: 'Shuffle Tournament',
        teamSize: 2,
        maps: ['de_dust2', 'de_mirage'],
        mapSequence: ['de_dust2', 'de_mirage'],
        playerIds: playerIds.slice(0, 4), // 4 players for 2v2
        maxRounds: 16,
        overtimeMode: 'disabled',
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const tournament = await createResponse.json();

    // Start tournament
    await startTournament(request, tournament.id);

    // Get first match
    const matchesResponse = await request.get(`/api/tournament/${tournament.id}/bracket`);
    expect(matchesResponse.ok()).toBeTruthy();
    const bracketData = await matchesResponse.json();
    const firstMatch = bracketData.matches[0];

    // Get match config
    const configResponse = await request.get(`/api/matches/${firstMatch.slug}/config`);
    expect(configResponse.ok()).toBeTruthy();
    const config = await configResponse.json();

    // Verify MatchZy Enhanced cvars (shuffle profile)
    expect(config.cvars).toBeDefined();
    expect(config.cvars.matchzy_autoready_enabled).toBe(1); // Auto-ready
    expect(config.cvars.matchzy_both_teams_unpause_required).toBe(1);
    expect(config.cvars.matchzy_max_pauses_per_team).toBe(1);
    expect(config.cvars.matchzy_pause_duration).toBe(180); // 3 minutes
    expect(config.cvars.matchzy_side_selection_enabled).toBe(1);
    expect(config.cvars.matchzy_side_selection_time).toBe(30); // Quick
    expect(config.cvars.matchzy_gg_enabled).toBe(0); // No forfeits
    expect(config.cvars.matchzy_ffw_enabled).toBe(0); // No FFW for shuffle
  });

  test('Double elimination tournament should use official profile', async ({ request }) => {
    // Create teams
    const teams = await createTeams(request, 4, 'DE Team');

    // Create double elimination tournament
    const tournament = await createTournament(request, {
      name: 'Double Elimination',
      type: 'double_elimination',
      format: 'bo3',
      teamIds: teams.map((t) => t.id),
    });

    // Start tournament
    await startTournament(request, tournament.id);

    // Get first match
    const matchesResponse = await request.get(`/api/tournament/${tournament.id}/bracket`);
    expect(matchesResponse.ok()).toBeTruthy();
    const bracketData = await matchesResponse.json();
    const firstMatch = bracketData.matches[0];

    // Get match config
    const configResponse = await request.get(`/api/matches/${firstMatch.slug}/config`);
    expect(configResponse.ok()).toBeTruthy();
    const config = await configResponse.json();

    // Verify MatchZy Enhanced cvars (official profile)
    expect(config.cvars).toBeDefined();
    expect(config.cvars.matchzy_autoready_enabled).toBe(0);
    expect(config.cvars.matchzy_max_pauses_per_team).toBe(2);
    expect(config.cvars.matchzy_pause_duration).toBe(300);
    expect(config.cvars.matchzy_gg_enabled).toBe(0);
    expect(config.cvars.matchzy_ffw_enabled).toBe(1);
  });

  test('Manual match should use default profile', async ({ request }) => {
    // Create teams
    const teams = await createTeams(request, 2, 'Manual Team');

    // Create manual match
    const createResponse = await request.post('/api/matches', {
      data: {
        slug: 'manual-match-test',
        config: {
          matchid: 0,
          skip_veto: true,
          players_per_team: 5,
          num_maps: 1,
          maplist: ['de_mirage'],
          map_sides: ['knife'],
          team1: {
            id: teams[0].id,
            name: teams[0].name,
            tag: teams[0].tag,
            players: JSON.parse(teams[0].players),
            series_score: 0,
          },
          team2: {
            id: teams[1].id,
            name: teams[1].name,
            tag: teams[1].tag,
            players: JSON.parse(teams[1].players),
            series_score: 0,
          },
        },
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const match = await createResponse.json();

    // Verify MatchZy Enhanced cvars (default profile)
    expect(match.config.cvars).toBeDefined();
    expect(match.config.cvars.matchzy_autoready_enabled).toBe(0); // Manual ready
    expect(match.config.cvars.matchzy_both_teams_unpause_required).toBe(1);
    expect(match.config.cvars.matchzy_max_pauses_per_team).toBe(0); // Unlimited
    expect(match.config.cvars.matchzy_pause_duration).toBe(0); // Unlimited
    expect(match.config.cvars.matchzy_side_selection_enabled).toBe(1);
    expect(match.config.cvars.matchzy_side_selection_time).toBe(60);
    expect(match.config.cvars.matchzy_gg_enabled).toBe(0); // No forfeits
    expect(match.config.cvars.matchzy_ffw_enabled).toBe(0); // No FFW
  });

  test('Manual match with custom MatchZy cvars should preserve them', async ({ request }) => {
    // Create teams
    const teams = await createTeams(request, 2, 'Custom Team');

    // Create manual match with custom MatchZy Enhanced cvars
    const createResponse = await request.post('/api/matches', {
      data: {
        slug: 'custom-match-test',
        config: {
          matchid: 0,
          skip_veto: true,
          players_per_team: 5,
          num_maps: 1,
          maplist: ['de_nuke'],
          map_sides: ['team1_ct'],
          team1: {
            id: teams[0].id,
            name: teams[0].name,
            tag: teams[0].tag,
            players: JSON.parse(teams[0].players),
            series_score: 0,
          },
          team2: {
            id: teams[1].id,
            name: teams[1].name,
            tag: teams[1].tag,
            players: JSON.parse(teams[1].players),
            series_score: 0,
          },
          cvars: {
            mp_maxrounds: 16,
            matchzy_autoready_enabled: 1, // Custom: auto-ready
            matchzy_gg_enabled: 1, // Custom: allow forfeits
            matchzy_gg_threshold: 0.6, // Custom: 60% threshold
          },
        },
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const match = await createResponse.json();

    // Verify custom MatchZy Enhanced cvars were preserved
    expect(match.config.cvars).toBeDefined();
    expect(match.config.cvars.matchzy_autoready_enabled).toBe(1); // Custom
    expect(match.config.cvars.matchzy_gg_enabled).toBe(1); // Custom
    expect(match.config.cvars.matchzy_gg_threshold).toBe(0.6); // Custom
    expect(match.config.cvars.mp_maxrounds).toBe(16);
  });

  test('Swiss tournament should use official profile', async ({ request }) => {
    // Create teams (8 teams for Swiss)
    const teams = await createTeams(request, 8, 'Swiss Team');

    // Create Swiss tournament
    const tournament = await createTournament(request, {
      name: 'Swiss Tournament',
      type: 'swiss',
      format: 'bo1',
      teamIds: teams.map((t) => t.id),
    });

    // Start tournament
    await startTournament(request, tournament.id);

    // Get first match
    const matchesResponse = await request.get(`/api/tournament/${tournament.id}/bracket`);
    expect(matchesResponse.ok()).toBeTruthy();
    const bracketData = await matchesResponse.json();
    const firstMatch = bracketData.matches[0];

    // Get match config
    const configResponse = await request.get(`/api/matches/${firstMatch.slug}/config`);
    expect(configResponse.ok()).toBeTruthy();
    const config = await configResponse.json();

    // Verify MatchZy Enhanced cvars (official profile)
    expect(config.cvars).toBeDefined();
    expect(config.cvars.matchzy_autoready_enabled).toBe(0);
    expect(config.cvars.matchzy_both_teams_unpause_required).toBe(1);
    expect(config.cvars.matchzy_max_pauses_per_team).toBe(2);
    expect(config.cvars.matchzy_pause_duration).toBe(300);
    expect(config.cvars.matchzy_gg_enabled).toBe(0);
    expect(config.cvars.matchzy_ffw_enabled).toBe(1);
    expect(config.cvars.matchzy_ffw_time).toBe(240);
  });
});
