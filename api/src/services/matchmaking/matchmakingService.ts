/**
 * Matchmaking phase 1 (docs/design/matchmaking.md): parties, the queue, the
 * matching loop and accept / decline with cooldowns. A lobby whose players
 * all accepted becomes a standalone match (`matches.source = 'matchmaking'`,
 * one random map from the game's matchmaking pool) that the scheduler
 * allocates like a manual match; Ready Up then whitelists the ten players.
 *
 * The queue lives in the database, so a restart loses nothing; lobbies that
 * were still accepting are cancelled without penalty and their parties go
 * back to searching. Every change runs through one in-process lock, so the
 * loop and the API never interleave.
 */
import { getGameRatings } from '../gameRatings';
import { randomInt, randomUUID } from 'crypto';
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { hasIntegration, getIntegration } from '../../integrations/registry';
import { matchService } from '../matchService';
import { resolveTournamentId } from '../../utils/tournamentRow';
import { configuredPublicOrigin } from '../../utils/publicOrigin';
import { rating as osRating, rate as osRate } from 'openskill';
import { DEFAULT_SIGMA, openSkillToDisplayElo } from '../../utils/ratingMath';
import { progressionService } from './progressionService';
import { playerConnectionService } from '../playerConnectionService';
import { emitMatchmakingChanged, onlinePlayerCount } from '../socketService';
import { settingsService } from '../settingsService';
import {
  ABANDON_WINDOW_SECONDS,
  abandonCooldownSeconds,
  isAbandon,
  ACCEPT_SECONDS,
  cooldownSeconds,
  findGroup,
  inviteCode,
  isMode,
  MODES,
  parseEnabledModes,
  parseModePools,
  OFFENCE_WINDOW_SECONDS,
  partyRating,
  parseReservedServers,
  parseSearchWindow,
  searchWindow,
  splitTeams,
  TEAM_SIZE,
  type MatchmakingMode,
  type QueuedParty,
} from './rules';

export class MatchmakingError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

interface PartyRow {
  id: string;
  leader_player_id: string;
  mode: string;
  invite_code: string;
}

interface EntryRow {
  id: string;
  party_id: string;
  mode: string;
  queued_at: number;
  status: string;
  lobby_id: string | null;
}

interface LobbyRow {
  id: string;
  mode: string;
  status: string;
  accept_deadline: number;
  cancel_reason: string | null;
}

interface LobbyPlayerRow {
  player_id: string;
  party_id: string;
  team: number;
  accepted_at: number | null;
  declined_at: number | null;
}

export interface MatchmakingMe {
  party: {
    id: string;
    leader: string;
    mode: string;
    inviteCode: string;
    members: string[];
    /** The members with their names and avatars, in `members` order. */
    people: Array<{ id: string; name: string; avatarUrl: string | null }>;
  } | null;
  queue: { mode: string; queuedAt: number; status: string } | null;
  /** Players searching right now, per mode (the Play page's "in the queue"). */
  queueCounts: Record<string, number>;
  lobby: {
    id: string;
    status: string;
    acceptDeadline: number;
    /** Set once the lobby's match exists. */
    matchSlug: string | null;
    map: string | null;
    accepted: number;
    total: number;
    youAccepted: boolean;
    team: number;
  } | null;
  cooldownUntil: number | null;
  /** The caller's matchmaking rating in their party's mode (5v5 by default), once they have played (display Elo). */
  rating: { elo: number; games: number; wins: number } | null;
  /** The modes players can search on this site. */
  modes: string[];
  /** Signed-in players with the site open. */
  online: number;
  /** Typical seconds from searching to a match found, per mode; null with too few recent games. */
  waitSeconds: Record<string, number | null>;
  /** Each mode's rules for its card: rounds per half (MR) and the map pool's name (null = the default pool). */
  modeRules: Record<string, { maxRounds: number; pool: string | null }>;
}

/** Rounds per half Ready Up plays: wingman MR8, everything else MR12. */
const MODE_MAX_ROUNDS: Record<MatchmakingMode, number> = { '5v5': 12, '2v2': 8, '1v1': 12 };
/** Fewer found matches than this in the last week says nothing about the wait. */
const MIN_WAIT_SAMPLES = 3;

const LOOP_MS = 2000;

/** Setting: the admin's search window (JSON, `rules.parseSearchWindow`). */
export const MM_SEARCH_WINDOW = 'mm_search_window';

/** Setting: the modes players can search (JSON array, `rules.parseEnabledModes`). */
export const MM_MODES = 'mm_modes';

/** Setting: the map pool per mode (JSON `{ mode: poolId }`, `rules.parseModePools`). */
export const MM_MODE_POOLS = 'mm_mode_pools';

/** Setting: servers tournament matches leave free while matchmaking has players waiting. */
export const MM_RESERVED_SERVERS = 'mm_reserved_servers';

/** A first matchmaking game starts this uncertain at least, so it settles fast. */
const SEED_SIGMA = 6.5;

interface RatingRow {
  player_id: string;
  mu: number;
  sigma: number;
  games: number;
  wins: number;
}

