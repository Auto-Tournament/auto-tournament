/**
 * `match.update` (FLEET.md §7.3, §9.3): roster and team-name changes to a
 * match a Ready Up server is running, compare-and-set on `config_rev`.
 *
 * - The base is the live record's `configRev` (what the server last
 *   reported; `beginAssignment` starts it, every `match.update` answer moves
 *   it). The UI sends the rev it looked at, and a platform that has moved on
 *   since answers `stale` without sending anything.
 * - The server applies all ops or none: `ok` with the new rev, or `rejected
 *   conflict` with its own rev (the foundation stores it as the new base, so
 *   the admin reviews the roster and sends again).
 * - On `ok`, the stored match config (`matches.config`) follows, so a
 *   failover re-assign carries the new roster and names.
 *
 * One update per match at a time in this process, so two admins cannot send
 * two updates from the same base.
 */

import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import { awaitCommandResult, sendReliable, type FleetCommandRecord } from '../reliable';
import { listCommands } from '../commands';
import { liveStateStore, type LiveMatchRecord } from '../state';
import type { MatchState, MatchUpdateOp, MatchUpdatePayload, PlayerRole } from '../protocol/v1';
import { isSteam64 } from './admins';
import { fleetBus } from '../service';

/** The ops the admin UI sends (set_password / set_rules stay with the driver). */
export type RosterOp = Extract<
  MatchUpdateOp,
  { op: 'add_player' | 'remove_player' | 'rename_team' }
>;

const ROLES: ReadonlySet<string> = new Set(['player', 'sub', 'coach']);
const MAX_OPS = 64;

export function validateRosterOps(
  input: unknown
): { ok: true; ops: RosterOp[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0)
    return { ok: false, error: 'ops must be a non-empty array' };
  if (input.length > MAX_OPS) return { ok: false, error: `at most ${MAX_OPS} ops` };
  const ops: RosterOp[] = [];
  for (const [i, raw] of input.entries()) {
    const o = raw as Record<string, unknown>;
    const where = `ops[${i}]`;
    if (!o || typeof o !== 'object') return { ok: false, error: `${where} must be an object` };
    if (o.op === 'add_player') {
      if (o.team !== 'team1' && o.team !== 'team2' && o.team !== 'spectator') {
        return { ok: false, error: `${where}.team must be team1, team2 or spectator` };
      }
      if (!isSteam64(o.steamid64))
        return { ok: false, error: `${where}.steamid64 must be a SteamID64` };
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      if (!name || name.length > 128)
        return { ok: false, error: `${where}.name must be 1-128 characters` };
      if (o.role !== undefined && (typeof o.role !== 'string' || !ROLES.has(o.role))) {
        return { ok: false, error: `${where}.role must be player, sub or coach` };
      }
      ops.push({
        op: 'add_player',
        team: o.team,
        steamid64: o.steamid64,
        name,
        ...(o.role !== undefined ? { role: o.role as PlayerRole } : {}),
      });
    } else if (o.op === 'remove_player') {
      if (!isSteam64(o.steamid64))
        return { ok: false, error: `${where}.steamid64 must be a SteamID64` };
      ops.push({ op: 'remove_player', steamid64: o.steamid64 });
    } else if (o.op === 'rename_team') {
      if (o.team !== 'team1' && o.team !== 'team2')
        return { ok: false, error: `${where}.team must be team1 or team2` };
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      if (!name || name.length > 64)
        return { ok: false, error: `${where}.name must be 1-64 characters` };
      ops.push({ op: 'rename_team', team: o.team, name });
    } else {
      return { ok: false, error: `${where}.op must be add_player, remove_player or rename_team` };
    }
  }
  return { ok: true, ops };
}

interface StoredTeam {
  name?: string;
  players?: Record<string, string> | Array<{ steamid?: string; steamId?: string; name?: string }>;
  [k: string]: unknown;
}
interface StoredConfig {
  team1?: StoredTeam;
  team2?: StoredTeam;
  spectators?: { players?: Record<string, string> };
  [k: string]: unknown;
}

function playerMap(players: StoredTeam['players']): Record<string, string> {
  if (!players) return {};
  if (Array.isArray(players)) {
    const out: Record<string, string> = {};
    for (const p of players) {
      const id = p.steamid ?? p.steamId;
      if (id) out[id] = p.name ?? id;
    }
    return out;
  }
  return { ...players };
}

