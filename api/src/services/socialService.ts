/**
 * Friends: requests, friendships, who is online and what they are doing, and
 * finding people to add or invite. A friendship is two rows in `friendships`
 * (one per side); a request is one row in `friend_requests` until it is
 * answered. Every change tells both players (`social:changed`), and a player
 * coming online or leaving tells their friends.
 *
 * What a friend is doing comes from the platform: searching in matchmaking
 * (the party's queue entry) or playing (a live match with them in its config).
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitSocialChanged, isPlayerOnline, onPresence } from './socketService';
import { notificationService } from './notificationService';

export class SocialError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface Person {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface FriendView extends Person {
  online: boolean;
  /** Epoch the friend last left the site; null while online or never seen. */
  lastSeenAt: number | null;
  /** What they are doing on the platform right now, if anything. */
  activity: { kind: 'searching'; mode: string } | { kind: 'playing'; matchSlug: string; label: string } | null;
  since: number;
}

export type Relation = 'self' | 'friend' | 'sent' | 'incoming' | 'none';

/** At most this many friends, and outgoing requests waiting. */
const MAX_FRIENDS = 500;
const MAX_PENDING = 50;

const now = () => Math.floor(Date.now() / 1000);
const requestKey = (fromId: string) => `friend_request:${fromId}`;

interface PersonRow {
  id: string;
  name: string;
  avatar_url: string | null;
}

const person = (r: PersonRow): Person => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url ?? null });

async function playerExists(id: string): Promise<PersonRow | undefined> {
  return db.queryOneAsync<PersonRow>('SELECT id, name, avatar_url FROM players WHERE id = ?', [id]);
}

/** What each of these players is doing: searching (their party's queue entry) or in a live match. */
async function activities(ids: string[]): Promise<Map<string, FriendView['activity']>> {
  const out = new Map<string, FriendView['activity']>();
  if (ids.length === 0) return out;
  const marks = ids.map(() => '?').join(', ');
  const searching = await db.queryAsync<{ player_id: string; mode: string }>(
    `SELECT m.player_id, q.mode FROM mm_party_members m JOIN mm_queue_entries q ON q.party_id = m.party_id
      WHERE m.player_id IN (${marks})`,
    ids
  );
  for (const r of searching) out.set(r.player_id, { kind: 'searching', mode: r.mode });
  const live = await db.queryAsync<{ slug: string; config: string; t1: string | null; t2: string | null }>(
    `SELECT m.slug, m.config, t1.name AS t1, t2.name AS t2 FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id LEFT JOIN teams t2 ON t2.id = m.team2_id
      WHERE m.status = 'live'`,
    []
  );
  for (const match of live) {
    for (const id of ids) {
      if (out.has(id) || !match.config.includes(`"${id}"`)) continue;
      const label = match.t1 && match.t2 ? `${match.t1} vs ${match.t2}` : 'A match';
      out.set(id, { kind: 'playing', matchSlug: match.slug, label });
    }
  }
  return out;
}

async function friendIds(playerId: string): Promise<string[]> {
  return (await db.queryAsync<{ friend_id: string }>('SELECT friend_id FROM friendships WHERE player_id = ?', [playerId])).map(
    (r) => r.friend_id
  );
}

