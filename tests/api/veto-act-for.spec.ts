import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * An admin acts for a team in the veto (`actAs`): their turn, their action.
 * Nobody else may.
 *
 * @tag api
 * @tag veto
 */

test(
  'an admin bans for the team whose turn it is; a player cannot act for a team',
  {
    tag: ['@api'],
  },
  async ({ request, playwright }) => {
    await signInViaRequest(request);
    const setup = await setupTournament(request, { teamCount: 2, prefix: 'act-for' });
    expect(setup).toBeTruthy();
    const slug = (await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id))
      ?.slug as string;
    expect(slug).toBeTruthy();

    const state = (
      await (await request.get(`/api/veto/${slug}`, { headers: getAuthHeader() })).json()
    ).veto as { currentTurn?: string; availableMaps?: string[] } | null;
    const turn = (state?.currentTurn ?? 'team1') as 'team1' | 'team2';
    const map = state?.availableMaps?.[0] ?? 'de_mirage';

    // A player (not on either team) may not act for one.
    const player = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      expect(
        await signInAsPlayerViaRequest(
          player,
          `7656119805${String(Date.now()).slice(-7)}`,
          'Not Admin'
        )
      ).toBe(true);
      const refused = await player.post(`/api/veto/${slug}/action`, {
        data: { mapName: map, actAs: turn },
      });
      expect(refused.status()).toBe(403);
    } finally {
      await player.dispose();
    }

    // The other team's turn is refused even for an admin.
    const other = turn === 'team1' ? 'team2' : 'team1';
    const wrongTurn = await request.post(`/api/veto/${slug}/action`, {
      headers: getAuthHeader(),
      data: { mapName: map, actAs: other },
    });
    expect(wrongTurn.status()).toBe(403);

    const done = await request.post(`/api/veto/${slug}/action`, {
      headers: getAuthHeader(),
      data: { mapName: map, actAs: turn },
    });
    expect(done.ok(), await done.text()).toBe(true);
    const after = (
      await (await request.get(`/api/veto/${slug}`, { headers: getAuthHeader() })).json()
    ).veto as { bannedMaps?: string[]; pickedMaps?: Array<{ mapName: string }> };
    const touched = [
      ...(after.bannedMaps ?? []),
      ...(after.pickedMaps ?? []).map((p) => p.mapName),
    ];
    expect(touched).toContain(map);
  }
);