/**
 * The stored match config after `ops` (pure): the MatchConfig shape, players
 * as `{steamid: name}`. A player added to one side is removed from the others.
 */
export function applyOpsToMatchConfig<T extends StoredConfig>(
  config: T,
  ops: ReadonlyArray<RosterOp>
): T {
  const next = JSON.parse(JSON.stringify(config ?? {})) as T;
  const team1 = (next.team1 ??= { name: 'Team 1', players: {} }) as StoredTeam;
  const team2 = (next.team2 ??= { name: 'Team 2', players: {} }) as StoredTeam;
  const spectators = (next.spectators ??= { players: {} });
  team1.players = playerMap(team1.players);
  team2.players = playerMap(team2.players);
  spectators.players = { ...(spectators.players ?? {}) };
  const sides = [team1.players, team2.players, spectators.players] as Record<string, string>[];
  for (const op of ops) {
    if (op.op === 'remove_player' || op.op === 'add_player') {
      for (const side of sides) delete side[op.steamid64];
    }
    if (op.op === 'add_player') {
      const target = op.team === 'team1' ? sides[0] : op.team === 'team2' ? sides[1] : sides[2];
      target[op.steamid64] = op.name;
    } else if (op.op === 'rename_team') {
      (op.team === 'team1' ? team1 : team2).name = op.name;
    }
  }
  return next;
}

export interface RosterPlayer {
  steamid64: string;
  name: string;
  role: PlayerRole | null;
  connected: boolean | null;
}

export interface RosterView {
  team1: { name: string; players: RosterPlayer[] };
  team2: { name: string; players: RosterPlayer[] };
  spectators: RosterPlayer[];
  /** Where it came from: the server's live MatchState, or the stored config (no snapshot yet). */
  source: 'live' | 'config';
}

/** The roster the admin edits: the live state when there is one, else the stored config (pure). */
export function rosterView(state: MatchState | null, config: StoredConfig | null): RosterView {
  if (state?.teams) {
    const team = (key: 'team1' | 'team2') => ({
      name: state.teams[key]?.name ?? key,
      players: Object.entries(state.teams[key]?.players ?? {}).map(([id, p]) => ({
        steamid64: id,
        name: p.name ?? id,
        role: p.role ?? 'player',
        connected: p.connected ?? false,
      })),
    });
    return {
      team1: team('team1'),
      team2: team('team2'),
      spectators: Object.entries(state.spectators ?? {}).map(([id, p]) => ({
        steamid64: id,
        name: p.name ?? id,
        role: null,
        connected: p.connected ?? false,
      })),
      source: 'live',
    };
  }
  const fromMap = (m: Record<string, string>) =>
    Object.entries(m).map(([id, name]) => ({
      steamid64: id,
      name: name || id,
      role: null,
      connected: null,
    }));
  return {
    team1: {
      name: config?.team1?.name ?? 'Team 1',
      players: fromMap(playerMap(config?.team1?.players)),
    },
    team2: {
      name: config?.team2?.name ?? 'Team 2',
      players: fromMap(playerMap(config?.team2?.players)),
    },
    spectators: fromMap(config?.spectators?.players ?? {}),
    source: 'config',
  };
}

async function storedConfig(slug: string): Promise<StoredConfig | null> {
  const row = await db.queryOneAsync<{ config: string | null }>(
    'SELECT config FROM matches WHERE slug = ?',
    [slug]
  );
  if (!row?.config) return null;
  try {
    return JSON.parse(row.config) as StoredConfig;
  } catch {
    return null;
  }
}

async function saveStoredConfig(slug: string, ops: RosterOp[]): Promise<boolean> {
  const config = await storedConfig(slug);
  if (!config) return false;
  const next = applyOpsToMatchConfig(config, ops);
  await db.runAsync('UPDATE matches SET config = ? WHERE slug = ?', [JSON.stringify(next), slug]);
  return true;
}

/**
 * Updates sent and not yet answered: whoever sees the `ok` first (the request
 * waiting on it, or the `cmd.result` hook for an answer that came after the
 * request gave up) writes the stored config, once.
 */
