/**
 * The bell: notices for one player, newest first, read or not. Anything in the
 * platform (or a game module) sends one with `notify`; the player's open tabs
 * hear `notify:new` with it at once (socket room `player:<id>`), so a party
 * invite pops up wherever they are.
 *
 * Per kind, a player picks off, the bell, or the bell with a sound
 * (`settings`); what needs an answer can't be off. An "off" notice is not
 * stored; a "sound" one reaches their tabs with `sound: true`.
 *
 * What needs an answer (a party invite, a friend request) carries its buttons
 * in the client; answering stores `answer` in the notice's data, so the bell
 * shows what was done. A party invite whose party is gone shows as expired.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitNotification } from './socketService';

export type NotificationKind =
  | 'party_invite'
  | 'team_invite'
  | 'friend_request'
  | 'friend_accepted'
  | 'skin'
  | 'highlight'
  | 'tournament'
  | 'news'
  | 'report';

export type NotificationDelivery = 'off' | 'bell' | 'sound';

/** Each kind's delivery for a player who chose nothing. */
export const NOTIFICATION_DEFAULTS: Record<NotificationKind, NotificationDelivery> = {
  party_invite: 'sound',
  team_invite: 'sound',
  friend_request: 'bell',
  friend_accepted: 'bell',
  skin: 'bell',
  highlight: 'bell',
  tournament: 'sound',
  news: 'bell',
  report: 'bell',
};

/** Kinds that need an answer: never off, or the question would never reach them. */
export const NOTIFICATION_ANSWERED: NotificationKind[] = [
  'party_invite',
  'team_invite',
  'friend_request',
];

export type NotificationSettings = Record<NotificationKind, NotificationDelivery>;

/** Stored (or posted) settings with every kind filled in and nothing unknown. */
export function normalizeNotificationSettings(raw: unknown): NotificationSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...NOTIFICATION_DEFAULTS };
  for (const kind of Object.keys(out) as NotificationKind[]) {
    const v = input[kind];
    if (v === 'off' || v === 'bell' || v === 'sound') {
      out[kind] = v === 'off' && NOTIFICATION_ANSWERED.includes(kind) ? 'bell' : v;
    }
  }
  return out;
}

export interface NotificationView {
  id: number;
  kind: NotificationKind;
  data: Record<string, unknown>;
  createdAt: number;
  read: boolean;
}

interface Row {
  id: number;
  kind: string;
  data: string;
  created_at: number | string;
  read_at: number | string | null;
}

/** Notices older than this are deleted by the daily sweep. */
const KEEP_DAYS = 90;
/** One page of the bell. */
const PAGE = 30;

const now = () => Math.floor(Date.now() / 1000);

