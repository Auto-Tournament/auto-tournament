import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * Site-wide accessibility sweep.
 *
 * Runs axe against every main page as a signed-in admin, which is the only way
 * to reach most of MAT — a crawler without a session sees the login page and
 * nothing else.
 *
 * The whole app currently passes WCAG 2.1 A and AA with one exception, noted
 * below. Keeping this green is cheap; the value is catching the day a new page
 * ships with unlabelled controls or unreadable text.
 *
 * @tag ui
 * @tag a11y
 */

/** Signed-in pages worth sweeping. */
const PAGES = [
  '/',
  '/servers',
  '/teams',
  '/players',
  '/settings',
  '/tournament/1/leaderboard',
  '/player',
];

/**
 * `aria-hidden-focus` fires transiently on the admin pages: MUI marks the app
 * root `aria-hidden` while a modal is mounted, and axe catches the moment
 * before focus is trapped. It is not a page-authoring mistake and is not fixed
 * by anything in this repo, so failing the suite on it would only train people
 * to ignore the sweep. Tracked separately rather than silently dropped.
 */
const KNOWN_TRANSIENT_RULES = ['aria-hidden-focus'];

test('every main page passes WCAG 2.1 A and AA', { tag: ['@ui', '@a11y'] }, async ({
  page,
  request,
}) => {
  test.setTimeout(300000);

  await ensureSignedIn(page);
  await signInViaRequest(request);

  // Populate the pages that are empty-state-only otherwise.
  await setupTournament(request, {
    type: 'single_elimination',
    format: 'bo1',
    maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
    teamCount: 2,
    serverCount: 1,
    prefix: 'a11y',
  });

  const failures: string[] = [];

  for (const path of PAGES) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // Let the SPA settle; axe on a half-rendered page reports noise.
    await page.waitForTimeout(2000);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(KNOWN_TRANSIENT_RULES)
      .analyze();

    for (const violation of results.violations) {
      failures.push(
        `${path} — ${violation.id} (${violation.impact}): ${violation.help} ` +
          `[${violation.nodes.length} node(s)] e.g. ${violation.nodes[0]?.html?.slice(0, 120)}`
      );
    }
  }

  expect(failures, `accessibility violations:\n${failures.join('\n')}`).toEqual([]);
});
