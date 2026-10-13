import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * The match room (`/match/:slug`) of a team's current match: where its
 * players do the veto, connect and report the result.
 */
export async function matchRoomPath(page: Page, teamId: string): Promise<string> {
  const res = await page.request.get(`/api/team/${encodeURIComponent(teamId)}/match`);
  expect(res.ok(), `the team's match: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { hasMatch?: boolean; match?: { slug?: string } };
  expect(body.match?.slug, `team ${teamId} has a current match`).toBeTruthy();
  return `/match/${encodeURIComponent(body.match!.slug!)}`;
}

/** Opens the match room of a team's current match. */
export async function openMatchRoom(page: Page, teamId: string): Promise<void> {
  await page.goto(await matchRoomPath(page, teamId));
}

/**
 * Opens the signed-in (or impersonated) player's own match room, the way the
 * nav bar's match button does: `/api/players/me/match-now` says where it is.
 */
export async function openOwnMatchRoom(page: Page): Promise<string> {
  const res = await page.request.get('/api/players/me/match-now');
  expect(res.ok(), `match-now: ${await res.text()}`).toBe(true);
  const path = ((await res.json()) as { path: string | null }).path;
  expect(path, 'the player has a match room').toMatch(/^\/match\//);
  await page.goto(path!, { waitUntil: 'domcontentloaded' });
  return path!;
}