function parse(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function view(row: Row): NotificationView {
  return {
    id: Number(row.id),
    kind: row.kind as NotificationKind,
    data: parse(row.data),
    createdAt: Number(row.created_at),
    read: row.read_at !== null && row.read_at !== undefined,
  };
}

export const notificationService = {
  /**
   * Send a notice to one player. With a `dedupeKey`, a notice the player
   * already has under that key is replaced (a new invite to the same party, a
   * friend request sent again) and comes back unread at the top.
   */
  async notify(
    playerId: string,
    kind: NotificationKind,
    data: Record<string, unknown>,
    dedupeKey?: string
  ): Promise<NotificationView | null> {
    try {
      const delivery = (await this.settings(playerId))[kind];
      if (delivery === 'off') return null;
      if (dedupeKey) {
        await db.runAsync('DELETE FROM notifications WHERE player_id = ? AND dedupe_key = ?', [
          playerId,
          dedupeKey,
        ]);
      }
      const row = await db.queryOneAsync<Row>(
        `INSERT INTO notifications (player_id, kind, data, dedupe_key, created_at)
         SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM players WHERE id = ?)
         RETURNING id, kind, data, created_at, read_at`,
        [playerId, kind, JSON.stringify(data), dedupeKey ?? null, now(), playerId]
      );
      if (!row) return null;
      const notice = view(row);
      emitNotification(playerId, { ...notice, sound: delivery === 'sound' });
      return notice;
    } catch (error) {
      log.warn(`[NOTIFY] Could not send a ${kind} notice`, { error });
      return null;
    }
  },

  /**
   * Send a notice once per player and key: a sweep that runs again (a
   * restart, the next minute) sends nothing new.
   */
  async notifyOnce(
    playerIds: string[],
    kind: NotificationKind,
    data: Record<string, unknown>,
    dedupeKey: string
  ): Promise<number> {
    let sent = 0;
    for (const playerId of new Set(playerIds)) {
      try {
        const delivery = (await this.settings(playerId))[kind];
        if (delivery === 'off') continue;
        const row = await db.queryOneAsync<Row>(
          `INSERT INTO notifications (player_id, kind, data, dedupe_key, created_at)
           SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM players WHERE id = ?)
           ON CONFLICT (player_id, dedupe_key) DO NOTHING
           RETURNING id, kind, data, created_at, read_at`,
          [playerId, kind, JSON.stringify(data), dedupeKey, now(), playerId]
        );
        if (row) {
          emitNotification(playerId, { ...view(row), sound: delivery === 'sound' });
          sent += 1;
        }
      } catch (error) {
        log.warn(`[NOTIFY] Could not send a ${kind} notice`, { error });
      }
    }
    return sent;
  },

  /** News for every player who has signed in: one row each, in one statement. */
  async broadcast(data: Record<string, unknown>): Promise<number> {
    const rows = await db.queryAsync<Row & { player_id: string }>(
      `INSERT INTO notifications (player_id, kind, data, created_at)
       SELECT id, 'news', ?, ? FROM players
        WHERE last_sign_in_at IS NOT NULL
          AND COALESCE(notification_settings, '{}')::jsonb->>'news' IS DISTINCT FROM 'off'
       RETURNING id, player_id, kind, data, created_at, read_at`,
      [JSON.stringify(data), now()]
    );
    const sound = new Set(
      (
        await db.queryAsync<{ id: string }>(
          `SELECT id FROM players WHERE id = ANY(?::text[])
              AND COALESCE(notification_settings, '{}')::jsonb->>'news' = 'sound'`,
          [rows.map((r) => r.player_id)]
        )
      ).map((r) => r.id)
    );
    for (const row of rows)
      emitNotification(row.player_id, { ...view(row), sound: sound.has(row.player_id) });
    return rows.length;
  },

  /** How the player wants each kind of notice (the defaults for what they never chose). */
  async settings(playerId: string): Promise<NotificationSettings> {
    const row = await db.queryOneAsync<{ notification_settings: string | null }>(
      'SELECT notification_settings FROM players WHERE id = ?',
      [playerId]
    );
    return normalizeNotificationSettings(parse(row?.notification_settings ?? '{}'));
  },

  /** Change some kinds; the rest stay. Returns all of them. */
  async saveSettings(playerId: string, patch: unknown): Promise<NotificationSettings> {
    const next = normalizeNotificationSettings({
      ...(await this.settings(playerId)),
      ...(patch && typeof patch === 'object' ? patch : {}),
    });
    await db.runAsync('UPDATE players SET notification_settings = ? WHERE id = ?', [
      JSON.stringify(next),
      playerId,
    ]);
    return next;
  },

  /** The player's notices, newest first; `before` pages back by id. */
  async list(
    playerId: string,
    before?: number
  ): Promise<{ items: NotificationView[]; unread: number; more: boolean }> {
    const rows = await db.queryAsync<Row>(
      `SELECT id, kind, data, created_at, read_at FROM notifications
        WHERE player_id = ? ${before ? 'AND id < ?' : ''}
        ORDER BY id DESC LIMIT ?`,
      before ? [playerId, before, PAGE + 1] : [playerId, PAGE + 1]
    );
    const items = rows.slice(0, PAGE).map(view);
    // A party invite is only answerable while the invite stands.
    const parties = items
      .filter(
        (n) => n.kind === 'party_invite' && !n.data.answer && typeof n.data.partyId === 'string'
      )
      .map((n) => n.data.partyId as string);
    if (parties.length > 0) {
      const open = new Set(
        (
          await db.queryAsync<{ party_id: string }>(
            `SELECT party_id FROM mm_party_invites WHERE to_id = ? AND party_id IN (${parties.map(() => '?').join(', ')})`,
            [playerId, ...parties]
          )
        ).map((r) => r.party_id)
      );
      for (const n of items) {
        if (n.kind === 'party_invite' && !n.data.answer && !open.has(n.data.partyId as string))
          n.data.answer = 'expired';
      }
    }
    return { items, unread: await this.unread(playerId), more: rows.length > PAGE };
  },

  async unread(playerId: string): Promise<number> {
    const row = await db.queryOneAsync<{ n: number | string }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE player_id = ? AND read_at IS NULL',
      [playerId]
    );
    return Number(row?.n ?? 0);
  },

  /** Mark some (or, with no ids, all) of the player's notices read. */
  async markRead(playerId: string, ids?: number[]): Promise<number> {
    if (ids && ids.length === 0) return this.unread(playerId);
    if (ids) {
      await db.runAsync(
        `UPDATE notifications SET read_at = ? WHERE player_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(', ')})`,
        [now(), playerId, ...ids]
      );
    } else {
      await db.runAsync(
        'UPDATE notifications SET read_at = ? WHERE player_id = ? AND read_at IS NULL',
        [now(), playerId]
      );
    }
    return this.unread(playerId);
  },

  /** Store what the player did with an answerable notice (by its key): it is read from then on. */
  async answer(playerId: string, dedupeKey: string, answer: string): Promise<void> {
    const row = await db.queryOneAsync<Row>(
      'SELECT id, kind, data, created_at, read_at FROM notifications WHERE player_id = ? AND dedupe_key = ?',
      [playerId, dedupeKey]
    );
    if (!row) return;
    const data = { ...parse(row.data), answer };
    await db.runAsync(
      'UPDATE notifications SET data = ?, read_at = COALESCE(read_at, ?) WHERE id = ?',
      [JSON.stringify(data), now(), row.id]
    );
  },

  /** Take back a notice nobody needs to answer any more (a cancelled request or invite). */
  async withdraw(playerId: string, dedupeKey: string): Promise<void> {
    await db.runAsync('DELETE FROM notifications WHERE player_id = ? AND dedupe_key = ?', [
      playerId,
      dedupeKey,
    ]);
  },

  /** Drop notices older than KEEP_DAYS. */
  async prune(): Promise<void> {
    await db.runAsync('DELETE FROM notifications WHERE created_at < ?', [
      now() - KEEP_DAYS * 86400,
    ]);
  },
};
