/**
 * The Auto Tournament CS2 match config (`matchConfig.ts`, what the plugin
 * downloads) as a Ready Up `match.assign.config` (FLEET.md §7.1, Ready Up's
 * docs/fleet-step3-platform-notes.md §4, schema
 * `protocol/v1/match.defs.json#/$defs/assignConfig`).
 *
 * Pure: no database, so it can be tested on its own. The fleet driver
 * (./driver.ts) reads the config the same way the plugin's config route
 * serves it and passes the admin's server defaults in.
 *
 * What goes where:
 * - teams: players (steamId -> name) become `{steamid64, name, role:
 *   'player'}`, coaches `role: 'coach'`; spectators and admins are lists of
 *   SteamID64 strings. Ids that are not SteamID64 strings are dropped.
 * - maps: `maplist` with `map_sides` (the veto's `team1_ct` / `team2_ct`,
 *   else `knife`).
 * - `rules` replaces what the plugin took as `maxRounds`, `overtimeMode` /
 *   `overtimeSegments` and the `at_*` cvars (ready, knife side pick, pauses,
 *   .gg, forfeit, demo recording).
 * - `cvars`: engine cvars only (`mp_*`, `sv_*`, `tv_*`, `bot_*`); Ready Up
 *   drops anything else, and `sv_password` / `sv_cheats` never go.
 * - `password`: generated per assignment by the driver.
 */

import { randomBytes } from 'crypto';
import type { MatchConfig, MatchPlayer, MatchTeam } from '../../../types/match.types';
import type {
  AssignConfig,
  AssignPlayer,
  AssignTeam,
  MapSides,
  MatchRules,
  MatchUpdateOp,
  PlayerRole,
} from './protocol/v1';

/** The admin's server defaults that have a `rules` field (Settings → Auto Tournament CS2). */
export interface AssignDefaults {
  allowForceReady?: boolean;
  pauseAfterRestore?: boolean;
  /**
   * The server streams its demos over the link (`demo.stream.v1`, received by
   * ./demoStream.ts): `rules.demo.upload` follows `record`. Otherwise false.
   */
  demoUpload?: boolean;
}

export class AssignConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssignConfigError';
  }
}

const U64 = /^[0-9]{1,20}$/;
const MAP_NAME = /^(ws:[0-9]{1,20}|[A-Za-z0-9_./-]+)$/;
const ENGINE_CVAR = /^(mp|sv|tv|bot)_[A-Za-z0-9_]+$/;
const NEVER_SENT_CVARS = new Set(['sv_password', 'sv_cheats', 'rcon_password', 'sv_setsteamaccount']);
/** printable ASCII without space, quotes, backslash or `;` (match.defs.json#/$defs/password). */
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * A connect password: 10 characters from an unambiguous alphabet (no 0/O,
 * 1/l/I), so it can be read off a screen. `random` is injectable for tests.
 */
export function generateMatchPassword(
  random: (n: number) => Uint8Array = defaultRandom,
  length = 10
): string {
  const bytes = random(length * 2);
  let out = '';
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    // Rejection sampling keeps the alphabet uniform.
    const b = bytes[i];
    if (b >= 256 - (256 % PASSWORD_CHARS.length)) continue;
    out += PASSWORD_CHARS[b % PASSWORD_CHARS.length];
  }
  return out.length === length ? out : generateMatchPassword(random, length);
}

