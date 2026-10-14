import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { sendReadyUpEvents, series } from '../helpers/readyUp';

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
    await dialog
      .getByRole('button')
      .filter({ hasNotText: /choose|ban /i })
      .first()
      .click();
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
