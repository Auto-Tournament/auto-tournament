import { test, expect } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { createTournament } from '../helpers/tournaments';
import { createTestTeams } from '../helpers/teams';

/**
 * Tournament "event page" settings: the organizer-written content behind the
 * public Overview tab (description, location, rules, rulebookUrl, prizes,
 * schedule).
 *
 * These are plain optional fields on `tournament.settings`, validated
 * server-side, and returned by the public leaderboard endpoint the Overview
 * page reads (no admin auth required for that GET).
 *
 * @tag api
 * @tag tournament
 * @tag public
 */

const EVENT_PAGE_SETTINGS = {
  description: 'The spring LAN main event: eight teams, double elimination.',
  location: 'On site, Trondheim',
  rules: [
    'Be connected and ready 10 minutes after your match is called.',
    'Two tactical pauses per team per map, 60 seconds each.',
  ],
  rulebookUrl: 'https://example.com/rulebook',
  prizes: [
    { place: '1st', prize: '$500' },
    { place: '2nd', prize: '$200' },
  ],
  schedule: [
    { at: '2026-04-05T14:00:00.000Z', label: 'Quarterfinals' },
    { at: '2026-04-06T18:00:00.000Z', label: 'Grand final, on stage' },
  ],
};

test.describe('Tournament event page settings API', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
  });

  test(
    'saves event page settings on create and returns them from GET /api/tournament',
    { tag: ['@api', '@tournament'] },
    async ({ request }) => {
      const teams = await createTestTeams(request, 'evtpage-create');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const tournament = await createTournament(request, {
        name: `Event Page Create ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [team1.id, team2.id],
        settings: EVENT_PAGE_SETTINGS,
      });
      expect(tournament).toBeTruthy();

      const response = await request.get('/api/tournament', { headers: getAuthHeader() });
      expect(response.ok()).toBe(true);
      const data = await response.json();

      expect(data.tournament.settings.description).toBe(EVENT_PAGE_SETTINGS.description);
      expect(data.tournament.settings.location).toBe(EVENT_PAGE_SETTINGS.location);
      expect(data.tournament.settings.rules).toEqual(EVENT_PAGE_SETTINGS.rules);
      expect(data.tournament.settings.rulebookUrl).toBe(EVENT_PAGE_SETTINGS.rulebookUrl);
      expect(data.tournament.settings.prizes).toEqual(EVENT_PAGE_SETTINGS.prizes);
      expect(data.tournament.settings.schedule).toEqual(EVENT_PAGE_SETTINGS.schedule);
    }
  );

  test(
    'PUT merges event page settings without dropping other settings',
    { tag: ['@api', '@tournament'] },
    async ({ request }) => {
      const teams = await createTestTeams(request, 'evtpage-put');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const tournament = await createTournament(request, {
        name: `Event Page Put ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [team1.id, team2.id],
        settings: { thirdPlaceMatch: true },
      });
      expect(tournament).toBeTruthy();

      const putResponse = await request.put('/api/tournament', {
        headers: getAuthHeader(),
        data: { settings: { description: EVENT_PAGE_SETTINGS.description } },
      });
      expect(putResponse.ok()).toBe(true);
      const putData = await putResponse.json();
      expect(putData.tournament.settings.description).toBe(EVENT_PAGE_SETTINGS.description);
      // The unrelated setting from create survives the merge.
      expect(putData.tournament.settings.thirdPlaceMatch).toBe(true);
    }
  );

  test(
    'public leaderboard endpoint (no auth) returns event page settings and liveMatchCount',
    { tag: ['@api', '@tournament', '@public'] },
    async ({ request }) => {
      const teams = await createTestTeams(request, 'evtpage-public');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const tournament = await createTournament(request, {
        name: `Event Page Public ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [team1.id, team2.id],
        settings: EVENT_PAGE_SETTINGS,
      });
      expect(tournament).toBeTruthy();

      // No Authorization header: this must work for anonymous visitors.
      const response = await request.get(`/api/tournament/${tournament!.id}/leaderboard`);
      expect(response.ok()).toBe(true);
      const data = await response.json();

      expect(data.tournament.settings.description).toBe(EVENT_PAGE_SETTINGS.description);
      expect(data.tournament.settings.rules).toEqual(EVENT_PAGE_SETTINGS.rules);
      expect(data.tournament.settings.prizes).toEqual(EVENT_PAGE_SETTINGS.prizes);
      expect(data.tournament.settings.schedule).toEqual(EVENT_PAGE_SETTINGS.schedule);
      expect(typeof data.liveMatchCount).toBe('number');
    }
  );

  test(
    'rejects a description over 4000 characters',
    { tag: ['@api', '@tournament'] },
    async ({ request }) => {
      const teams = await createTestTeams(request, 'evtpage-desc');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const response = await request.post('/api/tournament', {
        headers: getAuthHeader(),
        data: {
          name: `Event Page Bad Desc ${Date.now()}`,
          type: 'single_elimination',
          format: 'bo1',
          maps: ['de_mirage', 'de_inferno'],
          teamIds: [team1.id, team2.id],
          settings: { description: 'x'.repeat(4001) },
        },
      });
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('description');
    }
  );

  test(
    'rejects more than 20 rules',
    { tag: ['@api', '@tournament'] },
    async ({ request }) => {
      const teams = await createTestTeams(request, 'evtpage-rules');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const response = await request.post('/api/tournament', {
        headers: getAuthHeader(),
        data: {
          name: `Event Page Bad Rules ${Date.now()}`,
          type: 'single_elimination',
          format: 'bo1',
          maps: ['de_mirage', 'de_inferno'],
          teamIds: [team1.id, team2.id],
          settings: { rules: Array.from({ length: 21 }, (_, i) => `Rule ${i}`) },
        },
      });
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('rules');
    }
  );

  test(
    'rejects more than 5 prizes',
    { tag: ['@api', '@tournament'] },
    async ({ request }) => {
      const teams = await createTestTeams(request, 'evtpage-prizes');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const response = await request.post('/api/tournament', {
        headers: getAuthHeader(),
        data: {
          name: `Event Page Bad Prizes ${Date.now()}`,
          type: 'single_elimination',
          format: 'bo1',
          maps: ['de_mirage', 'de_inferno'],
          teamIds: [team1.id, team2.id],
          settings: {
            prizes: Array.from({ length: 6 }, (_, i) => ({ place: `${i + 1}th`, prize: 'x' })),
          },
        },
      });
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('prizes');
    }
  );

  test(
    'rejects a non-https rulebookUrl',
    { tag: ['@api', '@tournament'] },
    async ({ request }) => {
      const teams = await createTestTeams(request, 'evtpage-url');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const response = await request.post('/api/tournament', {
        headers: getAuthHeader(),
        data: {
          name: `Event Page Bad URL ${Date.now()}`,
          type: 'single_elimination',
          format: 'bo1',
          maps: ['de_mirage', 'de_inferno'],
          teamIds: [team1.id, team2.id],
          settings: { rulebookUrl: 'http://example.com/rulebook' },
        },
      });
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('rulebookUrl');
    }
  );
});
