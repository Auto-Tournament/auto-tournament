/**
 * Chat: a match's chat (both teams and the admins), a team's chat, and a
 * matchmaking party's chat. Channels are `match:<slug>`, `team:<id>` and
 * `party:<id>`; who may read and write one is worked out each time from the
 * match roster, the team roster or the party, so nobody has to be added to a
 * channel. Admins read and write every match's chat (to settle things); team
 * and party chats are private to their members.
 *
 * Messages go out live over Socket.IO (`chat:message`) to the members' own
 * rooms (`player:<id>`) and, for a match, the admins' room.
 *
 * A match's chat is bridged to its game server: what players type in game
 * comes in through `fromGame` (CS2: Ready Up's `event.chat`), and what is
 * written here goes out to the game (`matchChatPosted`, CS2: fleet/chatBridge.ts).
 * A line from the game is never sent back to it.
 */

import { db } from '../config/database';
import { describeMatch } from '../utils/matchIntegration';
import { emitChatMessage, emitChatTyping, matchChatPosted } from './socketService';
import { recordAdminCall } from './adminCallService';
import { chatLineBody } from './matchChatLines';
import { CURRENT_MATCH_TOURNAMENT_JOIN } from '../utils/currentMatchOrder';

export type ChatKind = 'match' | 'team' | 'party';

export interface ChatMessage {
  id: number;
  channel: string;
  senderId: string | null;
  senderName: string;
  senderKind: 'player' | 'admin' | 'system';
  /** Match channels: the sender's team id (friend or enemy for the reader). */
  senderTeam: string | null;
  body: string;
  createdAt: number;
  /** The sender's picture (players.avatar_url), when they have one. */
  senderAvatar: string | null;
  /** Typed on the match's game server, not on the site. */
  fromGame: boolean;
  /** Lines from the game: '' = the admins only (no player reads or is pinged for it). */
  onlyTeam: string | null;
}

export interface ChatChannel {
  channel: string;
  kind: ChatKind;
  /** What the tab says: "vs Bergen Bots", "Team Sivert", "Your party". */
  title: string;
  /** Match channels: the reader's own team id. */
  myTeam: string | null;
  unread: number;
  /** Match channels: live, so the dock can say so. */
  live?: boolean;
  /**
   * An admin's match chat (not their own match): one with an open admin call, or one they
   * joined. `call` is the open call there, with who claimed it.
   */
  admin?: boolean;
  call?: { id: number; claimedBy: string | null; claimedByName: string | null } | null;
  /**
   * An admin's match chat listed only because its players talk in game (no open call, not
   * opened by this admin yet): it shows in the dock, but its messages do not ping.
   */
  quiet?: boolean;
}

/** A player's chat line from the match's game server, for `chatService.fromGame`. */
export interface GameChatInput {
  steamId: string;
  /** Their in-game name, used when the platform has no player record for them. */
  name: string;
  team: 'team1' | 'team2' | null;
  teamOnly: boolean;
  body: string;
}

export interface ChatViewer {
  steamId: string | null;
  isAdmin: boolean;
  name?: string | null;
}

export class ChatError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const MAX_BODY = 500;
const PAGE = 50;
/** At most this many messages per player in RATE_WINDOW_S seconds. */
const RATE_LIMIT = 6;
const RATE_WINDOW_S = 10;

interface MessageRow {
  id: number;
  channel: string;
  sender_id: string | null;
  sender_name: string;
  sender_kind: ChatMessage['senderKind'];
  sender_team: string | null;
  body: string;
  created_at: number;
  from_game?: boolean | null;
  only_team?: string | null;
  sender_avatar?: string | null;
}

const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  channel: r.channel,
  senderId: r.sender_id,
  senderName: r.sender_name,
  senderKind: r.sender_kind,
  senderTeam: r.sender_team,
  body: r.body,
  createdAt: r.created_at,
  senderAvatar: r.sender_avatar ?? null,
  fromGame: Boolean(r.from_game),
  onlyTeam: r.only_team ?? null,
});

