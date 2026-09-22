/**
 * Core access to a match's integration-owned config.
 *
 * `matches.config` is a blob owned by the match's game integration (for CS2,
 * the MatchZy match config). The core does not build it and does not read its
 * fields: it asks the integration to build it (`buildMatchConfigFor`) and to
 * describe it (`describeMatch`). Where an API response still forwards the
 * blob to the client as-is, `parseStoredMatchConfig` only turns the stored
 * JSON text back into a value.
 */

import { db } from '../config/database';
import { integrationForMatch } from '../integrations/registry';
import {
  DEFAULT_GAME,
  type GameId,
  type IntegrationTournament,
  type MatchContext,
  type MatchDescription,
  type MatchDescriptionTeam,
} from '../integrations/types';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import type { TournamentResponse } from '../types/tournament.types';
import type { NormalizedServerPlayer } from './playerTransform';
import { tournamentRowToResponse } from './tournamentRow';

/** The match (or new bracket slot) a config is built for. */
export interface MatchConfigTarget {
  slug: string;
  /** `matches.id`; omit (0) while the row does not exist yet. */
  id?: number | null;
  game?: GameId | null;
  round: number;
  bracket?: string | null;
  team1Id?: string | null;
  team2Id?: string | null;
}

/** The neutral tournament view an integration gets; `settings` carries the full response for CS2 (see IntegrationTournament). */
export function toIntegrationTournament(tournament: TournamentResponse): IntegrationTournament {
  return {
    id: tournament.id,
    type: tournament.type,
    format: tournament.format,
    settings: tournament,
  };
}

/**
 * Build the integration-owned config for a match through its integration.
 *
 * - `tournament` set and `round >= 1`: a bracket match, built from the
 *   tournament's settings and the participants.
 * - `tournament` null (or `round === 0`): a standalone match. Pass `settings`
 *   (the admin's per-match settings) when creating it, plus
 *   `options.defaultsFrom` for the tournament whose rules fill the gaps;
 *   without settings, the integration returns the config to hand the game
 *   for the stored match.
 */
export async function buildMatchConfigFor(
  target: MatchConfigTarget,
  tournament: TournamentResponse | null,
  settings?: unknown,
  options: { defaultsFrom?: TournamentResponse | null } = {}
): Promise<unknown> {
  const game = target.game || DEFAULT_GAME;
  const standalone = !tournament || target.round === 0;
  return integrationForMatch({ game }).buildMatchConfig({
    slug: target.slug,
    matchId: target.id ?? 0,
    game,
    tournament: standalone ? null : toIntegrationTournament(tournament),
    team1: target.team1Id ? { id: target.team1Id } : null,
    team2: target.team2Id ? { id: target.team2Id } : null,
    round: target.round,
    bracket: target.bracket ?? null,
    ...(settings !== undefined ? { settings } : {}),
    ...(options.defaultsFrom
      ? { defaultsFrom: toIntegrationTournament(options.defaultsFrom) }
      : {}),
  });
}

/** The value persisted to `matches.config`. */
export function serializeMatchConfig(config: unknown): string {
  return JSON.stringify(config);
}

/**
 * The stored config as a value, for responses that forward the blob to the
 * client unchanged. Do not read fields off it; use `describeMatch`.
 * Unreadable JSON gives `{}`.
 */
export function parseStoredMatchConfig(config: string | null | undefined): Record<string, unknown> {
  if (!config) return {};
  try {
    const value: unknown = JSON.parse(config);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Neutral view (series length, maps, rosters) of a match's config, stored JSON or already parsed. */
export function describeMatch(match: { game?: GameId | null; config?: unknown }): MatchDescription {
  return integrationForMatch(match).describeMatch(match.config ?? null);
}

/** Whether a match's config follows its tournament (bracket match) rather than being stored as-is. */
export function isBracketManaged(match: { round?: number | null; tournament_id?: number | null }): boolean {
  return typeof match.round === 'number' && match.round >= 1 && !!match.tournament_id;
}

/**
 * The match's config as it stands now. Bracket matches are rebuilt on demand
 * so rosters and settings follow the latest team and tournament state instead
 * of the snapshot taken when the match was generated; standalone matches (and
 * bracket matches whose tournament is gone) keep their stored config.
 */
export async function currentMatchConfig(match: {
  id?: number | null;
  slug: string;
  game?: GameId | null;
  round: number;
  bracket?: string | null;
  tournament_id?: number | null;
  team1_id?: string | null;
  team2_id?: string | null;
  config?: string | null;
}): Promise<Record<string, unknown>> {
  if (isBracketManaged(match)) {
    const row = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
      match.tournament_id,
    ]);
    if (row) {
      const config = await buildMatchConfigFor(
        {
          slug: match.slug,
          id: match.id,
          game: match.game,
          round: match.round,
          bracket: match.bracket,
          team1Id: match.team1_id,
          team2Id: match.team2_id,
        },
        tournamentRowToResponse(row)
      );
      return (config ?? {}) as Record<string, unknown>;
    }
  }
  return parseStoredMatchConfig(match.config);
}

/** A described roster in the `{ steamid, name, avatar }` shape the API responses use. */
export function describedPlayers(team: MatchDescriptionTeam): NormalizedServerPlayer[] {
  return team.players.map((p) => ({
    steamid: p.account.externalId,
    name: p.name,
    avatar: p.avatar,
  }));
}

/**
 * The `MatchContext` an integration hook gets for a stored match. A bracket
 * match carries its tournament; a standalone match (or one whose tournament
 * is gone) carries null. Pass `tournament` when the caller has already read
 * it, to use that instead.
 */
export async function matchContextFor(
  match: DbMatchRow,
  knownTournament?: TournamentResponse
): Promise<MatchContext> {
  let tournament: IntegrationTournament | null = null;
  if (knownTournament) {
    tournament = toIntegrationTournament(knownTournament);
  } else if (isBracketManaged(match)) {
    const row = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
      match.tournament_id,
    ]);
    if (row) tournament = toIntegrationTournament(tournamentRowToResponse(row));
  }
  return {
    slug: match.slug,
    matchId: match.id,
    game: match.game || DEFAULT_GAME,
    tournament,
    team1: match.team1_id ? { id: match.team1_id } : null,
    team2: match.team2_id ? { id: match.team2_id } : null,
    round: match.round,
    bracket: match.bracket ?? null,
    integrationConfig: parseStoredMatchConfig(match.config),
    resourceId: match.server_id ?? null,
  };
}
