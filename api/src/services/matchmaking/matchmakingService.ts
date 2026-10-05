/**
 * Matchmaking phase 1 (docs/design/matchmaking.md): parties, the queue, the
 * matching loop and accept / decline with cooldowns. A lobby whose players
 * all accepted ends as `ready`; creating and allocating its match is the next
 * step (phase 1b).
 *
 * The queue lives in the database, so a restart loses nothing; lobbies that
 * were still accepting are cancelled without penalty and their parties go
 * back to searching. Every change runs through one in-process lock, so the
 * loop and the API never interleave.
 */
import { randomUUID } from 'crypto';
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { isExperimentalFeatureEnabled } from '../experimentalFeatures';
import {
  ACCEPT_SECONDS,
  cooldownSeconds,
  findGroup,
  inviteCode,
  isMode,
  MODES,
  OFFENCE_WINDOW_SECONDS,
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
  party: { id: string; leader: string; mode: string; inviteCode: string; members: string[] } | null;
  queue: { mode: string; queuedAt: number; status: string } | null;
  lobby: {
    id: string;
    status: string;
    acceptDeadline: number;
    accepted: number;
    total: number;
    youAccepted: boolean;
    team: number;
  } | null;
  cooldownUntil: number | null;
}

const LOOP_MS = 2000;

export class MatchmakingService {
  private chain: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly clock: () => number = () => Math.floor(Date.now() / 1000)) {}

  /** Run `fn` after every change before it: the loop and the API never interleave. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
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
    });
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
    for (const e of entries) {
      parties.push({ entryId: e.id, partyId: e.party_id, players: await this.members(e.party_id), queuedAt: Number(e.queued_at) });
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
            'INSERT INTO mm_lobby_players (lobby_id, player_id, party_id, team) VALUES (?, ?, ?, ?)',
            [lobbyId, player, party.partyId, index + 1]
          );
        }
        await db.runAsync("UPDATE mm_queue_entries SET status = 'found', lobby_id = ? WHERE id = ?", [
          lobbyId,
          party.entryId,
        ]);
      }
    }
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
      const others = players.filter((p) => p.player_id !== playerId);
      if (others.every((p) => p.accepted_at !== null)) {
        await db.runAsync("UPDATE mm_lobbies SET status = 'ready' WHERE id = ?", [lobbyId]);
        await db.runAsync('DELETE FROM mm_queue_entries WHERE lobby_id = ?', [lobbyId]);
        log.info(`[MATCHMAKING] lobby ${lobbyId}: everyone accepted`);
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
    await db.runAsync("UPDATE mm_lobbies SET status = 'cancelled', cancel_reason = ? WHERE id = ?", [reason, lobbyId]);
    await db.runAsync("UPDATE mm_queue_entries SET status = 'searching', lobby_id = NULL WHERE lobby_id = ?", [lobbyId]);
    log.info(`[MATCHMAKING] lobby ${lobbyId} cancelled (${reason})`);
  }

  private async penalize(playerId: string, kind: 'decline' | 'no_show', lobbyId: string): Promise<void> {
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
            members: await this.members(party.id),
          }
        : null,
      queue: entry ? { mode: entry.mode, queuedAt: Number(entry.queued_at), status: entry.status } : null,
      lobby,
      cooldownUntil: await this.cooldownUntil(playerId),
    };
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
      void isExperimentalFeatureEnabled('matchmaking')
        .then((on) => (on ? this.tick() : undefined))
        .catch((error) => log.warn('[MATCHMAKING] loop failed', { error: (error as Error).message }));
    }, LOOP_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const matchmakingService = new MatchmakingService();
