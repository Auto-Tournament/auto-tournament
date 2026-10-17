/**
 * The matchmaking veto is a vote (5v5 matchmaking has no captains). On each step every
 * player of the side whose turn it is votes for a map (or a side) and may change the vote
 * while the turn runs. The turn lasts MM_VOTE_SECONDS, or ends as soon as the whole side
 * has voted; then the choice with the most votes is taken, a tie is drawn among the tied
 * choices, and no votes at all draws from every option. The votes live in the veto state
 * (`votes`: steam id → choice) until the step is taken.
 *
 * Tournament vetoes are not votes: a captain clicks (routes.ts), on the Match rules' clock.
 */
import { randomInt } from 'crypto';
import { db } from '../../../config/database';
import type { DbMatchRow } from '../../../types/database.types';
import { describeMatch, describedPlayers } from '../../../utils/matchIntegration';

/** Seconds per step of a matchmaking veto vote. */
export const MM_VOTE_SECONDS = 10;

/** A matchmaking match: its veto is a vote. */
export function isVoteVeto(match: Pick<DbMatchRow, 'source' | 'tournament_id'>): boolean {
  return match.source === 'matchmaking' && match.tournament_id == null;
}

/**
 * The choice the votes decide among `options`: the most votes, a tie drawn at random
 * among the tied, no votes drawn from all. `count` is the winner's votes.
 */
export function tallyVotes(
  votes: Record<string, string> | undefined,
  options: string[],
  pick: (n: number) => number = randomInt
): { choice: string; count: number } {
  const counts = new Map<string, number>();
  for (const choice of Object.values(votes ?? {})) {
    if (options.includes(choice)) counts.set(choice, (counts.get(choice) ?? 0) + 1);
  }
  const most = Math.max(0, ...counts.values());
  const top = most === 0 ? options : options.filter((o) => counts.get(o) === most);
  return { choice: top[pick(top.length)], count: most };
}

export interface Voter {
  id: string;
  name: string;
  avatarUrl: string | null;
  team: 'team1' | 'team2';
}

/** Steam ids of the players of each side, from the match config. */
export function sidesOf(
  match: Pick<DbMatchRow, 'config' | 'game'>
): Record<'team1' | 'team2', string[]> {
  const description = describeMatch(match);
  const ids = (team: typeof description.team1) =>
    describedPlayers(team)
      .map((p) => p.steamid)
      .filter((id): id is string => Boolean(id));
  return { team1: ids(description.team1), team2: ids(description.team2) };
}

/** Everyone who may vote, with name and picture, for the board's avatars. */
export async function votersOf(match: Pick<DbMatchRow, 'config' | 'game'>): Promise<Voter[]> {
  const sides = sidesOf(match);
  const all = [...sides.team1, ...sides.team2];
  if (all.length === 0) return [];
  const rows = await db.queryAsync<{ id: string; name: string | null; avatar_url: string | null }>(
    `SELECT id, name, avatar_url FROM players WHERE id IN (${all.map(() => '?').join(', ')})`,
    all
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (['team1', 'team2'] as const).flatMap((team) =>
    sides[team].map((id) => ({
      id,
      name: byId.get(id)?.name || id,
      avatarUrl: byId.get(id)?.avatar_url ?? null,
      team,
    }))
  );
}