const unanswered = new Map<string, { slug: string; ops: RosterOp[] }>();

/** Write the stored config for an answered update, if nobody did yet. */
export async function applyAnsweredUpdate(commandId: string, status: string): Promise<boolean> {
  const pending = unanswered.get(commandId);
  if (!pending) return false;
  unanswered.delete(commandId);
  if (status !== 'ok') return false;
  try {
    return await saveStoredConfig(pending.slug, pending.ops);
  } catch (error) {
    log.warn(
      `[FLEET] ${pending.slug}: stored config not updated after match.update: ${(error as Error).message}`
    );
    return false;
  }
}

/** A fleet match: the live record names a server holding a current epoch. */
function isFleetRecord(
  record: LiveMatchRecord | null
): record is LiveMatchRecord & { serverId: string } {
  return !!record && !!record.serverId && record.epoch >= 1;
}

export interface MatchRosterInfo {
  fleet: boolean;
  serverId: string | null;
  online: boolean;
  epoch: number;
  configRev: number;
  roster: RosterView | null;
  /** The last match.update messages of this match, newest first. */
  updates: FleetCommandRecord[];
}

export async function getMatchRoster(slug: string): Promise<MatchRosterInfo> {
  const record = await liveStateStore.getLiveState(slug);
  if (!isFleetRecord(record)) {
    return {
      fleet: false,
      serverId: null,
      online: false,
      epoch: 0,
      configRev: 0,
      roster: null,
      updates: [],
    };
  }
  const [config, commands] = await Promise.all([storedConfig(slug), listCommands(slug, 50)]);
  return {
    fleet: true,
    serverId: record.serverId,
    online: fleetBus().isConnected(record.serverId),
    epoch: record.epoch,
    configRev: record.configRev,
    roster: rosterView(record.state, config),
    updates: commands.filter((c) => c.type === 'match.update').slice(0, 10),
  };
}

export type MatchUpdateOutcome =
  | { kind: 'not_fleet' }
  /** The platform's base moved since the admin looked. Nothing was sent. */
  | { kind: 'stale'; configRev: number }
  | { kind: 'answered'; command: FleetCommandRecord; configRev: number; configSaved: boolean }
  /** Sent (or queued for an offline server), no answer yet. */
  | { kind: 'pending'; commandId: string; delivered: boolean };

const locks = new Map<string, Promise<unknown>>();
function perMatch<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(slug) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(slug, tail);
  void tail.then(() => {
    if (locks.get(slug) === tail) locks.delete(slug);
  });
  return run;
}

export function sendMatchUpdate(
  slug: string,
  ops: RosterOp[],
  opts: { baseConfigRev?: number; timeoutMs?: number } = {}
): Promise<MatchUpdateOutcome> {
  return perMatch(slug, async () => {
    const record = await liveStateStore.getLiveState(slug);
    if (!isFleetRecord(record)) return { kind: 'not_fleet' } as const;
    const base = record.configRev;
    if (opts.baseConfigRev !== undefined && opts.baseConfigRev !== base)
      return { kind: 'stale', configRev: base } as const;
    const payload: MatchUpdatePayload = {
      match_id: slug,
      epoch: record.epoch,
      base_config_rev: base,
      config_rev: base + 1,
      ops,
    };
    const sent = await sendReliable(record.serverId, { type: 'match.update', payload });
    unanswered.set(sent.id, { slug, ops });
    const answer = await awaitCommandResult(sent.id, opts.timeoutMs ?? 10_000);
    if (!answer) return { kind: 'pending', commandId: sent.id, delivered: sent.delivered } as const;
    const rev = typeof answer.result?.rev === 'number' ? answer.result.rev : base;
    // The inbound path stores the rev too; this makes it visible before we answer.
    if (typeof answer.result?.rev === 'number') await liveStateStore.setConfigRev(slug, rev);
    const configSaved = await applyAnsweredUpdate(sent.id, answer.status);
    if (answer.status === 'ok') {
      log.info(
        `[FLEET] ${slug}: match.update ok, config_rev ${base} -> ${rev} (${ops.length} op(s))`
      );
    }
    return { kind: 'answered', command: answer, configRev: rev, configSaved } as const;
  });
}
