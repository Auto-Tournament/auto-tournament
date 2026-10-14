import type { APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';

/**
 * A bracket slug of the current tournament: "r1m1" for tournament 1 (the
 * legacy form), "t<id>-r1m1" for the others. Tournament ids are never given
 * out again once played, so a spec cannot count on being tournament 1.
 */
export async function currentSlug(request: APIRequestContext, key: string): Promise<string> {
  const res = await request.get('/api/tournament', { headers: getAuthHeader() });
  const id = ((await res.json()) as { tournament?: { id?: number } }).tournament?.id;
  return !id || id === 1 ? key : `t${id}-${key}`;
}

/**
 * Keeps the current tournament's matches out of GET /api/matches (it lists
 * every match, finished tournaments' included).
 */
export async function currentTournamentMatches<T extends { slug: string }>(
  request: APIRequestContext,
  matches: T[]
): Promise<T[]> {
  const prefix = await currentSlug(request, '');
  return matches.filter((m) => (prefix ? m.slug.startsWith(prefix) : !/^t\d+-/.test(m.slug)));
}

/** The current (featured) tournament's id, for routes that take it (/api/tournament/:id/...). */
export async function currentTournamentId(request: APIRequestContext): Promise<number> {
  const res = await request.get('/api/tournament', { headers: getAuthHeader() });
  const id = ((await res.json()) as { tournament?: { id?: number } }).tournament?.id;
  if (!id) throw new Error('no current tournament');
  return id;
}
