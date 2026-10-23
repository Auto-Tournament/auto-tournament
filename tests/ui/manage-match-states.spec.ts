import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { sendReadyUpEvents, series } from '../helpers/readyUp';
import { createPendingServer } from '../helpers/fleet';

/**
 * The admin match page's state line and its dialogs (the MatchStates and
 * ActionDialogs boards): during the veto it says whose turn it is and an
 * admin can ban for that team; once the series is over it says who won,
 * and a map's result is corrected with a reason.
 *
 * @tag ui
 * @tag manage
 */

test(
  'veto turn, act for a team, then correct a finished map',
  { tag: ['@ui', '@manage'] },
  async ({ page, request }) => {
    test.setTimeout(120_000);
    await ensureSignedIn(page);
    await signInViaRequest(request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo3',
      teamCount: 2,
      serverCount: 1,
      prefix: 'manage-states',
    });
    expect(setup).toBeTruthy();
    const [team1, team2] = setup!.teams;
    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();
    const slug = match!.slug;
    const url = `/manage/tournaments/${setup!.tournament.id}/matches/${slug}`;

    // Veto: whose turn, and an admin bans for them.
    await request.post('/api/test/match-state', {
      data: { slug, status: 'pending', serverId: null },
    });
    await page.goto(url);
    const state = page.getByTestId('manage-state');
    await expect(state).toHaveAttribute('data-state', 'Veto', { timeout: 15_000 });
    await expect(state).toContainText('turn to ban');
    await page.getByTestId('manage-state-act-for').click();
    const dialog = page.getByTestId('manage-act-for');
    await dialog.locator('button[aria-pressed="false"]:enabled').first().click();
    await page.getByTestId('manage-act-for-run').click();
    await expect(state).toContainText('Banned:', { timeout: 10_000 });

    // A finished series: who won, and map 1 corrected with a reason.
    await request.post('/api/test/match-state', {
      data: { slug, status: 'live', serverId: setup!.servers[0].id },
    });
    await sendReadyUpEvents(
      request,
      slug,
      series(
        [
          [13, 6],
          [13, 9],
        ],
        { winner: 'team1' }
      )
    );
    await page.reload();
    await expect(state).toHaveAttribute('data-state', 'Finished', { timeout: 15_000 });
    await expect(state).toContainText(`${team1.name} won 2–0`);

    await page.getByTestId('manage-correct-map-1').click();
    const correct = page.getByTestId('manage-correct-map');
    await correct.getByTestId('manage-correct-map-t2').fill('8');
    await expect(page.getByTestId('manage-correct-map-run')).toBeDisabled();
    await correct.getByTestId('manage-correct-map-reason').fill('scoreboard typo');
    await page.getByTestId('manage-correct-map-run').click();
    await expect(page.getByTestId('manage-maps')).toContainText('13 – 8', { timeout: 10_000 });
  }
);

test(
  'a live map stuck in CS2’s warmup shows the mismatch; players show ping and a fresh join',
  { tag: ['@ui', '@manage'] },
  async ({ page, request }) => {
    test.setTimeout(120_000);
    await ensureSignedIn(page);
    await signInViaRequest(request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      teamCount: 2,
      serverCount: 1,
      prefix: 'manage-disagree',
    });
    expect(setup).toBeTruthy();
    const [team1, team2] = setup!.teams;
    const match = await findMatchByTeams(request, team1.id, team2.id);
    const slug = match!.slug;
    await request.post('/api/test/match-state', {
      data: { slug, status: 'live', serverId: setup!.servers[0].id },
    });
    const steamId = team1.players[0].steamId;
    // Ready Up's state: the map is live, CS2 says warmup; one player on with a ping.
    const team = (name: string, players: Record<string, unknown>) => ({
      name,
      side: 'ct',
      score: 0,
      score_ct: 0,
      score_t: 0,
      players,
    });
    const fleet = await createPendingServer(request, `disagree-${Date.now()}`);
    const snap = await request.post('/api/test/fleet/snapshot', {
      data: {
        serverId: fleet.serverId,
        state: {
          match_id: slug,
          epoch: 1000, // above any epoch other specs left for this slug
          server_id: fleet.serverId,
          config_rev: 1,
          live_rev: 1,
          phase: 'live',
          series: {
            num_maps: 1,
            current_map: 1,
            score: { team1: 0, team2: 0 },
            maps: { '1': { name: 'de_mirage', status: 'live', score: { team1: 0, team2: 0 } } },
          },
          teams: {
            team1: team(team1.name, {
              [steamId]: {
                name: team1.players[0].name,
                connected: true,
                ready: true,
                ping: 23,
                connected_at: Date.now() - 30_000,
              },
            }),
            team2: team(team2.name, {}),
          },
          round: { number: 1 },
          game: { warmup: true },
        },
      },
    });
    expect(snap.ok(), await snap.text()).toBe(true);
    await page.goto(`/manage/tournaments/${setup!.tournament.id}/matches/${slug}`);
    const state = page.getByTestId('manage-state');
    await expect(state).toHaveAttribute('data-state', 'Game and Ready Up disagree', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('manage-state-end-warmup')).toBeVisible();
    const row = page.getByTestId('manage-team-team1');
    await expect(row).toContainText('23 ms');
    await expect(row).toContainText(/Joined \d+ s ago/);
  }
);
