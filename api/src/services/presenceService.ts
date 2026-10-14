/**
 * What players are doing right now, for anywhere a player is shown (profile,
 * match rosters, chat, friends): on the site or not, searching for a
 * matchmaking game, or playing (a matchmaking, tournament or other match on a
 * server). One source, so every place says the same thing.
 */
import { db } from '../config/database';
import { isPlayerOnline } from './socketService';
import { playerConnectionService } from './playerConnectionService';

export type PresenceActivity =
  | { kind: 'searching'; mode: string }
  | {
      kind: 'playing';
      /** Where the match comes from: matchmaking, a tournament, or neither. */
      source: 'matchmaking' | 'tournament' | 'match';
      matchSlug: string;
      label: string;
    };

export interface Presence {
  online: boolean;
  activity: PresenceActivity | null;
}

/** At most this many players per question. */
export const PRESENCE_MAX_IDS = 100;

/** What each of these players is doing: searching (their party's queue entry) or connected to a match's server. */
export async function activitiesOf(ids: string[]): Promise<Map<string, PresenceActivity>> {
  const out = new Map<string, PresenceActivity>();
  if (ids.length === 0) return out;
  const marks = ids.map(() => '?').join(', ');
  const searching = await db.queryAsync<{ player_id: string; mode: string }>(
    `SELECT m.player_id, q.mode FROM mm_party_members m JOIN mm_queue_entries q ON q.party_id = m.party_id
      WHERE m.player_id IN (${marks})`,
    ids
  );
  for (const r of searching) out.set(r.player_id, { kind: 'searching', mode: r.mode });
  const onServer = await db.queryAsync<{
    slug: string;
    config: string | null;
    source: string | null;
    tournament_id: number | null;
    t1: string | null;
    t2: string | null;
  }>(
    `SELECT m.slug, m.config, m.source, m.tournament_id, t1.name AS t1, t2.name AS t2 FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id LEFT JOIN teams t2 ON t2.id = m.team2_id
      WHERE m.status IN ('loaded', 'live')`,
    []
  );
  for (const match of onServer) {
    const config = match.config ?? '';
    for (const id of ids) {
      if (out.get(id)?.kind === 'playing' || !config.includes(`"${id}"`)) continue;
      // On the roster is not playing: only while they are on the match's server.
      if (playerConnectionService.connectionOf(match.slug, id).state !== 'connected') continue;
      const label = match.t1 && match.t2 ? `${match.t1} vs ${match.t2}` : 'A match';
      out.set(id, {
        kind: 'playing',
        source:
          match.source === 'matchmaking'
            ? 'matchmaking'
            : match.tournament_id !== null
              ? 'tournament'
              : 'match',
        matchSlug: match.slug,
        label,
      });
    }
  }
  return out;
}

/** Presence of each player: online, and what they are doing. */
export async function presenceOf(ids: string[]): Promise<Map<string, Presence>> {
  const unique = [...new Set(ids)].slice(0, PRESENCE_MAX_IDS);
  const doing = await activitiesOf(unique);
  return new Map(
    unique.map((id) => [id, { online: isPlayerOnline(id), activity: doing.get(id) ?? null }])
  );
}