export function parseChannel(channel: string): { kind: ChatKind; ref: string } | null {
  const m = /^(match|team|party):([A-Za-z0-9_.:-]{1,128})$/.exec(channel);
  return m ? { kind: m[1] as ChatKind, ref: m[2] } : null;
}

function steamIdsOf(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const list = JSON.parse(json) as unknown;
    if (Array.isArray(list)) {
      return list
        .map((p) =>
          p && typeof p === 'object'
            ? ((p as { steamId?: string; steamid?: string }).steamId ??
              (p as { steamid?: string }).steamid)
            : null
        )
        .filter((id): id is string => typeof id === 'string' && id !== '');
    }
    if (list && typeof list === 'object') return Object.keys(list as Record<string, unknown>);
  } catch {
    // Not a roster.
  }
  return [];
}

/** Who is in a match, by team id: its teams' rosters and the players its config names. */
async function matchTeams(
  slug: string
): Promise<{ teams: Map<string, Set<string>>; since: number } | null> {
  const row = await db.queryOneAsync<{
    created_at: number;
    game: string | null;
    config: string | null;
    team1_id: string | null;
    team2_id: string | null;
    t1: string | null;
    t2: string | null;
  }>(
    `SELECT m.created_at, m.game, m.config, m.team1_id, m.team2_id, t1.players AS t1, t2.players AS t2
       FROM matches m LEFT JOIN teams t1 ON t1.id = m.team1_id LEFT JOIN teams t2 ON t2.id = m.team2_id
      WHERE m.slug = ?`,
    [slug]
  );
  if (!row) return null;
  const teams = new Map<string, Set<string>>();
  const k1 = row.team1_id ?? 'team1';
  const k2 = row.team2_id ?? 'team2';
  teams.set(k1, new Set(steamIdsOf(row.t1)));
  teams.set(k2, new Set(steamIdsOf(row.t2)));
  try {
    const config = row.config ? (JSON.parse(row.config) as unknown) : null;
    const described = describeMatch({ game: row.game as never, config });
    for (const p of described.team1.players)
      if (p.account.provider === 'steam') teams.get(k1)!.add(p.account.externalId);
    for (const p of described.team2.players)
      if (p.account.provider === 'steam') teams.get(k2)!.add(p.account.externalId);
  } catch {
    // A config the game cannot describe: the team rosters stand.
  }
  return { teams, since: row.created_at };
}

interface Members {
  players: Set<string>;
  /** Match channels: each player's team id. */
  teamOf: Map<string, string>;
  /**
   * Messages before this (epoch seconds) belong to an earlier match with the
   * same slug: a tournament deleted or reset, and its slugs used again.
   */
  since: number;
}

/** The players in a channel (Steam IDs), and for a match their team per player. */
async function members(channel: string): Promise<Members | null> {
  const parsed = parseChannel(channel);
  if (!parsed) return null;
  const teamOf = new Map<string, string>();
  if (parsed.kind === 'match') {
    const found = await matchTeams(parsed.ref);
    if (!found) return null;
    const players = new Set<string>();
    for (const [teamId, ids] of found.teams)
      for (const id of ids) {
        players.add(id);
        teamOf.set(id, teamId);
      }
    return { players, teamOf, since: found.since };
  }
  if (parsed.kind === 'team') {
    const row = await db.queryOneAsync<{ players: string | null }>(
      'SELECT players FROM teams WHERE id = ?',
      [parsed.ref]
    );
    if (!row) return null;
    return { players: new Set(steamIdsOf(row.players)), teamOf, since: 0 };
  }
  const rows = await db.queryAsync<{ player_id: string }>(
    'SELECT player_id FROM mm_party_members WHERE party_id = ?',
    [parsed.ref]
  );
  if (rows.length === 0) return null;
  return { players: new Set(rows.map((r) => r.player_id)), teamOf, since: 0 };
}

/** Whether the viewer may read and write the channel; throws 403/404 when not. */
async function access(viewer: ChatViewer, channel: string) {
  const parsed = parseChannel(channel);
  if (!parsed) throw new ChatError(400, 'Not a chat channel');
  const m = await members(channel);
  if (!m) throw new ChatError(404, 'No such chat');
  const isMember = viewer.steamId !== null && m.players.has(viewer.steamId);
  if (!isMember && !(viewer.isAdmin && parsed.kind === 'match')) {
    throw new ChatError(403, 'Not your chat');
  }
  return { parsed, members: m, isMember };
}

