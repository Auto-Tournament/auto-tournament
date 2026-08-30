/**
 * Detecting a player who sits on two teams of the same tournament.
 *
 * This state is reachable and it dead-ends the veto: `resolveViewerTeamForMatch`
 * returns `'both'`, the player cannot act for either side, and the only way out
 * is an admin removing them from one team. Nothing surfaced it until the veto
 * refused to move.
 *
 * Team rosters are admin-only, so this warns rather than blocks — an admin may
 * have a reason, and taking the decision away from them was explicitly not
 * wanted. The point is that they find out when they do it, not during a veto.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import type { Player } from '../types/team.types';

export interface DuplicateMembership {
  steamId: string;
  name: string;
  /** Other teams in this tournament that also list the player. */
  otherTeams: Array<{ id: string; name: string }>;
}

function parseRoster(players: string | null | undefined): Player[] {
  if (!players) return [];
  try {
    const parsed = JSON.parse(players);
    return Array.isArray(parsed) ? (parsed as Player[]) : [];
  } catch {
    return [];
  }
}

/**
 * Which players on `teamId` also appear on another team of the current
 * tournament.
 *
 * Returns an empty list when there is no tournament, when this team is not in
 * it, or when nothing overlaps — a team outside the tournament cannot create
 * the veto conflict this guards against.
 */
export async function findDuplicateTournamentMemberships(
  teamId: string,
  players: Array<{ steamId: string; name?: string }>
): Promise<DuplicateMembership[]> {
  if (players.length === 0) return [];

  try {
    const tournament = await db.queryOneAsync<{ team_ids: string | null }>(
      'SELECT team_ids FROM tournament WHERE id = 1'
    );
    if (!tournament?.team_ids) return [];

    const teamIds: string[] = JSON.parse(tournament.team_ids);
    if (!Array.isArray(teamIds) || !teamIds.includes(teamId)) return [];

    const otherIds = teamIds.filter((id) => id !== teamId);
    if (otherIds.length === 0) return [];

    const rows = await db.queryAsync<{ id: string; name: string; players: string | null }>(
      `SELECT id, name, players FROM teams WHERE id IN (${otherIds.map(() => '?').join(', ')})`,
      otherIds
    );

    const byPlayer = new Map<string, DuplicateMembership>();

    for (const row of rows) {
      const roster = new Set(parseRoster(row.players).map((p) => p.steamId));
      for (const player of players) {
        if (!roster.has(player.steamId)) continue;

        const existing = byPlayer.get(player.steamId);
        const entry = { id: row.id, name: row.name };
        if (existing) {
          existing.otherTeams.push(entry);
        } else {
          byPlayer.set(player.steamId, {
            steamId: player.steamId,
            name: player.name || player.steamId,
            otherTeams: [entry],
          });
        }
      }
    }

    return [...byPlayer.values()];
  } catch (error) {
    // A warning is a nicety; never fail the save because it could not be built.
    log.warn('Failed to check for duplicate tournament team memberships', { teamId, error });
    return [];
  }
}

/** One human-readable line per affected player, for the admin UI. */
export function describeDuplicateMemberships(duplicates: DuplicateMembership[]): string[] {
  return duplicates.map(
    (d) =>
      `${d.name} is also on ${d.otherTeams.map((t) => t.name).join(', ')} in this tournament. ` +
      `A player on two teams cannot pick maps in the veto for either side.`
  );
}
