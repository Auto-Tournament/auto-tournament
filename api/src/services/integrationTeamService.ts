/**
 * The teams API for integrators (routes/integrationTeams.ts): an event
 * website pushes its teams into Auto Tournament by its own ids.
 *
 * An upsert is idempotent. The integrator's `externalId` (unique per source,
 * see services/teamExternalIds) finds the team; the same input twice changes
 * nothing (`unchanged`, no write); a new player list replaces the old one.
 * Writes go through `teamService`, the same path the admin UI takes, so the
 * players table, `team_members` and avatars follow as usual.
 *
 * Roster rules:
 * - a roster change for a team that is playing (a match of it `loaded` or
 *   `live`) is refused with 409 `team_in_live_match`: the server already
 *   has the roster, and changing it here would not reach the server. An
 *   admin can still change a live match's roster (Ready Up servers: the
 *   roster editor, `match.update`), which the integrator should ask for;
 *   a name / tag change is let through;
 * - a roster change for a team in a tournament that has started applies to
 *   its next matches, and says so in `warnings`;
 * - a player on another team of the same tournament is allowed, with a
 *   warning (the admin UI does the same; it dead-ends that player's veto).
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { slugify } from '../utils/slug';
import type { Player, TeamResponse } from '../types/team.types';
import { teamService } from './teamService';
import { linkExternalId, teamIdForExternalId } from './teamExternalIds';
import { IntegrationTeamError, type IntegrationTeamInput } from './integrationTeamInput';

import {
  describeDuplicateMemberships,
  findDuplicateTournamentMemberships,
} from '../utils/duplicateTeamMembership';

export { IntegrationTeamError, parseTeamInput, isValidSteam64, MAX_BATCH, MAX_PLAYERS } from './integrationTeamInput';
export type { IntegrationTeamInput } from './integrationTeamInput';

export interface IntegrationTeamView {
  id: string;
  externalId: string;
  source: string;
  name: string;
  tag: string | null;
  players: Array<{ steamId: string; name: string }>;
  createdAt: number;
  updatedAt: number;
}

export function teamView(team: TeamResponse, source: string, externalId: string): IntegrationTeamView {
  return {
    id: team.id,
    externalId,
    source,
    name: team.name,
    tag: team.tag ?? null,
    players: (team.players ?? []).map((p) => ({ steamId: p.steamId, name: p.name })),
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

export interface UpsertResult {
  externalId: string;
  id: string;
  result: 'created' | 'updated' | 'unchanged';
  team: IntegrationTeamView;
  warnings: string[];
}

const rosterKey = (players: Array<{ steamId: string; name?: string }>): string =>
  JSON.stringify([...players].map((p) => [p.steamId, p.name ?? '']).sort((a, b) => a[0].localeCompare(b[0])));
const steamIdKey = (players: Array<{ steamId: string }>): string =>
  JSON.stringify(players.map((p) => p.steamId).sort());

/** A free team id from the name: `ninjas-in-pyjamas`, then `-2`, `-3`, ... */
async function freeTeamId(name: string): Promise<string> {
  const base = (slugify(name) || 'team').slice(0, 48);
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await teamService.getTeamById(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function liveMatchesOf(teamId: string): Promise<Array<{ slug: string; status: string }>> {
  return db.queryAsync<{ slug: string; status: string }>(
    `SELECT slug, status FROM matches WHERE (team1_id = ? OR team2_id = ?) AND status IN ('loaded', 'live') ORDER BY id`,
    [teamId, teamId]
  );
}

async function rosterWarnings(teamId: string, players: Player[], rosterChanged: boolean): Promise<string[]> {
  const warnings: string[] = [];
  const tournaments = await db.queryAsync<{ id: number; name: string; status: string; team_ids: string | null }>(
    'SELECT id, name, status, team_ids FROM tournament'
  );
  for (const t of tournaments) {
    let ids: unknown;
    try {
      ids = JSON.parse(t.team_ids ?? '[]');
    } catch {
      ids = [];
    }
    if (!Array.isArray(ids) || !ids.includes(teamId)) continue;
    if (rosterChanged && t.status === 'in_progress') {
      warnings.push(
        `Tournament '${t.name}' has started: the new roster applies to this team's matches that are not loaded on a server yet.`
      );
    }
    const duplicates = await findDuplicateTournamentMemberships(t.id, teamId, players);
    warnings.push(...describeDuplicateMemberships(duplicates));
  }
  return warnings;
}

export async function upsertIntegrationTeam(source: string, input: IntegrationTeamInput): Promise<UpsertResult> {
  const existingId = await teamIdForExternalId(source, input.externalId);
  const existing = existingId ? await teamService.getTeamById(existingId) : null;

  if (!existing) {
    const id = await freeTeamId(input.name);
    const { team, warnings } = await teamService.createTeamWithWarnings({
      id,
      name: input.name,
      tag: input.tag ?? undefined,
      players: input.players.map((p) => ({ steamId: p.steamId, name: p.name })),
    });
    await linkExternalId(source, input.externalId, team.id);
    log.info(`[Integrations] ${source}: team ${input.externalId} created as ${team.id}`);
    return {
      externalId: input.externalId,
      id: team.id,
      result: 'created',
      team: teamView(team, source, input.externalId),
      warnings: [...warnings, ...(await rosterWarnings(team.id, team.players, false))],
    };
  }

  const sameName = existing.name === input.name && (existing.tag || null) === input.tag;
  const sameRoster = rosterKey(existing.players ?? []) === rosterKey(input.players);
  if (sameName && sameRoster) {
    return {
      externalId: input.externalId,
      id: existing.id,
      result: 'unchanged',
      team: teamView(existing, source, input.externalId),
      warnings: [],
    };
  }

  const membersChanged = steamIdKey(existing.players ?? []) !== steamIdKey(input.players);
  if (membersChanged) {
    const live = await liveMatchesOf(existing.id);
    if (live.length > 0) {
      throw new IntegrationTeamError(
        'team_in_live_match',
        409,
        `Team '${existing.name}' is playing (${live
          .map((m) => `${m.slug}: ${m.status}`)
          .join(', ')}): its players cannot be changed through the API until the match is over. ` +
          'Ask a tournament admin to change the roster of the running match (for a Ready Up server, the roster editor on the match page updates the server).',
        { matches: live }
      );
    }
  }

  // Keep what the platform already knows about players who stay (avatar, rating).
  const known = new Map((existing.players ?? []).map((p) => [p.steamId, p]));
  const players: Player[] = input.players.map((p) => ({ ...(known.get(p.steamId) ?? {}), steamId: p.steamId, name: p.name }));
  const { team, warnings } = await teamService.updateTeamWithWarnings(existing.id, {
    name: input.name,
    tag: input.tag ?? '',
    ...(sameRoster ? {} : { players }),
  });
  log.info(`[Integrations] ${source}: team ${input.externalId} (${team.id}) updated`);
  return {
    externalId: input.externalId,
    id: team.id,
    result: 'updated',
    team: teamView(team, source, input.externalId),
    warnings: [...warnings, ...(await rosterWarnings(team.id, team.players, membersChanged))],
  };
}

export async function getIntegrationTeam(source: string, externalId: string): Promise<IntegrationTeamView | null> {
  const id = await teamIdForExternalId(source, externalId);
  if (!id) return null;
  const team = await teamService.getTeamById(id);
  return team ? teamView(team, source, externalId) : null;
}