function defaultRandom(n: number): Uint8Array {
  return randomBytes(n);
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t === '' ? undefined : t.slice(0, max);
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function flag(value: unknown): boolean | undefined {
  const n = num(value);
  return n === undefined ? undefined : n !== 0;
}

function players(map: MatchPlayer | null | undefined, role: PlayerRole): AssignPlayer[] {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .filter(([steamId]) => U64.test(steamId))
    .map(([steamId, name]) => ({
      steamid64: steamId,
      name: (typeof name === 'string' && name.trim() ? name.trim() : steamId).slice(0, 128),
      role,
    }));
}

function team(value: MatchTeam | undefined, fallbackName: string): AssignTeam {
  // Substitutes are in `players` too (MatchTeam.substitutes): they keep role `sub`.
  const subs = new Set(players(value?.substitutes ?? undefined, 'sub').map((p) => p.steamid64));
  const roster = players(value?.players, 'player').map((p) =>
    subs.has(p.steamid64) ? { ...p, role: 'sub' as PlayerRole } : p
  );
  for (const sub of players(value?.substitutes ?? undefined, 'sub')) {
    if (!roster.some((p) => p.steamid64 === sub.steamid64)) roster.push(sub);
  }
  const seen = new Set(roster.map((p) => p.steamid64));
  for (const coach of players(value?.coaches ?? undefined, 'coach')) {
    if (!seen.has(coach.steamid64)) roster.push(coach);
  }
  const out: AssignTeam = {
    name: clampText(value?.name, 64) ?? fallbackName,
    players: roster.slice(0, 32),
  };
  const id = value?.id !== undefined && value?.id !== null ? String(value.id).slice(0, 64) : undefined;
  if (id) out.id = id;
  const tag = clampText(value?.tag, 16);
  if (tag) out.tag = tag;
  const f = clampText(value?.flag, 8);
  if (f) out.flag = f;
  return out;
}

function mapSides(value: unknown): MapSides {
  return value === 'team1_ct' || value === 'team2_ct' ? value : 'knife';
}

/** The `rules` block from the plugin's round-limit fields and `at_*` cvars. */
export function rulesFromMatchConfig(config: MatchConfig, defaults: AssignDefaults = {}): MatchRules {
  const cvars = config.cvars ?? {};
  const rules: MatchRules = {};

  const maxRounds = num(config.maxRounds) ?? num(cvars.mp_maxrounds);
  if (maxRounds !== undefined && maxRounds >= 1) rules.max_rounds = Math.floor(maxRounds);

  if (config.overtimeMode === 'disabled') {
    rules.overtime = { enabled: false };
  } else if (config.overtimeMode === 'enabled') {
    const segments = num(config.overtimeSegments);
    rules.overtime = {
      enabled: true,
      max_overtimes: segments !== undefined && segments > 0 ? Math.floor(segments) : -1,
    };
  }

  const ready: NonNullable<MatchRules['ready']> = {};
  const minReady = num(config.min_players_to_ready);
  if (minReady !== undefined && minReady >= 0) ready.min_per_team = Math.floor(minReady);
  if (defaults.allowForceReady !== undefined) ready.allow_force_ready = defaults.allowForceReady;
  const autoready = flag(cvars.at_autoready_enabled);
  if (autoready !== undefined) ready.autoready = autoready;
  if (Object.keys(ready).length) rules.ready = ready;

  if (flag(cvars.at_side_selection_enabled) !== false) {
    const seconds = num(cvars.at_side_selection_time);
    if (seconds !== undefined) {
      rules.knife = { side_pick_seconds: Math.min(300, Math.max(5, Math.floor(seconds))) };
    }
  }

  const pause: NonNullable<MatchRules['pause']> = {};
  const tactical = num(cvars.at_max_pauses_per_team);
  // The plugin's 0 means unlimited; Ready Up's default is the same, so leave it out.
  if (tactical !== undefined && tactical > 0) pause.tactical_per_team = Math.floor(tactical);
  const tacticalSeconds = num(cvars.at_pause_duration);
  if (tacticalSeconds !== undefined && tacticalSeconds > 0) pause.tactical_seconds = Math.floor(tacticalSeconds);
  const bothTeams = flag(cvars.at_both_teams_unpause_required);
  if (bothTeams !== undefined) pause.unpause = bothTeams ? 'both_teams' : 'caller_team';
  if (defaults.pauseAfterRestore !== undefined) pause.pause_after_restore = defaults.pauseAfterRestore;
  if (Object.keys(pause).length) rules.pause = pause;

  // The roster is enforced for tournament matches (the plugin's get5_check_auths).
  rules.whitelist = true;

  const forfeit: NonNullable<MatchRules['forfeit']> = {};
  const ffw = flag(cvars.at_ffw_enabled);
  if (ffw !== undefined) {
    const seconds = num(cvars.at_ffw_time);
    forfeit.team_absent_seconds = ffw && seconds !== undefined && seconds > 0 ? Math.floor(seconds) : 0;
  }
  const gg = flag(cvars.at_gg_enabled);
  if (gg !== undefined) {
    const ggVote: NonNullable<NonNullable<MatchRules['forfeit']>['gg_vote']> = { enabled: gg };
    const threshold = num(cvars.at_gg_threshold);
    if (threshold !== undefined) ggVote.threshold = threshold;
    const diff = num(cvars.at_gg_min_score_diff);
    if (diff !== undefined && diff >= 0) ggVote.min_score_diff = Math.floor(diff);
    forfeit.gg_vote = ggVote;
  }
  if (Object.keys(forfeit).length) rules.forfeit = forfeit;

  // Demos: recorded unless the match turns it off; uploaded (streamed over
  // the link, FLEET.md §12.2) when the server can.
  const record = flag(cvars.at_demo_recording_enabled) !== false;
  rules.demo = { record, upload: record && defaults.demoUpload === true };

  if (config.wingman === true) rules.wingman = true;
  if (config.simulation === true) {
    const timescale = num(config.simulation_timescale);
    rules.simulation = { timescale: timescale !== undefined && timescale > 0 ? timescale : 1 };
  }
  return rules;
}

/** Engine cvars only (see the top of this file). */
export function engineCvars(
  cvars: MatchConfig['cvars'] | undefined
): Record<string, string | number | boolean> | undefined {
  if (!cvars) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(cvars)) {
    if (!ENGINE_CVAR.test(key) || NEVER_SENT_CVARS.has(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    out[key] = value;
    if (Object.keys(out).length >= 128) break;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * `match.assign.config` for a match. Throws `AssignConfigError` when the
 * match cannot be played yet (no maps: the veto is not done).
 */
export function buildAssignConfig(
  config: MatchConfig,
  password: string,
  defaults: AssignDefaults = {}
): AssignConfig {
  const maplist = Array.isArray(config.maplist) ? config.maplist.filter((m) => typeof m === 'string' && m) : [];
  if (maplist.length === 0) {
    throw new AssignConfigError('The match has no maps yet (is the veto finished?)');
  }
  const bad = maplist.find((m) => !MAP_NAME.test(m));
  if (bad) throw new AssignConfigError(`Map name "${bad}" cannot be sent to Ready Up`);

  const requested = num(config.num_maps);
  const numMaps = Math.min(9, Math.max(1, requested !== undefined ? Math.floor(requested) : maplist.length));
  if (maplist.length < numMaps) {
    throw new AssignConfigError(`The match needs ${numMaps} maps and has ${maplist.length}`);
  }
  const sides = Array.isArray(config.map_sides) ? config.map_sides : [];
  const maps = maplist.slice(0, numMaps).map((name, i) => ({
    number: i + 1,
    name,
    sides: mapSides(sides[i]),
  }));

  const out: AssignConfig = {
    num_maps: numMaps,
    maps,
    team1: team(config.team1, 'Team 1'),
    team2: team(config.team2, 'Team 2'),
    password,
    rules: rulesFromMatchConfig(config, defaults),
  };
  const spectators = Object.keys(config.spectators?.players ?? {}).filter((id) => U64.test(id));
  if (spectators.length) out.spectators = spectators.slice(0, 64);
  const admins = (config.admins ?? []).filter((id) => typeof id === 'string' && U64.test(id));
  if (admins.length) out.admins = [...new Set(admins)].slice(0, 64);
  const cvars = engineCvars(config.cvars);
  if (cvars) out.cvars = cvars;
  return out;
}

function rosterOf(config: Pick<AssignConfig, 'team1' | 'team2' | 'spectators'>): Map<string, { team: 'team1' | 'team2' | 'spectator'; player: AssignPlayer }> {
  const out = new Map<string, { team: 'team1' | 'team2' | 'spectator'; player: AssignPlayer }>();
  for (const team of ['team1', 'team2'] as const) {
    for (const player of config[team].players) out.set(player.steamid64, { team, player });
  }
  for (const id of config.spectators ?? []) {
    if (!out.has(id)) out.set(id, { team: 'spectator', player: { steamid64: id, name: id } });
  }
  return out;
}

function roleOf(player: AssignPlayer): PlayerRole {
  return player.role ?? 'player';
}

/** The ops that turn `from` into `to`: team names, players in and out (a moved player is removed, then added). */
export function diffAssignConfig(
  from: Pick<AssignConfig, 'team1' | 'team2' | 'spectators'>,
  to: Pick<AssignConfig, 'team1' | 'team2' | 'spectators'>
): MatchUpdateOp[] {
  const ops: MatchUpdateOp[] = [];
  for (const team of ['team1', 'team2'] as const) {
    if (from[team].name !== to[team].name) ops.push({ op: 'rename_team', team, name: to[team].name });
  }
  const before = rosterOf(from);
  const after = rosterOf(to);
  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now || now.team !== was.team) ops.push({ op: 'remove_player', steamid64: id });
  }
  for (const [id, now] of after) {
    const was = before.get(id);
    // A role change (player <-> sub) is a remove and an add, like a move.
    if (was && was.team === now.team && roleOf(was.player) !== roleOf(now.player)) {
      ops.push({ op: 'remove_player', steamid64: id });
    }
    if (!was || was.team !== now.team || roleOf(was.player) !== roleOf(now.player)) {
      ops.push({
        op: 'add_player',
        team: now.team,
        steamid64: id,
        name: now.player.name,
        ...(now.player.role ? { role: now.player.role } : {}),
      });
    }
  }
  return ops;
}