export const socialService = {
  /** Hear presence from the socket layer: friends see a player come and go. */
  start(): void {
    onPresence((playerId, online) => {
      void (async () => {
        try {
          if (!online) await db.runAsync('UPDATE players SET last_seen_at = ? WHERE id = ?', [now(), playerId]);
          const friends = await friendIds(playerId);
          if (friends.length > 0) emitSocialChanged(friends);
        } catch (error) {
          log.debug('[SOCIAL] presence update failed', { error });
        }
      })();
    });
  },

  /** The player's friends (online first), requests to them and from them. */
  async overview(playerId: string): Promise<{ friends: FriendView[]; incoming: Array<Person & { at: number }>; sent: Array<Person & { at: number }> }> {
    const rows = await db.queryAsync<PersonRow & { last_seen_at: number | string | null; created_at: number | string }>(
      `SELECT p.id, p.name, p.avatar_url, p.last_seen_at, f.created_at FROM friendships f
         JOIN players p ON p.id = f.friend_id
        WHERE f.player_id = ? ORDER BY LOWER(p.name)`,
      [playerId]
    );
    const doing = await activities(rows.map((r) => r.id));
    const friends: FriendView[] = rows.map((r) => {
      const online = isPlayerOnline(r.id);
      return {
        ...person(r),
        online,
        lastSeenAt: online || r.last_seen_at === null ? null : Number(r.last_seen_at),
        activity: doing.get(r.id) ?? null,
        since: Number(r.created_at),
      };
    });
    // Playing, then searching, then online, then offline by when they were last here.
    const rank = (f: FriendView) => (f.activity?.kind === 'playing' ? 0 : f.activity ? 1 : f.online ? 2 : 3);
    friends.sort((a, b) => rank(a) - rank(b) || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));
    const incoming = await db.queryAsync<PersonRow & { created_at: number | string }>(
      `SELECT p.id, p.name, p.avatar_url, r.created_at FROM friend_requests r JOIN players p ON p.id = r.from_id
        WHERE r.to_id = ? ORDER BY r.created_at DESC`,
      [playerId]
    );
    const sent = await db.queryAsync<PersonRow & { created_at: number | string }>(
      `SELECT p.id, p.name, p.avatar_url, r.created_at FROM friend_requests r JOIN players p ON p.id = r.to_id
        WHERE r.from_id = ? ORDER BY r.created_at DESC`,
      [playerId]
    );
    return {
      friends,
      incoming: incoming.map((r) => ({ ...person(r), at: Number(r.created_at) })),
      sent: sent.map((r) => ({ ...person(r), at: Number(r.created_at) })),
    };
  },

  async relation(playerId: string, otherId: string): Promise<Relation> {
    if (playerId === otherId) return 'self';
    const friend = await db.queryOneAsync('SELECT 1 FROM friendships WHERE player_id = ? AND friend_id = ?', [playerId, otherId]);
    if (friend) return 'friend';
    const sent = await db.queryOneAsync('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?', [playerId, otherId]);
    if (sent) return 'sent';
    const incoming = await db.queryOneAsync('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?', [otherId, playerId]);
    return incoming ? 'incoming' : 'none';
  },

  /** Ask to be friends. If they already asked you, this accepts. */
  async request(playerId: string, targetId: unknown): Promise<Relation> {
    if (typeof targetId !== 'string' || !/^\d{1,20}$/.test(targetId)) {
      throw new SocialError(400, 'invalid_player', 'That is not a player');
    }
    if (targetId === playerId) throw new SocialError(400, 'self', 'You cannot add yourself');
    const target = await playerExists(targetId);
    if (!target) throw new SocialError(404, 'not_found', 'No player with that id');
    const relation = await this.relation(playerId, targetId);
    if (relation === 'friend' || relation === 'sent') return relation;
    if (relation === 'incoming') {
      await this.accept(playerId, targetId);
      return 'friend';
    }
    const pending = await db.queryOneAsync<{ n: number | string }>('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ?', [playerId]);
    if (Number(pending?.n ?? 0) >= MAX_PENDING) {
      throw new SocialError(409, 'too_many_requests', `You have ${MAX_PENDING} requests waiting; cancel some first`);
    }
    await this.checkRoom(playerId);
    await db.runAsync('INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [
      playerId,
      targetId,
      now(),
    ]);
    const me = await playerExists(playerId);
    await notificationService.notify(
      targetId,
      'friend_request',
      { from: me ? person(me) : { id: playerId, name: playerId, avatarUrl: null } },
      requestKey(playerId)
    );
    emitSocialChanged([playerId, targetId]);
    return 'sent';
  },

  async accept(playerId: string, fromId: unknown): Promise<void> {
    if (typeof fromId !== 'string') throw new SocialError(400, 'invalid_player', 'That is not a player');
    const deleted = await db.queryAsync('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ? RETURNING from_id', [fromId, playerId]);
    if (deleted.length === 0) throw new SocialError(404, 'no_request', 'That request is gone');
    await this.checkRoom(playerId);
    // A request the other way, if both asked, is answered too.
    await db.runAsync('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?', [playerId, fromId]);
    await db.runAsync(
      `INSERT INTO friendships (player_id, friend_id, created_at) VALUES (?, ?, ?), (?, ?, ?) ON CONFLICT DO NOTHING`,
      [playerId, fromId, now(), fromId, playerId, now()]
    );
    await notificationService.answer(playerId, requestKey(fromId), 'accepted');
    await notificationService.withdraw(fromId, requestKey(playerId));
    const me = await playerExists(playerId);
    await notificationService.notify(fromId, 'friend_accepted', { by: me ? person(me) : { id: playerId, name: playerId, avatarUrl: null } }, `friend_accepted:${playerId}`);
    emitSocialChanged([playerId, fromId]);
  },

  async decline(playerId: string, fromId: unknown): Promise<void> {
    if (typeof fromId !== 'string') throw new SocialError(400, 'invalid_player', 'That is not a player');
    await db.runAsync('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?', [fromId, playerId]);
    await notificationService.answer(playerId, requestKey(fromId), 'declined');
    emitSocialChanged([playerId, fromId]);
  },

  /** Take back a request you sent. */
  async cancel(playerId: string, toId: unknown): Promise<void> {
    if (typeof toId !== 'string') throw new SocialError(400, 'invalid_player', 'That is not a player');
    await db.runAsync('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?', [playerId, toId]);
    await notificationService.withdraw(toId, requestKey(playerId));
    emitSocialChanged([playerId, toId]);
  },

  async remove(playerId: string, friendId: unknown): Promise<void> {
    if (typeof friendId !== 'string') throw new SocialError(400, 'invalid_player', 'That is not a player');
    await db.runAsync(
      'DELETE FROM friendships WHERE (player_id = ? AND friend_id = ?) OR (player_id = ? AND friend_id = ?)',
      [playerId, friendId, friendId, playerId]
    );
    emitSocialChanged([playerId, friendId]);
  },

  async checkRoom(playerId: string): Promise<void> {
    const count = await db.queryOneAsync<{ n: number | string }>('SELECT COUNT(*) AS n FROM friendships WHERE player_id = ?', [playerId]);
    if (Number(count?.n ?? 0) >= MAX_FRIENDS) throw new SocialError(409, 'too_many_friends', `At most ${MAX_FRIENDS} friends`);
  },

  /** Players by name (or exact Steam id, or a Steam profile link), with how they relate to the caller. */
  async search(playerId: string, query: unknown): Promise<Array<Person & { relation: Relation; matches: number }>> {
    const q = typeof query === 'string' ? query.trim().slice(0, 100) : '';
    if (q.length < 2) return [];
    const steamId = /(?:^|profiles\/)(7656\d{13})\b/.exec(q)?.[1];
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await db.queryAsync<PersonRow & { matches: number | string }>(
      `SELECT p.id, p.name, p.avatar_url,
              (SELECT COUNT(*) FROM player_match_stats s WHERE s.player_id = p.id) AS matches
         FROM players p
        WHERE p.id <> ? AND (${steamId ? 'p.id = ?' : 'p.name ILIKE ?'})
        ORDER BY (LOWER(p.name) = LOWER(?)) DESC, (LOWER(p.name) LIKE LOWER(?)) DESC, matches DESC, LOWER(p.name)
        LIMIT 20`,
      [playerId, steamId ?? like, q, `${q}%`]
    );
    return this.withRelations(playerId, rows);
  },

  /** People the player played with or against lately, most recent first, who are not friends yet. */
  async recent(playerId: string): Promise<Array<Person & { relation: Relation; matches: number }>> {
    const rows = await db.queryAsync<PersonRow & { matches: number | string }>(
      `SELECT p.id, p.name, p.avatar_url, COUNT(DISTINCT o.match_slug) AS matches
         FROM player_match_stats s
         JOIN player_match_stats o ON o.match_slug = s.match_slug AND o.player_id <> s.player_id
         JOIN players p ON p.id = o.player_id
        WHERE s.player_id = ?
          AND NOT EXISTS (SELECT 1 FROM friendships f WHERE f.player_id = s.player_id AND f.friend_id = o.player_id)
        GROUP BY p.id, p.name, p.avatar_url
        ORDER BY MAX(o.created_at) DESC
        LIMIT 8`,
      [playerId]
    );
    return this.withRelations(playerId, rows);
  },

  async withRelations(playerId: string, rows: Array<PersonRow & { matches: number | string }>) {
    const out = [];
    for (const r of rows) out.push({ ...person(r), matches: Number(r.matches), relation: await this.relation(playerId, r.id) });
    return out;
  },
};