/**
 * Unread messages for a reader. `myTeam`: a match player's team, so the other team's in-game
 * team chat (which they cannot read) is not counted; null reads every team's (an admin).
 */
async function unreadFor(
  steamId: string | null,
  channel: string,
  since = 0,
  myTeam: string | null = null
): Promise<number> {
  if (!steamId) return 0;
  const row = await db.queryOneAsync<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM chat_messages c
      WHERE c.channel = ? AND c.created_at >= ? AND (c.sender_id IS NULL OR c.sender_id <> ?)
        AND (c.only_team IS NULL OR ?::text IS NULL OR c.only_team = ?)
        AND c.id > COALESCE((SELECT last_id FROM chat_reads WHERE player_id = ? AND channel = ?), 0)`,
    [channel, since, steamId, myTeam, myTeam, steamId, channel]
  );
  return row?.n ?? 0;
}

/**
 * An admin's match chats: every match with an open admin call (the call puts it in every
 * admin's dock), the ones the admin opened (a chat_reads row), and the live ones whose
 * players talk in game (those are `quiet` until the admin opens them: twenty matches of
 * player chatter must not ping). Open calls first.
 */
async function adminChannels(steamId: string | null): Promise<ChatChannel[]> {
  const rows = await db.queryAsync<{
    slug: string;
    status: string;
    n1: string | null;
    n2: string | null;
    call_id: number | null;
    claimed_by: string | null;
    claimed_by_name: string | null;
    joined: boolean;
  }>(
    `SELECT m.slug, m.status, t1.name AS n1, t2.name AS n2,
            ac.id AS call_id, ac.claimed_by, cp.name AS claimed_by_name,
            EXISTS (SELECT 1 FROM chat_reads r
                     WHERE r.player_id = ? AND r.channel = 'match:' || m.slug) AS joined
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN LATERAL (
         SELECT a.id, a.claimed_by FROM admin_calls a
          WHERE a.match_slug = m.slug AND a.resolved_at IS NULL
          ORDER BY a.received_at DESC LIMIT 1
       ) ac ON TRUE
       LEFT JOIN players cp ON cp.id = ac.claimed_by
      WHERE m.status IN ('pending', 'ready', 'loaded', 'live', 'needs_decision')
        AND (ac.id IS NOT NULL
             OR EXISTS (SELECT 1 FROM chat_reads r
                         WHERE r.player_id = ? AND r.channel = 'match:' || m.slug)
             OR (m.status IN ('loaded', 'live')
                 AND EXISTS (SELECT 1 FROM chat_messages c
                              WHERE c.channel = 'match:' || m.slug AND c.from_game
                                AND c.created_at >= m.created_at)))
      ORDER BY (ac.id IS NOT NULL) DESC, m.id DESC
      LIMIT 20`,
    [steamId ?? '', steamId ?? '']
  );
  const out: ChatChannel[] = [];
  for (const r of rows) {
    const channel = `match:${r.slug}`;
    const found = await matchTeams(r.slug);
    const quiet = r.call_id === null && !r.joined;
    out.push({
      channel,
      kind: 'match',
      title: r.n1 && r.n2 ? `${r.n1} vs ${r.n2}` : r.slug,
      myTeam: null,
      unread: quiet ? 0 : await unreadFor(steamId, channel, found?.since ?? 0),
      live: r.status === 'loaded' || r.status === 'live',
      admin: true,
      ...(quiet ? { quiet } : {}),
      call:
        r.call_id === null
          ? null
          : {
              id: Number(r.call_id),
              claimedBy: r.claimed_by,
              claimedByName: r.claimed_by_name,
            },
    });
  }
  return out;
}

export const chatService = {
  /** The viewer's chats: their current match, their team, their party. */
  async channels(viewer: ChatViewer): Promise<ChatChannel[]> {
    const out = await this.ownChannels(viewer);
    if (!viewer.isAdmin) return out;
    for (const c of await adminChannels(viewer.steamId)) {
      if (!out.some((o) => o.channel === c.channel)) out.push(c);
    }
    return out;
  },

  async ownChannels(viewer: ChatViewer): Promise<ChatChannel[]> {
    const out: ChatChannel[] = [];
    const id = viewer.steamId;
    if (!id) return out;
    const like = `%${id}%`;
    const match = await db.queryOneAsync<{
      slug: string;
      status: string;
      team1_id: string | null;
      team2_id: string | null;
      n1: string | null;
      n2: string | null;
    }>(
      `SELECT m.slug, m.status, m.team1_id, m.team2_id, t1.name AS n1, t2.name AS n2
         FROM matches m LEFT JOIN teams t1 ON t1.id = m.team1_id LEFT JOIN teams t2 ON t2.id = m.team2_id
         ${CURRENT_MATCH_TOURNAMENT_JOIN}
        WHERE m.status IN ('pending', 'ready', 'loaded', 'live')
          AND (t1.players LIKE ? OR t2.players LIKE ? OR m.config LIKE ('%"' || TRIM(BOTH '%' FROM ?) || '":%'))
        ORDER BY (m.status IN ('loaded', 'live')) DESC, (cmt.status IS NOT DISTINCT FROM 'setup') ASC,
                 m.id DESC LIMIT 1`,
      [like, like, like]
    );
    if (match) {
      const found = await matchTeams(match.slug);
      let myTeam: string | null = null;
      for (const [teamId, ids] of found?.teams ?? []) if (ids.has(id)) myTeam = teamId;
      if (myTeam) {
        const enemy = myTeam === match.team1_id ? match.n2 : match.n1;
        const channel = `match:${match.slug}`;
        out.push({
          channel,
          kind: 'match',
          title: enemy ? `vs ${enemy}` : match.slug,
          myTeam,
          unread: await unreadFor(id, channel, found?.since ?? 0, myTeam),
          live: match.status === 'loaded' || match.status === 'live',
        });
      }
    }
    const team = await db.queryOneAsync<{ id: string; name: string }>(
      "SELECT id, name FROM teams WHERE players LIKE ? AND id NOT LIKE 'shuffle-%' ORDER BY updated_at DESC NULLS LAST LIMIT 1",
      [like]
    );
    if (team) {
      const channel = `team:${team.id}`;
      out.push({
        channel,
        kind: 'team',
        title: team.name,
        myTeam: team.id,
        unread: await unreadFor(id, channel),
      });
    }
    const party = await db.queryOneAsync<{ party_id: string; n: number }>(
      `SELECT pm.party_id, (SELECT COUNT(*)::int FROM mm_party_members x WHERE x.party_id = pm.party_id) AS n
         FROM mm_party_members pm WHERE pm.player_id = ?`,
      [id]
    );
    if (party && party.n > 1) {
      const channel = `party:${party.party_id}`;
      out.push({
        channel,
        kind: 'party',
        title: 'Party',
        myTeam: null,
        unread: await unreadFor(id, channel),
      });
    }
    return out;
  },

  /** A page of a channel's messages, oldest first: the newest PAGE, or the PAGE before `before`. */
  async messages(
    viewer: ChatViewer,
    channel: string,
    before?: number
  ): Promise<{ messages: ChatMessage[]; myTeam: string | null }> {
    const { members: m, isMember } = await access(viewer, channel);
    const myTeam = viewer.steamId ? (m.teamOf.get(viewer.steamId) ?? null) : null;
    // In-game team chat: its own team and the admins (an admin playing reads as a player).
    const seesEveryTeam = viewer.isAdmin && !isMember;
    const params: unknown[] = [channel, m.since];
    if (!seesEveryTeam) params.push(myTeam);
    if (before) params.push(before);
    const rows = await db.queryAsync<MessageRow>(
      `SELECT c.*, p.avatar_url AS sender_avatar FROM chat_messages c LEFT JOIN players p ON p.id = c.sender_id
        WHERE c.channel = ? AND c.created_at >= ?
          ${seesEveryTeam ? '' : 'AND (c.only_team IS NULL OR c.only_team = ?)'}
          ${before ? 'AND c.id < ?' : ''} ORDER BY c.id DESC LIMIT ${PAGE}`,
      params
    );
    return { messages: rows.reverse().map(toMessage), myTeam };
  },

  async send(viewer: ChatViewer, channel: string, body: string): Promise<ChatMessage> {
    const text = body.replace(/\s+/g, ' ').trim();
    if (!text) throw new ChatError(400, 'Write something first');
    if (text.length > MAX_BODY) throw new ChatError(400, `At most ${MAX_BODY} characters`);
    const { parsed, members: m, isMember } = await access(viewer, channel);

    if (viewer.steamId) {
      const recent = await db.queryOneAsync<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM chat_messages WHERE sender_id = ? AND created_at > EXTRACT(EPOCH FROM NOW())::INTEGER - ?',
        [viewer.steamId, RATE_WINDOW_S]
      );
      if ((recent?.n ?? 0) >= RATE_LIMIT) throw new ChatError(429, 'Slow down a little');
    }

    const asAdmin = viewer.isAdmin && !isMember;
    let name = viewer.name ?? null;
    let avatar: string | null = null;
    if (viewer.steamId) {
      const me = await db.queryOneAsync<{ name: string; avatar_url: string | null }>(
        'SELECT name, avatar_url FROM players WHERE id = ?',
        [viewer.steamId]
      );
      name = name ?? me?.name ?? null;
      avatar = me?.avatar_url ?? null;
    }
    const row = await db.queryOneAsync<MessageRow>(
      `INSERT INTO chat_messages (channel, sender_id, sender_name, sender_kind, sender_team, body)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        channel,
        viewer.steamId,
        name ?? 'Admin',
        asAdmin ? 'admin' : 'player',
        viewer.steamId ? (m.teamOf.get(viewer.steamId) ?? null) : null,
        text,
      ]
    );
    const message = toMessage({ ...(row as MessageRow), sender_avatar: avatar });
    if (viewer.steamId) await this.markRead(viewer, channel, message.id);
    emitChatMessage(m.players, parsed.kind === 'match', message);
    if (parsed.kind === 'match') {
      // To the game server, when the match is on one (CS2: fleet/chatBridge.ts).
      matchChatPosted({
        slug: parsed.ref,
        senderKind: asAdmin ? 'admin' : 'player',
        senderName: message.senderName,
        body: message.body,
      });
    }
    return message;
  },

  /**
   * A player's chat line from the match's game server, into `match:<slug>`: as them (their
   * platform name when they have a player record, else the in-game one), with `(team) ` in
   * front of team chat. Only the admins see it (players have it in game). Never sent back to the
   * game. Null when there is no such match or nothing to say.
   */
  async fromGame(slug: string, input: GameChatInput): Promise<ChatMessage | null> {
    const channel = `match:${slug}`;
    const m = await members(channel);
    if (!m) return null;
    const text = input.body.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const match = await db.queryOneAsync<{ team1_id: string | null; team2_id: string | null }>(
      'SELECT team1_id, team2_id FROM matches WHERE slug = ?',
      [slug]
    );
    const team =
      m.teamOf.get(input.steamId) ??
      (input.team === 'team1'
        ? (match?.team1_id ?? 'team1')
        : input.team === 'team2'
          ? (match?.team2_id ?? 'team2')
          : null);
    const me = await db.queryOneAsync<{ name: string; avatar_url: string | null }>(
      'SELECT name, avatar_url FROM players WHERE id = ?',
      [input.steamId]
    );
    // Players already see in-game chat in the game: on the site it is for the admins only
    // (only_team '' matches no team, so it is not listed, counted or sent to a player).
    const body = `${input.teamOnly ? '(team) ' : ''}${text}`.slice(0, MAX_BODY);
    const row = await db.queryOneAsync<MessageRow>(
      `INSERT INTO chat_messages (channel, sender_id, sender_name, sender_kind, sender_team, body, from_game, only_team)
       VALUES (?, ?, ?, 'player', ?, ?, TRUE, ?) RETURNING *`,
      [
        channel,
        input.steamId,
        (me?.name || input.name || input.steamId).slice(0, 128),
        team,
        body,
        '',
      ]
    );
    const message = toMessage({ ...(row as MessageRow), sender_avatar: me?.avatar_url ?? null });
    emitChatMessage([], true, message);
    return message;
  },

  /**
   * The viewer is typing in a channel: the others in it see "X is typing…"
   * for a few seconds (the client says so again while it goes on).
   */
  async typing(viewer: ChatViewer, channel: string): Promise<void> {
    if (!viewer.steamId) return;
    const { members: m } = await access(viewer, channel);
    const me = await db.queryOneAsync<{ name: string }>('SELECT name FROM players WHERE id = ?', [
      viewer.steamId,
    ]);
    const others = [...m.players].filter((id) => id !== viewer.steamId);
    emitChatTyping(others, {
      channel,
      playerId: viewer.steamId,
      name: viewer.name ?? me?.name ?? '',
    });
  },

  /** A line from the platform (veto picks, the server being ready) in a match's chat. */
  async system(channel: string, body: string): Promise<void> {
    const m = await members(channel);
    if (!m) return;
    const row = await db.queryOneAsync<MessageRow>(
      `INSERT INTO chat_messages (channel, sender_id, sender_name, sender_kind, body) VALUES (?, NULL, 'Auto Tournament', 'system', ?) RETURNING *`,
      [channel, body.slice(0, MAX_BODY)]
    );
    emitChatMessage(m.players, channel.startsWith('match:'), toMessage(row as MessageRow));
  },

  /**
   * "Call an admin" from a match's chat: the same admin call a player makes
   * from the game server, so it shows in the admins' calls list, plus a line
   * in the chat so both teams see someone asked.
   */
  async callAdmin(viewer: ChatViewer, channel: string, note: string): Promise<void> {
    const { parsed, members: m, isMember } = await access(viewer, channel);
    if (parsed.kind !== 'match' || !isMember || !viewer.steamId)
      throw new ChatError(400, 'Only a player in the match can call an admin');
    const recent = await db.queryOneAsync<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM admin_calls WHERE match_slug = ? AND player_steamid = ? AND resolved_at IS NULL',
      [parsed.ref, viewer.steamId]
    );
    if ((recent?.n ?? 0) > 0) throw new ChatError(409, 'An admin has been called already');
    const match = await db.queryOneAsync<{
      id: number;
      game: string | null;
      server_id: string | null;
      team1_id: string | null;
    }>('SELECT id, game, server_id, team1_id FROM matches WHERE slug = ?', [parsed.ref]);
    const name =
      (
        await db.queryOneAsync<{ name: string }>('SELECT name FROM players WHERE id = ?', [
          viewer.steamId,
        ])
      )?.name ?? null;
    const team = m.teamOf.get(viewer.steamId) ?? null;
    const now = Math.floor(Date.now() / 1000);
    await recordAdminCall({
      callId: `chat-${parsed.ref}-${viewer.steamId}-${now}`,
      game: match?.game ?? 'cs2',
      serverId: match?.server_id ?? null,
      serverName: null,
      matchId: match?.id ?? null,
      matchSlug: parsed.ref,
      mapNumber: null,
      player: {
        steamId: viewer.steamId,
        name,
        team: team === null ? null : team === (match?.team1_id ?? 'team1') ? 'team1' : 'team2',
        side: null,
      },
      message: note.replace(/\s+/g, ' ').trim(),
      calledAt: now,
    });
    await this.system(channel, chatLineBody('adminCalled', { name: name ?? '' }));
  },

  async markRead(viewer: ChatViewer, channel: string, lastId: number): Promise<void> {
    if (!viewer.steamId || !Number.isInteger(lastId)) return;
    await db.runAsync(
      `INSERT INTO chat_reads (player_id, channel, last_id) VALUES (?, ?, ?)
       ON CONFLICT (player_id, channel) DO UPDATE SET last_id = GREATEST(chat_reads.last_id, EXCLUDED.last_id)`,
      [viewer.steamId, channel, lastId]
    );
  },
};
