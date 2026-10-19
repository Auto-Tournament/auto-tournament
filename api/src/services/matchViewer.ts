/**
 * Which side of a match the signed-in viewer plays for.
 *
 * The team's own roster decides, not the match config: `config` is a snapshot
 * taken when the match was created and goes stale the moment an admin edits
 * the team (someone removed kept seeing the server, someone added could not).
 * The snapshot is only the fallback for a team row with no usable roster.
 * `veto.ts` resolves membership the same way.
 */

import type { Request } from 'express';
import { db } from '../config/database';
import { normalizeConfigPlayers, type NormalizedServerPlayer } from '../utils/playerTransform';
import { describeMatch, describedPlayers } from '../utils/matchIntegration';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import type { GameId } from '../integrations/types';

/** Steam ID this request is treated as (admin impersonation applied), or null. */
export async function viewerSteamId(req: Request): Promise<string | null> {
  const { effectiveSteamId } = await resolveViewerIdentity(req);
  return effectiveSteamId;
}

/** The players of one team: its live roster, else the match's snapshot of it. */
export function teamPlayers(
  rosterJson: string | null | undefined,
  snapshot: NormalizedServerPlayer[]
): NormalizedServerPlayer[] {
  let roster: NormalizedServerPlayer[] = [];
  try {
    roster = normalizeConfigPlayers(rosterJson ? JSON.parse(rosterJson) : []);
  } catch {
    roster = [];
  }
  return roster.length > 0 ? roster : snapshot;
}

/**
 * The id of the viewer's team in this match, or null (signed out, not on
 * either team, or a side with no team row).
 */
export async function viewerTeamIdOfMatch(
  req: Request,
  match: {
    game?: GameId | null;
    config?: string | object | null;
    team1_id: string | null;
    team2_id: string | null;
  }
): Promise<string | null> {
  const steamId = await viewerSteamId(req);
  if (!steamId) return null;
  const description = describeMatch({ game: match.game ?? null, config: match.config ?? null });
  for (const side of ['team1', 'team2'] as const) {
    const teamId = match[`${side}_id`];
    if (!teamId) continue;
    const row = await db.queryOneAsync<{ players: string | null }>(
      'SELECT players FROM teams WHERE id = ?',
      [teamId]
    );
    const players = teamPlayers(row?.players, describedPlayers(description[side]));
    if (players.some((p) => p.steamid === steamId)) return teamId;
  }
  return null;
}
