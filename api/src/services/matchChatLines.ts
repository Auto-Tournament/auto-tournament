/**
 * The platform's own lines in a match's chat (drafts 5b/5m): veto steps, the
 * server being ready, players joining, maps going live and their results.
 *
 * A line is stored as `i18n:` plus `{ key, params }`, so every viewer reads
 * it in their own language (the client's `chat.system.<key>`). Map params
 * are map ids; the client shows their display names. Posting never fails the
 * caller: a chat line is a courtesy, not part of the match.
 */

import { log } from '../utils/logger';

export type MatchChatKey =
  | 'vetoStarted'
  | 'vetoBan'
  | 'vetoPick'
  | 'vetoSide'
  | 'vetoDone'
  | 'serverReady'
  | 'playerJoined'
  | 'playerLeft'
  | 'mapLive'
  | 'mapResult'
  | 'seriesWon'
  | 'adminCalled'
  | 'remindAccount'
  | 'remindGame';

export function chatLineBody(key: MatchChatKey, params: Record<string, string | number | boolean | string[]> = {}): string {
  return `i18n:${JSON.stringify({ key, params })}`;
}

/** Post one platform line to `match:<slug>`. */
export async function postMatchChatLine(
  slug: string,
  key: MatchChatKey,
  params: Record<string, string | number | boolean | string[]> = {}
): Promise<void> {
  try {
    const { chatService } = await import('./chatService');
    await chatService.system(`match:${slug}`, chatLineBody(key, params));
  } catch (error) {
    log.debug('Could not post a match chat line', { slug, key, error: (error as Error).message });
  }
}

/** The two team names of a match, for lines that name them. */
export async function matchTeamNames(slug: string): Promise<{ team1: string; team2: string }> {
  try {
    const { db } = await import('../config/database');
    const row = await db.queryOneAsync<{ t1: string | null; t2: string | null }>(
      `SELECT t1.name AS t1, t2.name AS t2 FROM matches m
         LEFT JOIN teams t1 ON t1.id = m.team1_id
         LEFT JOIN teams t2 ON t2.id = m.team2_id
        WHERE m.slug = ?`,
      [slug]
    );
    return { team1: row?.t1 ?? 'Team 1', team2: row?.t2 ?? 'Team 2' };
  } catch {
    return { team1: 'Team 1', team2: 'Team 2' };
  }
}