export class MatchmakingService {
  private chain: Promise<unknown> = Promise.resolve();
  /** Presence of each live matchmaking match: since when it is watched, and who was last seen when. */
  private presence = new Map<string, { since: number; lastSeen: Map<string, number> }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly clock: () => number = () => Math.floor(Date.now() / 1000)) {}

  /** Players whose state the running change touched; told (`mm:changed`) when it ends. */
  private touched = new Set<string>();

  private touch(...playerIds: string[]): void {
    for (const id of playerIds) this.touched.add(id);
  }

  /** Run `fn` after every change before it: the loop and the API never interleave. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const wrapped = async () => {
      try {
        return await fn();
      } finally {
        if (this.touched.size > 0) {
          emitMatchmakingChanged(this.touched);
          this.touched = new Set();
        }
      }
    };
    const run = this.chain.then(wrapped, wrapped);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // --- parties ---------------------------------------------------------

  private async partyOf(playerId: string): Promise<PartyRow | undefined> {
    return db.queryOneAsync<PartyRow>(
      `SELECT p.id, p.leader_player_id, p.mode, p.invite_code
         FROM mm_parties p JOIN mm_party_members m ON m.party_id = p.id
        WHERE m.player_id = ?`,
      [playerId]
    );
  }

  private async members(partyId: string): Promise<string[]> {
    const rows = await db.queryAsync<{ player_id: string }>(
      'SELECT player_id FROM mm_party_members WHERE party_id = ? ORDER BY joined_at, player_id',
      [partyId]
    );
    return rows.map((r) => r.player_id);
  }

  /** Mark everyone in a party as changed. */
  private async touchParty(partyId: string): Promise<void> {
    this.touch(...(await this.members(partyId)));
  }

  private async entryOf(partyId: string): Promise<EntryRow | undefined> {
    return db.queryOneAsync<EntryRow>('SELECT * FROM mm_queue_entries WHERE party_id = ?', [partyId]);
  }

  private async newParty(playerId: string, mode: MatchmakingMode): Promise<PartyRow> {
    const party: PartyRow = { id: randomUUID(), leader_player_id: playerId, mode, invite_code: inviteCode() };
    await db.runAsync(
      'INSERT INTO mm_parties (id, leader_player_id, mode, invite_code, created_at) VALUES (?, ?, ?, ?, ?)',
      [party.id, playerId, mode, party.invite_code, this.clock()]
    );
    await db.runAsync('INSERT INTO mm_party_members (party_id, player_id, joined_at) VALUES (?, ?, ?)', [
      party.id,
      playerId,
      this.clock(),
    ]);
    return party;
  }

  /** The caller's party, created (as its leader) when they have none. */
  createParty(playerId: string, mode: unknown = '5v5'): Promise<PartyRow> {
    return this.locked(async () => {
      if (!isMode(mode)) throw new MatchmakingError(400, 'invalid_mode', 'Unknown mode');
      return (await this.partyOf(playerId)) ?? this.newParty(playerId, mode);
    });
  }

  joinParty(playerId: string, code: unknown): Promise<PartyRow> {
    return this.locked(async () => {
      if (typeof code !== 'string' || !/^[A-Z0-9]{6,16}$/.test(code.trim().toUpperCase())) {
        throw new MatchmakingError(400, 'invalid_code', 'That invite code is not valid');
      }
      const party = await db.queryOneAsync<PartyRow>(
        'SELECT id, leader_player_id, mode, invite_code FROM mm_parties WHERE invite_code = ?',
        [code.trim().toUpperCase()]
      );
      if (!party) throw new MatchmakingError(404, 'party_not_found', 'No party with that invite code');
      const current = await this.partyOf(playerId);
      if (current?.id === party.id) return party;
      if (await this.entryOf(party.id)) {
        throw new MatchmakingError(409, 'party_searching', 'That party is searching; ask the leader to stop first');
      }
      const members = await this.members(party.id);
      if (members.length >= TEAM_SIZE[party.mode as MatchmakingMode]) {
        throw new MatchmakingError(409, 'party_full', 'That party is full');
      }
      if (current) await this.leave(playerId, current);
      await db.runAsync('INSERT INTO mm_party_members (party_id, player_id, joined_at) VALUES (?, ?, ?)', [
        party.id,
        playerId,
        this.clock(),
      ]);
      await this.touchParty(party.id);
      return party;
    });
  }

  leaveParty(playerId: string): Promise<void> {
    return this.locked(async () => {
      const party = await this.partyOf(playerId);
      if (party) await this.leave(playerId, party);
    });
  }

  /** The leader leaving disbands the party. Leaving stops a search. Refused while in a lobby. */
  private async leave(playerId: string, party: PartyRow): Promise<void> {
    const entry = await this.entryOf(party.id);
    if (entry?.status === 'found') {
      throw new MatchmakingError(409, 'in_lobby', 'Answer the match first (accept or decline)');
    }
    await this.touchParty(party.id);
    if (party.leader_player_id === playerId) {
      await db.runAsync('DELETE FROM mm_parties WHERE id = ?', [party.id]);
    } else {
      await db.runAsync('DELETE FROM mm_queue_entries WHERE party_id = ?', [party.id]);
      await db.runAsync('DELETE FROM mm_party_members WHERE party_id = ? AND player_id = ?', [party.id, playerId]);
    }
  }

  // --- queue -----------------------------------------------------------

  /** When the player may queue again, or null. */
  async cooldownUntil(playerId: string): Promise<number | null> {
    const row = await db.queryOneAsync<{ until: number | null }>(
      'SELECT MAX(cooldown_until) AS until FROM mm_penalties WHERE player_id = ? AND cleared_by IS NULL',
      [playerId]
    );
    const until = row?.until ? Number(row.until) : null;
    return until && until > this.clock() ? until : null;
  }

  startSearch(playerId: string, mode: unknown = '5v5'): Promise<EntryRow> {
    return this.locked(async () => {
      if (!isMode(mode)) throw new MatchmakingError(400, 'invalid_mode', 'Unknown mode');
      if (!(await this.enabledModes()).includes(mode)) {
        throw new MatchmakingError(409, 'mode_off', `${mode} is not available on this site`);
      }
      const party = (await this.partyOf(playerId)) ?? (await this.newParty(playerId, mode));
      if (party.leader_player_id !== playerId) {
        throw new MatchmakingError(403, 'not_leader', 'Only the party leader can start the search');
      }
      const existing = await this.entryOf(party.id);
      if (existing) return existing;
      const members = await this.members(party.id);
      if (members.length > TEAM_SIZE[mode]) {
        throw new MatchmakingError(409, 'party_too_big', `A ${mode} party has at most ${TEAM_SIZE[mode]} players`);
      }
      for (const member of members) {
        const until = await this.cooldownUntil(member);
        if (until) {
          throw new MatchmakingError(409, 'cooldown', `A party member can search again at ${new Date(until * 1000).toISOString()}`);
        }
      }
      const entry: EntryRow = {
        id: randomUUID(),
        party_id: party.id,
        mode,
        queued_at: this.clock(),
        status: 'searching',
        lobby_id: null,
      };
      await db.runAsync('UPDATE mm_parties SET mode = ? WHERE id = ?', [mode, party.id]);
      await db.runAsync(
        'INSERT INTO mm_queue_entries (id, party_id, mode, queued_at, status) VALUES (?, ?, ?, ?, ?)',
        [entry.id, party.id, mode, entry.queued_at, 'searching']
      );
      await this.touchParty(party.id);
      return entry;
    });
  }

  stopSearch(playerId: string): Promise<void> {
    return this.locked(async () => {
      const party = await this.partyOf(playerId);
      if (!party) return;
      if (party.leader_player_id !== playerId) {
        throw new MatchmakingError(403, 'not_leader', 'Only the party leader can stop the search');
      }
      const entry = await this.entryOf(party.id);
      if (entry?.status === 'found') {
        throw new MatchmakingError(409, 'in_lobby', 'Answer the match first (accept or decline)');
      }
      await db.runAsync('DELETE FROM mm_queue_entries WHERE party_id = ?', [party.id]);
      await this.touchParty(party.id);
    });
  }

  /** The modes players can search now. */
  async enabledModes(): Promise<MatchmakingMode[]> {
    return parseEnabledModes(await db.getAppSettingAsync(MM_MODES));
  }

  // --- the loop --------------------------------------------------------

  /** One pass: end lobbies whose accept time ran out, then form new ones. */
  tick(): Promise<string[]> {
    return this.locked(async () => {
      const expired = await db.queryAsync<LobbyRow>(
        "SELECT * FROM mm_lobbies WHERE status = 'accepting' AND accept_deadline <= ?",
        [this.clock()]
      );
      for (const lobby of expired) await this.resolveTimeout(lobby);

      await this.watchPresence();

      const created: string[] = [];
      for (const mode of MODES) {
        for (;;) {
          const lobbyId = await this.formLobby(mode);
          if (!lobbyId) break;
          created.push(lobbyId);
        }
      }
      return created;
    });
  }

  private async searchingParties(mode: MatchmakingMode): Promise<QueuedParty[]> {
    const entries = await db.queryAsync<EntryRow>(
      "SELECT * FROM mm_queue_entries WHERE mode = ? AND status = 'searching' ORDER BY queued_at, id",
      [mode]
    );
    const parties: QueuedParty[] = [];
    const now = this.clock();
    const window = parseSearchWindow(await db.getAppSettingAsync(MM_SEARCH_WINDOW));
    for (const e of entries) {
      const players = await this.members(e.party_id);
      const ratings = await this.ratingsFor(players, mode);
      const mus = players.map((p) => ratings.get(p)!.mu);
      const queuedAt = Number(e.queued_at);
      parties.push({
        entryId: e.id,
        partyId: e.party_id,
        players,
        queuedAt,
        mus,
        rating: partyRating(mus),
        window: searchWindow(now - queuedAt, window),
      });
    }
    return parties;
  }

  private async formLobby(mode: MatchmakingMode): Promise<string | null> {
    const group = findGroup(await this.searchingParties(mode), TEAM_SIZE[mode]);
    if (!group) return null;
    const teams = splitTeams(group, TEAM_SIZE[mode]);
    if (!teams) return null;
    const lobbyId = randomUUID();
    const now = this.clock();
    await db.runAsync(
      "INSERT INTO mm_lobbies (id, mode, status, accept_deadline, created_at) VALUES (?, ?, 'accepting', ?, ?)",
      [lobbyId, mode, now + ACCEPT_SECONDS, now]
    );
    for (const [index, team] of teams.entries()) {
      for (const party of team) {
        for (const player of party.players) {
          await db.runAsync(
            'INSERT INTO mm_lobby_players (lobby_id, player_id, party_id, team, queued_at) VALUES (?, ?, ?, ?, ?)',
            [lobbyId, player, party.partyId, index + 1, party.queuedAt]
          );
        }
        await db.runAsync("UPDATE mm_queue_entries SET status = 'found', lobby_id = ? WHERE id = ?", [
          lobbyId,
          party.entryId,
        ]);
      }
    }
    this.touch(...group.flatMap((p) => p.players));
    log.info(`[MATCHMAKING] lobby ${lobbyId} (${mode}): ${group.length} parties, waiting for accepts`);
    return lobbyId;
  }

  // --- accept / decline ------------------------------------------------

  private async lobbyFor(playerId: string, lobbyId: string): Promise<{ lobby: LobbyRow; players: LobbyPlayerRow[] }> {
    const lobby = await db.queryOneAsync<LobbyRow>('SELECT * FROM mm_lobbies WHERE id = ?', [lobbyId]);
    const players = lobby
      ? await db.queryAsync<LobbyPlayerRow>('SELECT * FROM mm_lobby_players WHERE lobby_id = ?', [lobbyId])
      : [];
    if (!lobby || !players.some((p) => p.player_id === playerId)) {
      throw new MatchmakingError(404, 'lobby_not_found', 'No such match for you');
    }
    return { lobby, players };
  }

  accept(playerId: string, lobbyId: string): Promise<{ status: string }> {
    return this.locked(async () => {
      const { lobby, players } = await this.lobbyFor(playerId, lobbyId);
      if (lobby.status !== 'accepting' || lobby.accept_deadline <= this.clock()) {
        throw new MatchmakingError(409, 'not_accepting', 'This match is no longer waiting for answers');
      }
      await db.runAsync(
        'UPDATE mm_lobby_players SET accepted_at = ? WHERE lobby_id = ? AND player_id = ? AND accepted_at IS NULL',
        [this.clock(), lobbyId, playerId]
      );
      this.touch(...players.map((p) => p.player_id));
      const others = players.filter((p) => p.player_id !== playerId);
      if (others.every((p) => p.accepted_at !== null)) {
        log.info(`[MATCHMAKING] lobby ${lobbyId}: everyone accepted`);
        try {
          await this.startMatch(lobby, [...others, players.find((p) => p.player_id === playerId)!]);
        } catch (error) {
          // No map pool, no CS2 module, a failed insert: nobody did anything
          // wrong, so no cooldowns; everyone goes back to the front.
          log.error(`[MATCHMAKING] lobby ${lobbyId}: could not create the match`, error as Error);
          await this.cancel(lobbyId, 'match_failed');
          return { status: 'cancelled' };
        }
        await db.runAsync("UPDATE mm_lobbies SET status = 'ready' WHERE id = ?", [lobbyId]);
        await db.runAsync('DELETE FROM mm_queue_entries WHERE lobby_id = ?', [lobbyId]);
        return { status: 'ready' };
      }
      return { status: 'accepting' };
    });
  }

  decline(playerId: string, lobbyId: string): Promise<void> {
    return this.locked(async () => {
      const { lobby, players } = await this.lobbyFor(playerId, lobbyId);
      if (lobby.status !== 'accepting') {
        throw new MatchmakingError(409, 'not_accepting', 'This match is no longer waiting for answers');
      }
      const now = this.clock();
      await db.runAsync('UPDATE mm_lobby_players SET declined_at = ? WHERE lobby_id = ? AND player_id = ?', [
        now,
        lobbyId,
        playerId,
      ]);
      const party = players.find((p) => p.player_id === playerId)!.party_id;
      await this.penalize(playerId, 'decline', lobbyId);
      // The decliner's party leaves the queue; every other party goes back
      // to the front (queued_at is kept), answered or not.
      await db.runAsync('DELETE FROM mm_queue_entries WHERE party_id = ?', [party]);
      await this.cancel(lobbyId, 'declined');
    });
  }

  /**
   * Create the lobby's match: a standalone Bo1 on a random map from the
   * game's matchmaking pool, teams as split, then ask the scheduler to give
   * it a server.
   */
  private async startMatch(lobby: LobbyRow, players: LobbyPlayerRow[]): Promise<void> {
    if (!hasIntegration('cs2')) throw new Error('The CS2 module is not installed');
    const poolId = parseModePools(await db.getAppSettingAsync(MM_MODE_POOLS))[lobby.mode as MatchmakingMode] ?? null;
    const pool = (await getIntegration('cs2').matchmakingMapPool?.(lobby.mode, poolId)) ?? [];
    if (pool.length === 0) throw new Error(`No CS2 maps for ${lobby.mode} matchmaking`);
    const map = pool[randomInt(pool.length)].id;

    const names = new Map(
      (
        await db.queryAsync<{ id: string; name: string | null }>(
          `SELECT id, name FROM players WHERE id IN (${players.map(() => '?').join(', ')})`,
          players.map((p) => p.player_id)
        )
      ).map((r) => [r.id, r.name || r.id])
    );
    const team = (n: number) => {
      const roster = players.filter((p) => p.team === n).map((p) => p.player_id).sort();
      return {
        name: `Team ${names.get(roster[0]) ?? n}`,
        players: Object.fromEntries(roster.map((id) => [id, names.get(id) ?? id])),
      };
    };

    const slug = `mm-${lobby.id.slice(0, 8)}`;
    const teamSize = TEAM_SIZE[lobby.mode as MatchmakingMode];
    await matchService.createMatch(
      {
        slug,
        config: {
          matchid: 0,
          skip_veto: true,
          players_per_team: teamSize,
          team1: team(1),
          team2: team(2),
          num_maps: 1,
          maplist: [map],
          wingman: lobby.mode === '2v2',
        },
      },
      configuredPublicOrigin() ?? '',
      resolveTournamentId()
    );
    await db.runAsync("UPDATE matches SET source = 'matchmaking' WHERE slug = ?", [slug]);
    // The pool as it was, for the map roulette the players see: at most 30
    // maps, the chosen one always among them.
    const chosen = pool.find((m) => m.id === map)!;
    const shown = pool.length <= 30 ? pool : [...pool.filter((m) => m.id !== map).slice(0, 29), chosen];
    await db.runAsync('UPDATE mm_lobbies SET match_slug = ?, map = ?, map_pool = ? WHERE id = ?', [
      slug,
      map,
      JSON.stringify(shown),
      lobby.id,
    ]);
    log.info(`[MATCHMAKING] lobby ${lobby.id}: match ${slug} on ${map}`);

    // Allocation is the scheduler's (manual matches go the same way); it keeps
    // retrying while no server is free.
    const { scheduler } = await import('../../core/scheduler');
    setImmediate(() => {
      void scheduler.tryImmediateAllocation();
    });
  }

  // --- abandons --------------------------------------------------------

  /**
   * Who is missing from a loaded or live matchmaking match. A player who has
   * not been connected for 5 minutes since the server was ready (or since this
   * process started watching) gets an abandon: a cooldown, no XP, and a full
   * loss. One per player per match.
   */
  private async watchPresence(): Promise<void> {
    const rows = await db.queryAsync<{ lobby_id: string; match_slug: string; status: string; loaded_at: number | null }>(
      `SELECT l.id AS lobby_id, l.match_slug, m.status, m.loaded_at
         FROM mm_lobbies l JOIN matches m ON m.slug = l.match_slug
        WHERE l.status = 'ready'`
    );
    const now = this.clock();
    const live = new Set<string>();
    for (const row of rows) {
      if (row.status !== 'loaded' && row.status !== 'live') continue;
      live.add(row.match_slug);
      let watch = this.presence.get(row.match_slug);
      if (!watch) {
        watch = { since: now, lastSeen: new Map() };
        this.presence.set(row.match_slug, watch);
      }
      for (const p of playerConnectionService.getStatus(row.match_slug)?.connectedPlayers ?? []) {
        watch.lastSeen.set(p.steamId, now);
      }
      const players = await db.queryAsync<{ player_id: string }>('SELECT player_id FROM mm_lobby_players WHERE lobby_id = ?', [
        row.lobby_id,
      ]);
      const flagged = new Set(
        (
          await db.queryAsync<{ player_id: string }>(
            "SELECT player_id FROM mm_penalties WHERE lobby_id = ? AND kind = 'abandon'",
            [row.lobby_id]
          )
        ).map((r) => r.player_id)
      );
      for (const { player_id: id } of players) {
        if (flagged.has(id)) continue;
        const gone = isAbandon({
          now,
          serverReadyAt: Number(row.loaded_at ?? now),
          watchingSince: watch.since,
          lastSeen: watch.lastSeen.get(id) ?? null,
        });
        if (gone) {
          await this.penalizeAbandon(id, row.lobby_id);
          log.info(`[MATCHMAKING] ${id} abandoned ${row.match_slug}`);
        }
      }
    }
    for (const slug of [...this.presence.keys()]) if (!live.has(slug)) this.presence.delete(slug);
  }

  private async penalizeAbandon(playerId: string, lobbyId: string): Promise<void> {
    this.touch(playerId);
    const now = this.clock();
    const row = await db.queryOneAsync<{ n: number | string }>(
      "SELECT COUNT(*) AS n FROM mm_penalties WHERE player_id = ? AND kind = 'abandon' AND created_at > ? AND cleared_by IS NULL",
      [playerId, now - ABANDON_WINDOW_SECONDS]
    );
    await db.runAsync(
      "INSERT INTO mm_penalties (player_id, kind, lobby_id, created_at, cooldown_until) VALUES (?, 'abandon', ?, ?, ?)",
      [playerId, lobbyId, now, now + abandonCooldownSeconds(Number(row?.n ?? 0))]
    );
  }

  // --- ratings (phase 2) -----------------------------------------------

  /**
   * Each player's matchmaking rating for `mode`. A player without one gets a
   * seed (not stored until their first rated match): their tournament rating's
   * mu, with a sigma of at least SEED_SIGMA.
   */
  private async ratingsFor(players: string[], mode: string): Promise<Map<string, { mu: number; sigma: number; games: number; wins: number }>> {
    const out = new Map<string, { mu: number; sigma: number; games: number; wins: number }>();
    if (players.length === 0) return out;
    const marks = players.map(() => '?').join(', ');
    const stored = await db.queryAsync<RatingRow>(
      `SELECT player_id, mu, sigma, games, wins FROM mm_ratings WHERE game = 'cs2' AND mode = ? AND player_id IN (${marks})`,
      [mode, ...players]
    );
    for (const r of stored) out.set(r.player_id, { mu: Number(r.mu), sigma: Number(r.sigma), games: Number(r.games), wins: Number(r.wins) });
    const missing = players.filter((p) => !out.has(p));
    if (missing.length > 0) {
      // Seeded from the player's CS2 tournament rating.
      const byId = await getGameRatings(missing, 'cs2');
      for (const p of missing) {
        const b = byId.get(p);
        const mu = b ? b.mu : 25;
        const sigma = Math.max(SEED_SIGMA, b ? b.sigma : DEFAULT_SIGMA);
        out.set(p, { mu, sigma, games: 0, wins: 0 });
      }
    }
    return out;
  }

  /**
   * A matchmaking match ended (core/matchLifecycle, manual-match branch):
   * rate both teams with OpenSkill (a draw is a draw), and close the lobby.
   * A result that arrives twice is rated once.
   */
  applyMatchResult(matchSlug: string, winner: 'team1' | 'team2' | 'none'): Promise<boolean> {
    return this.locked(async () => {
      const lobby = await db.queryOneAsync<LobbyRow>('SELECT * FROM mm_lobbies WHERE match_slug = ?', [matchSlug]);
      if (!lobby) return false;
      const already = await db.queryOneAsync<{ id: number }>('SELECT id FROM mm_rating_history WHERE match_slug = ? LIMIT 1', [
        matchSlug,
      ]);
      if (already) return false;
      const players = await db.queryAsync<LobbyPlayerRow>('SELECT * FROM mm_lobby_players WHERE lobby_id = ?', [lobby.id]);
      const team1 = players.filter((p) => p.team === 1).map((p) => p.player_id).sort();
      const team2 = players.filter((p) => p.team === 2).map((p) => p.player_id).sort();
      const before = await this.ratingsFor([...team1, ...team2], lobby.mode);
      const ranks = winner === 'team1' ? [1, 2] : winner === 'team2' ? [2, 1] : [1, 1];
      const [after1, after2] = osRate(
        [team1.map((p) => osRating(before.get(p)!)), team2.map((p) => osRating(before.get(p)!))],
        { rank: ranks }
      );
      const now = this.clock();
      // Who abandoned: their team's loss is theirs in full, and teammates who
      // stayed lose less (scaled by how many were there).
      const abandoned = new Set(
        (
          await db.queryAsync<{ player_id: string }>(
            "SELECT player_id FROM mm_penalties WHERE lobby_id = ? AND kind = 'abandon'",
            [lobby.id]
          )
        ).map((r) => r.player_id)
      );
      const write = async (ids: string[], after: Array<{ mu: number; sigma: number }>, won: boolean) => {
        const present = ids.filter((id) => !abandoned.has(id)).length;
        for (const [i, id] of ids.entries()) {
          const b = before.get(id)!;
          if (!won && !abandoned.has(id) && present < ids.length && after[i].mu < b.mu) {
            after[i] = { ...after[i], mu: b.mu + (after[i].mu - b.mu) * (present / ids.length) };
          }
          await db.runAsync(
            `INSERT INTO mm_ratings (player_id, game, mode, mu, sigma, games, wins, updated_at)
             VALUES (?, 'cs2', ?, ?, ?, ?, ?, ?)
             ON CONFLICT (player_id, game, mode) DO UPDATE SET mu = EXCLUDED.mu, sigma = EXCLUDED.sigma,
               games = EXCLUDED.games, wins = EXCLUDED.wins, updated_at = EXCLUDED.updated_at`,
            [id, lobby.mode, after[i].mu, after[i].sigma, b.games + 1, b.wins + (won ? 1 : 0), now]
          );
          await db.runAsync(
            `INSERT INTO mm_rating_history (player_id, game, mode, match_slug, mu_before, sigma_before, mu_after, sigma_after, created_at)
             VALUES (?, 'cs2', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (player_id, match_slug) DO NOTHING`,
            [id, lobby.mode, matchSlug, b.mu, b.sigma, after[i].mu, after[i].sigma, now]
          );
        }
      };
      await write(team1, after1, winner === 'team1');
      await write(team2, after2, winner === 'team2');
      await db.runAsync("UPDATE mm_lobbies SET status = 'finished' WHERE id = ?", [lobby.id]);
      this.touch(...players.map((p) => p.player_id));
      await progressionService.awardMatchXp(matchSlug, winner, abandoned);
      log.info(`[MATCHMAKING] ${matchSlug} rated (${winner === 'none' ? 'draw' : `${winner} won`})`);
      return true;
    });
  }

  /** Time ran out: who did not answer gets a no-show; parties that all accepted go back to the front. */
  private async resolveTimeout(lobby: LobbyRow): Promise<void> {
    const players = await db.queryAsync<LobbyPlayerRow>('SELECT * FROM mm_lobby_players WHERE lobby_id = ?', [
      lobby.id,
    ]);
    const silentParties = new Set<string>();
    for (const p of players) {
      if (p.accepted_at === null) {
        silentParties.add(p.party_id);
        await this.penalize(p.player_id, 'no_show', lobby.id);
      }
    }
    for (const party of silentParties) await db.runAsync('DELETE FROM mm_queue_entries WHERE party_id = ?', [party]);
    await this.cancel(lobby.id, 'timeout');
  }

  private async cancel(lobbyId: string, reason: string): Promise<void> {
    const affected = await db.queryAsync<{ player_id: string }>('SELECT player_id FROM mm_lobby_players WHERE lobby_id = ?', [lobbyId]);
    this.touch(...affected.map((p) => p.player_id));
    await db.runAsync("UPDATE mm_lobbies SET status = 'cancelled', cancel_reason = ? WHERE id = ?", [reason, lobbyId]);
    await db.runAsync("UPDATE mm_queue_entries SET status = 'searching', lobby_id = NULL WHERE lobby_id = ?", [lobbyId]);
    log.info(`[MATCHMAKING] lobby ${lobbyId} cancelled (${reason})`);
  }

  private async penalize(playerId: string, kind: 'decline' | 'no_show', lobbyId: string): Promise<void> {
    this.touch(playerId);
    const now = this.clock();
    const row = await db.queryOneAsync<{ n: number | string }>(
      'SELECT COUNT(*) AS n FROM mm_penalties WHERE player_id = ? AND created_at > ? AND cleared_by IS NULL',
      [playerId, now - OFFENCE_WINDOW_SECONDS]
    );
    const until = now + cooldownSeconds(Number(row?.n ?? 0));
    await db.runAsync(
      'INSERT INTO mm_penalties (player_id, kind, lobby_id, created_at, cooldown_until) VALUES (?, ?, ?, ?, ?)',
      [playerId, kind, lobbyId, now, until]
    );
  }

  /** Admin: lift a player's cooldowns. */
  clearCooldown(playerId: string, admin: string): Promise<number> {
    return this.locked(async () => {
      this.touch(playerId);
      const res = await db.runAsync(
        'UPDATE mm_penalties SET cleared_by = ? WHERE player_id = ? AND cleared_by IS NULL',
        [admin, playerId]
      );
      return res.changes ?? 0;
    });
  }

  // --- reading ---------------------------------------------------------

  async me(playerId: string): Promise<MatchmakingMe> {
    const party = await this.partyOf(playerId);
    const members = party ? await this.members(party.id) : [];
    const entry = party ? await this.entryOf(party.id) : undefined;
    let lobby: MatchmakingMe['lobby'] = null;
    const lobbyRow = await db.queryOneAsync<LobbyRow & { team: number; accepted_at: number | null }>(
      `SELECT l.*, lp.team, lp.accepted_at FROM mm_lobbies l
         JOIN mm_lobby_players lp ON lp.lobby_id = l.id
        WHERE lp.player_id = ? AND l.status IN ('accepting', 'ready')
        ORDER BY l.created_at DESC LIMIT 1`,
      [playerId]
    );
    if (lobbyRow) {
      const counts = await db.queryOneAsync<{ total: number | string; accepted: number | string }>(
        'SELECT COUNT(*) AS total, COUNT(accepted_at) AS accepted FROM mm_lobby_players WHERE lobby_id = ?',
        [lobbyRow.id]
      );
      lobby = {
        id: lobbyRow.id,
        status: lobbyRow.status,
        acceptDeadline: Number(lobbyRow.accept_deadline),
        matchSlug: (lobbyRow as LobbyRow & { match_slug?: string | null }).match_slug ?? null,
        map: (lobbyRow as LobbyRow & { map?: string | null }).map ?? null,
        accepted: Number(counts?.accepted ?? 0),
        total: Number(counts?.total ?? 0),
        youAccepted: lobbyRow.accepted_at !== null,
        team: Number(lobbyRow.team),
      };
    }
    return {
      party: party
        ? {
            id: party.id,
            leader: party.leader_player_id,
            mode: party.mode,
            inviteCode: party.invite_code,
            members,
            people: await this.people(members),
          }
        : null,
      queueCounts: await this.queueCounts(),
      queue: entry ? { mode: entry.mode, queuedAt: Number(entry.queued_at), status: entry.status } : null,
      lobby,
      cooldownUntil: await this.cooldownUntil(playerId),
      rating: await this.ratingSummary(playerId, entry?.mode ?? party?.mode ?? '5v5'),
      modes: await this.enabledModes(),
      online: onlinePlayerCount(),
      waitSeconds: await this.waitEstimates(),
      modeRules: await this.modeRules(),
    };
  }

  /**
   * The median wait from searching to a match found, per mode, over the last
   * week's lobbies. One sample per party, so a full party counts once.
   */
  private async waitEstimates(): Promise<Record<string, number | null>> {
    const since = this.clock() - 7 * 24 * 3600;
    const rows = await db.queryAsync<{ mode: string; waited: number | string }>(
      `SELECT DISTINCT ON (l.id, p.party_id) l.mode, (l.created_at - p.queued_at) AS waited
         FROM mm_lobbies l JOIN mm_lobby_players p ON p.lobby_id = l.id
        WHERE l.created_at >= ? AND p.queued_at IS NOT NULL`,
      [since]
    );
    const byMode = new Map<string, number[]>();
    for (const r of rows) {
      byMode.set(r.mode, [...(byMode.get(r.mode) ?? []), Math.max(0, Number(r.waited))]);
    }
    const out: Record<string, number | null> = {};
    for (const mode of MODES) {
      const waits = (byMode.get(mode) ?? []).sort((x, y) => x - y);
      out[mode] = waits.length >= MIN_WAIT_SAMPLES ? waits[Math.floor(waits.length / 2)] : null;
    }
    return out;
  }

  /** Rounds per half and the map pool's name per mode, for the mode cards. */
  private async modeRules(): Promise<Record<string, { maxRounds: number; pool: string | null }>> {
    const chosen = parseModePools(await db.getAppSettingAsync(MM_MODE_POOLS));
    const pools = hasIntegration('cs2') ? ((await getIntegration('cs2').matchmakingPools?.()) ?? []) : [];
    const name = (id: number | undefined) => (id ? (pools.find((p) => p.id === id)?.name ?? null) : null);
    return Object.fromEntries(MODES.map((mode) => [mode, { maxRounds: MODE_MAX_ROUNDS[mode], pool: name(chosen[mode]) }]));
  }

  private async people(ids: string[]): Promise<Array<{ id: string; name: string; avatarUrl: string | null }>> {
    if (ids.length === 0) return [];
    const rows = await db.queryAsync<{ id: string; name: string | null; avatar_url: string | null }>(
      `SELECT id, name, avatar_url FROM players WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => ({ id, name: byId.get(id)?.name || id, avatarUrl: byId.get(id)?.avatar_url ?? null }));
  }

  private async queueCounts(): Promise<Record<string, number>> {
    const rows = await db.queryAsync<{ mode: string; n: number | string }>(
      `SELECT e.mode, COUNT(m.player_id) AS n FROM mm_queue_entries e
         JOIN mm_party_members m ON m.party_id = e.party_id
        WHERE e.status = 'searching' GROUP BY e.mode`
    );
    return Object.fromEntries(rows.map((r) => [r.mode, Number(r.n)]));
  }

  private async ratingSummary(playerId: string, mode: string): Promise<MatchmakingMe['rating']> {
    const row = await db.queryOneAsync<RatingRow>(
      "SELECT player_id, mu, sigma, games, wins FROM mm_ratings WHERE player_id = ? AND game = 'cs2' AND mode = ?",
      [playerId, mode]
    );
    if (!row) return null;
    return {
      elo: openSkillToDisplayElo(osRating({ mu: Number(row.mu), sigma: Number(row.sigma) })),
      games: Number(row.games),
      wins: Number(row.wins),
    };
  }

  /** The match room: teams with names, map and the match, for a player in the lobby. */
  async lobbyView(playerId: string, lobbyId: string): Promise<{
    id: string;
    status: string;
    mode: string;
    map: string | null;
    matchSlug: string | null;
    matchStatus: string | null;
    /** The maps the roulette rolls over; `map` is one of them. */
    mapPool: Array<{ id: string; name: string; imageUrl: string | null }>;
    teams: Array<{
      team: number;
      /** The side this team starts on, from the match config; null for a knife round or before the match exists. */
      startSide: 'CT' | 'T' | null;
      players: Array<{ id: string; name: string; avatarUrl: string | null; accepted: boolean; inServer: boolean }>;
    }>;
    /** Players on the server right now, of `total`. */
    inServer: number;
    total: number;
    /** Minutes a loaded match waits in warmup before it starts anyway (0 = until everyone is in). */
    autostartMinutes: number;
  }> {
    const { lobby, players } = await this.lobbyFor(playerId, lobbyId);
    const row = lobby as LobbyRow & { map: string | null; match_slug: string | null; map_pool: string | null };
    let mapPool: Array<{ id: string; name: string; imageUrl: string | null }> = [];
    try {
      mapPool = row.map_pool ? JSON.parse(row.map_pool) : [];
    } catch {
      mapPool = [];
    }
    const names = await db.queryAsync<{ id: string; name: string | null; avatar_url: string | null }>(
      `SELECT id, name, avatar_url FROM players WHERE id IN (${players.map(() => '?').join(', ')})`,
      players.map((p) => p.player_id)
    );
    const nameOf = new Map(names.map((n) => [n.id, n.name || n.id]));
    const avatarOf = new Map(names.map((n) => [n.id, n.avatar_url]));
    const match = row.match_slug
      ? await db.queryOneAsync<{ status: string; config: string | null }>('SELECT status, config FROM matches WHERE slug = ?', [row.match_slug])
      : undefined;
    // Who is on the server (the game reports joins), and the sides from the match config.
    const connected = new Set(
      (row.match_slug ? playerConnectionService.getStatus(row.match_slug)?.connectedPlayers ?? [] : []).map((c) => c.steamId)
    );
    let team1Side: 'CT' | 'T' | null = null;
    try {
      const sides = match?.config ? (JSON.parse(match.config) as { map_sides?: string[] }).map_sides : undefined;
      team1Side = sides?.[0] === 'team1_ct' ? 'CT' : sides?.[0] === 'team2_ct' ? 'T' : null;
    } catch {
      team1Side = null;
    }
    const sideOf = (team: number): 'CT' | 'T' | null =>
      team1Side === null ? null : team === 1 ? team1Side : team1Side === 'CT' ? 'T' : 'CT';
    const autostartRaw = Number(await settingsService.getSetting('at_autostart_after_minutes').catch(() => null));
    const autostartMinutes = Number.isInteger(autostartRaw) && autostartRaw > 0 ? Math.min(autostartRaw, 120) : 0;
    return {
      id: lobby.id,
      status: lobby.status,
      mode: lobby.mode,
      map: row.map ?? null,
      matchSlug: row.match_slug ?? null,
      matchStatus: match?.status ?? null,
      mapPool,
      teams: [1, 2].map((team) => ({
        team,
        startSide: sideOf(team),
        players: players
          .filter((p) => p.team === team)
          .map((p) => ({
            id: p.player_id,
            name: nameOf.get(p.player_id) ?? p.player_id,
            avatarUrl: avatarOf.get(p.player_id) ?? null,
            accepted: p.accepted_at !== null,
            inServer: connected.has(p.player_id),
          })),
      })),
      inServer: players.filter((p) => connected.has(p.player_id)).length,
      total: players.length,
      autostartMinutes,
    };
  }

  /** Admin: who is searching, open lobbies, and penalties of the last 24 h. */
  async adminQueue(): Promise<{
    searching: Array<{ partyId: string; mode: string; waited: number; players: Array<{ id: string; name: string }> }>;
    lobbies: Array<{ id: string; mode: string; status: string; matchSlug: string | null; map: string | null; accepted: number; total: number; createdAt: number }>;
    penalties: Array<{ id: number; playerId: string; name: string; kind: string; cooldownUntil: number; createdAt: number; cleared: boolean }>;
  }> {
    const now = this.clock();
    const nameOf = async (ids: string[]) => {
      if (ids.length === 0) return new Map<string, string>();
      const rows = await db.queryAsync<{ id: string; name: string | null }>(
        `SELECT id, name FROM players WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids
      );
      return new Map(rows.map((r) => [r.id, r.name || r.id]));
    };
    const entries = await db.queryAsync<EntryRow>("SELECT * FROM mm_queue_entries WHERE status = 'searching' ORDER BY queued_at");
    const searching = [];
    for (const e of entries) {
      const ids = await this.members(e.party_id);
      const names = await nameOf(ids);
      searching.push({
        partyId: e.party_id,
        mode: e.mode,
        waited: now - Number(e.queued_at),
        players: ids.map((id) => ({ id, name: names.get(id) ?? id })),
      });
    }
    const lobbyRows = await db.queryAsync<LobbyRow & { match_slug: string | null; map: string | null; created_at: number }>(
      "SELECT * FROM mm_lobbies WHERE status IN ('accepting', 'ready') ORDER BY created_at DESC LIMIT 50"
    );
    const lobbies = [];
    for (const l of lobbyRows) {
      const c = await db.queryOneAsync<{ total: number | string; accepted: number | string }>(
        'SELECT COUNT(*) AS total, COUNT(accepted_at) AS accepted FROM mm_lobby_players WHERE lobby_id = ?',
        [l.id]
      );
      lobbies.push({
        id: l.id,
        mode: l.mode,
        status: l.status,
        matchSlug: l.match_slug,
        map: l.map,
        accepted: Number(c?.accepted ?? 0),
        total: Number(c?.total ?? 0),
        createdAt: Number(l.created_at),
      });
    }
    const pen = await db.queryAsync<{ id: number; player_id: string; kind: string; cooldown_until: number; created_at: number; cleared_by: string | null }>(
      'SELECT id, player_id, kind, cooldown_until, created_at, cleared_by FROM mm_penalties WHERE created_at > ? ORDER BY created_at DESC LIMIT 100',
      [now - 86400]
    );
    const penNames = await nameOf([...new Set(pen.map((p) => p.player_id))]);
    return {
      searching,
      lobbies,
      penalties: pen.map((p) => ({
        id: Number(p.id),
        playerId: p.player_id,
        name: penNames.get(p.player_id) ?? p.player_id,
        kind: p.kind,
        cooldownUntil: Number(p.cooldown_until),
        createdAt: Number(p.created_at),
        cleared: p.cleared_by !== null,
      })),
    };
  }

  /**
   * How many free servers a tournament match must leave for matchmaking right
   * now: the admin's number while someone is searching,
   * answering or waiting for a server; else 0.
   */
  async serversReservedForMatchmaking(): Promise<number> {
    const reserved = parseReservedServers(await db.getAppSettingAsync(MM_RESERVED_SERVERS));
    if (reserved === 0) return 0;
    const waiting = await db.queryOneAsync<{ n: number | string }>(
      `SELECT (SELECT COUNT(*) FROM mm_queue_entries)
            + (SELECT COUNT(*) FROM mm_lobbies l JOIN matches m ON m.slug = l.match_slug
                WHERE l.status = 'ready' AND m.status = 'ready' AND (m.server_id IS NULL OR m.server_id = '')) AS n`
    );
    return Number(waiting?.n ?? 0) > 0 ? reserved : 0;
  }

  // --- lifecycle -------------------------------------------------------

  /** Boot: lobbies left accepting by a restart are cancelled without penalty; then the loop starts. */
  async start(): Promise<void> {
    await this.locked(async () => {
      const open = await db.queryAsync<{ id: string }>("SELECT id FROM mm_lobbies WHERE status = 'accepting'");
      for (const lobby of open) await this.cancel(lobby.id, 'restart');
    });
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => log.warn('[MATCHMAKING] loop failed', { error: (error as Error).message }));
    }, LOOP_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const matchmakingService = new MatchmakingService();
