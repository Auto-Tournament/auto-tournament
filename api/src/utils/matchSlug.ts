/**
 * Bracket match slugs and the tournament they belong to.
 *
 * Generators name matches by their place in the bracket: `r1m1`, `lb-r2m1`,
 * `gf`, `swiss-r3m2`, `shuffle-r1-m4`, and code reads meaning from those
 * names (the grand final, the losers bracket). Slugs are unique across the
 * database, and since a finished tournament can be archived and the next
 * one started (services/currentTournament.ts), the next tournament's matches
 * carry its id: `t2-r1m1`, `t2-gf`. Tournament 1 keeps bare slugs, so
 * existing data and links stay as they are.
 *
 * Anything that reads a slug's meaning goes through `bareSlug`.
 */

import { LEGACY_TOURNAMENT_ID } from './tournamentRow';

const PREFIX = /^t\d+-/;

/** `''` for tournament 1, `t<id>-` for any later one. */
export function tournamentSlugPrefix(tournamentId: number | null | undefined): string {
  return !tournamentId || tournamentId === LEGACY_TOURNAMENT_ID ? '' : `t${tournamentId}-`;
}

/** The slug without its tournament prefix: `t2-lb-r1m1` → `lb-r1m1`. */
export function bareSlug(slug: string): string {
  return slug.replace(PREFIX, '');
}

/** The grand final (`gf`, `t2-gf`). */
export function isGrandFinalSlug(slug: string): boolean {
  return bareSlug(slug) === 'gf';
}

/** A losers-bracket match (`lb-…`, `t2-lb-…`). */
export function isLosersBracketSlug(slug: string): boolean {
  return bareSlug(slug).startsWith('lb-');
}

/**
 * A shuffle round's team id: `shuffle-r1-m2-team1` in tournament 1,
 * `shuffle-t2-r1-m2-team1` after it. Teams are global rows, so a later
 * tournament's must not overwrite (or, on reset, delete) an archived one's.
 */
export function shuffleTeamId(tournamentId: number | null | undefined, round: number, match: number, side: 1 | 2): string {
  const prefix = tournamentSlugPrefix(tournamentId);
  return `shuffle-${prefix}r${round}-m${match}-team${side}`;
}

/** LIKE pattern for one tournament's shuffle teams (`shuffle-r%`, `shuffle-t2-%`). */
export function shuffleTeamLike(tournamentId: number | null | undefined): string {
  const prefix = tournamentSlugPrefix(tournamentId);
  return prefix ? `shuffle-${prefix}%` : 'shuffle-r%';
}
