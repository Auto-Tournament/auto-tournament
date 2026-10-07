/**
 * Matchmaking rules with no database: cooldowns, who gets matched together,
 * and how a found group is split into two teams (docs/design/matchmaking.md,
 * phase 1). Kept pure so it is tested on its own.
 */
import { randomInt } from 'crypto';

export type MatchmakingMode = '5v5' | '2v2' | '1v1';

/**
 * Players per team for each mode. 2v2 is wingman (CS2's wingman rules and
 * maps). 2v2 and 1v1 are off unless an admin turns them on (`mm_modes`); 1v1
 * is an aim duel, and the way to test matchmaking with two accounts.
 */
export const TEAM_SIZE: Record<MatchmakingMode, number> = { '5v5': 5, '2v2': 2, '1v1': 1 };

/** The admin's map pool per mode (`mm_mode_pools`, JSON `{ mode: poolId }`); unknown modes and bad ids dropped. */
export function parseModePools(raw: unknown): Partial<Record<MatchmakingMode, number>> {
  let v: unknown = raw;
  try {
    if (typeof raw === 'string') v = JSON.parse(raw);
  } catch {
    v = null;
  }
  const out: Partial<Record<MatchmakingMode, number>> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [mode, id] of Object.entries(v as Record<string, unknown>)) {
    if (isMode(mode) && typeof id === 'number' && Number.isInteger(id) && id > 0) out[mode] = id;
  }
  return out;
}

/** Modes on when the admin never chose (`mm_modes` unset). */
export const DEFAULT_MODES: MatchmakingMode[] = Object.keys(TEAM_SIZE) as MatchmakingMode[];

/** The admin's modes (`mm_modes`, a JSON array); anything unknown is dropped, nothing left = the default. */
export function parseEnabledModes(raw: unknown): MatchmakingMode[] {
  let v: unknown = raw;
  try {
    if (typeof raw === 'string') v = JSON.parse(raw);
  } catch {
    v = null;
  }
  const modes = Array.isArray(v) ? [...new Set(v.filter((m): m is MatchmakingMode => isMode(m)))] : [];
  return modes.length > 0 ? modes : DEFAULT_MODES;
}

export const MODES = Object.keys(TEAM_SIZE) as MatchmakingMode[];

export function isMode(value: unknown): value is MatchmakingMode {
  return typeof value === 'string' && (MODES as string[]).includes(value);
}

/** Seconds to accept a found match. */
export const ACCEPT_SECONDS = 20;

/** The cooldown ladder for a decline or no-show: 2 min, 10 min, 1 h, 24 h. */
export const COOLDOWN_LADDER_SECONDS = [2 * 60, 10 * 60, 60 * 60, 24 * 60 * 60] as const;

/** Offences count toward the ladder for this long; a clean day resets it. */
export const OFFENCE_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * The cooldown for a new offence, given how many the player already had in
 * the last 24 hours (not counting this one).
 */
export function cooldownSeconds(previousOffencesIn24h: number): number {
  const step = Math.max(0, Math.floor(previousOffencesIn24h));
  return COOLDOWN_LADDER_SECONDS[Math.min(step, COOLDOWN_LADDER_SECONDS.length - 1)];
}

/** Abandons (left or never joined): 1 h, doubling for each one in the last 7 days, at most 7 days. */
export const ABANDON_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const ABANDON_BASE_SECONDS = 60 * 60;

export function abandonCooldownSeconds(previousAbandonsIn7d: number): number {
  const n = Math.max(0, Math.floor(previousAbandonsIn7d));
  return Math.min(ABANDON_WINDOW_SECONDS, ABANDON_BASE_SECONDS * 2 ** Math.min(n, 10));
}

/** How long a player may be missing from a match before it counts as an abandon. */
export const ABANDON_GRACE_SECONDS = 5 * 60;

/**
 * Presence rule for one player of a matchmaking match, from what the watcher
 * saw. `serverReadyAt`: when the match was loaded on the server.
 * `watchingSince`: when the watcher started seeing this match (a restart
 * forgets who was connected, so nobody is judged on time it did not see).
 */
export function isAbandon(input: {
  now: number;
  serverReadyAt: number;
  watchingSince: number;
  /** Last time the player was seen connected; null = never. */
  lastSeen: number | null;
}): boolean {
  const from = Math.max(input.serverReadyAt, input.watchingSince);
  if (input.now - from < ABANDON_GRACE_SECONDS) return false;
  if (input.lastSeen === null) return true;
  return input.now - input.lastSeen >= ABANDON_GRACE_SECONDS;
}

/** A party waiting in the queue. */
export interface QueuedParty {
  entryId: string;
  partyId: string;
  /** Player ids in the party (1 to team size). */
  players: string[];
  /** Epoch seconds; kept when a party is put back at the front. */
  queuedAt: number;
  /** Each player's matchmaking mu, same order as `players` (phase 2). Omitted: no ratings. */
  mus?: number[];
  /** The party's rating for matching (`partyRating`). */
  rating?: number;
  /** How far from `rating` this party accepts others, in mu (`searchWindow`). */
  window?: number;
}

// --- ratings (phase 2) -------------------------------------------------
//
// Matching uses OpenSkill mu (the design's "for finding fair games, it uses
// mu"). One display Elo point is 1/200 mu (utils/ratingMath ELO_SCALE).

/** Display Elo to mu. */
export const ELO_PER_MU = 200;

export interface SearchWindowSettings {
  /** Display Elo at the start of the search. */
  start: number;
  /** Display Elo added every `everySeconds`. */
  step: number;
  everySeconds: number;
  /** Display Elo cap while waiting less than `uncappedAfterSeconds`. */
  cap: number;
  /** After this long in the queue, any rating is accepted. */
  uncappedAfterSeconds: number;
}

export const DEFAULT_SEARCH_WINDOW: SearchWindowSettings = {
  start: 100,
  step: 50,
  everySeconds: 30,
  cap: 400,
  uncappedAfterSeconds: 5 * 60,
};

/**
 * The admin's search window (Settings -> Matchmaking), as stored in
 * `mm_search_window`: display Elo, and minutes until any rating is accepted
 * (null = never). Anything missing or out of range falls back to the default.
 */
export function parseSearchWindow(raw: unknown): SearchWindowSettings {
  let v: Record<string, unknown> = {};
  try {
    v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  } catch {
    v = {};
  }
  if (!v || typeof v !== 'object') v = {};
  const num = (x: unknown, min: number, max: number, fallback: number) =>
    typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? Math.round(x) : fallback;
  const d = DEFAULT_SEARCH_WINDOW;
  const start = num(v.start, 0, 2000, d.start);
  const step = num(v.step, 0, 1000, d.step);
  const cap = Math.max(start, num(v.cap, 0, 5000, d.cap));
  const minutes = v.uncappedAfterMinutes === null ? null : num(v.uncappedAfterMinutes, 1, 120, d.uncappedAfterSeconds / 60);
  return {
    start,
    step,
    everySeconds: d.everySeconds,
    cap,
    uncappedAfterSeconds: minutes === null ? Number.POSITIVE_INFINITY : minutes * 60,
  };
}

/** Validate an admin's new search window; null when it is not valid. */
export function validateSearchWindow(
  input: unknown
): { start: number; step: number; cap: number; uncappedAfterMinutes: number | null } | null {
  const v = (input ?? {}) as Record<string, unknown>;
  const int = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
  if (!int(v.start, 0, 2000) || !int(v.step, 0, 1000) || !int(v.cap, 0, 5000)) return null;
  if ((v.cap as number) < (v.start as number)) return null;
  if (v.uncappedAfterMinutes !== null && !int(v.uncappedAfterMinutes, 1, 120)) return null;
  return {
    start: v.start as number,
    step: v.step as number,
    cap: v.cap as number,
    uncappedAfterMinutes: v.uncappedAfterMinutes as number | null,
  };
}

/** The search window in mu after `waitedSeconds` in the queue (Infinity = any rating). */
export function searchWindow(waitedSeconds: number, s: SearchWindowSettings = DEFAULT_SEARCH_WINDOW): number {
  const waited = Math.max(0, waitedSeconds);
  if (waited >= s.uncappedAfterSeconds) return Number.POSITIVE_INFINITY;
  const elo = Math.min(s.cap, s.start + Math.floor(waited / s.everySeconds) * s.step);
  return elo / ELO_PER_MU;
}

/** Display Elo a party pays per extra member (decided 2026-09-29: "a small premium"). */
export const PARTY_PREMIUM_ELO = 20;

/**
 * A party's rating: leans towards its best player so a strong player can't
 * carry a weak friend into low games (`0.7 × average + 0.3 × max`), plus a
 * small premium per extra member for playing together.
 */
export function partyRating(mus: number[]): number {
  if (mus.length === 0) return 0;
  const avg = mus.reduce((a, b) => a + b, 0) / mus.length;
  const max = Math.max(...mus);
  return 0.7 * avg + 0.3 * max + ((mus.length - 1) * PARTY_PREMIUM_ELO) / ELO_PER_MU;
}

/** Two parties may meet when each is inside the other's window. */
function compatible(a: QueuedParty, b: QueuedParty): boolean {
  if (a.rating === undefined || b.rating === undefined) return true;
  const gap = Math.abs(a.rating - b.rating);
  return gap <= (a.window ?? Number.POSITIVE_INFINITY) && gap <= (b.window ?? Number.POSITIVE_INFINITY);
}

/**
 * Pick one group that fills a match exactly (2 × team size players), never
 * splitting a party. Greedy and fair to the longest wait: the oldest entry is
 * the anchor, then others are added oldest first; if no exact fill exists for
 * that anchor, the next oldest is tried. Returns null when nothing fits.
 */
export function findGroup(queue: QueuedParty[], teamSize: number): QueuedParty[] | null {
  const need = teamSize * 2;
  const ordered = [...queue]
    .filter((p) => p.players.length > 0 && p.players.length <= teamSize)
    .sort((a, b) => a.queuedAt - b.queuedAt || a.entryId.localeCompare(b.entryId));

  for (let anchor = 0; anchor < ordered.length; anchor++) {
    const picked = pickExact(ordered.slice(anchor + 1), need - ordered[anchor].players.length, [ordered[anchor]]);
    if (picked) {
      const group = [ordered[anchor], ...picked];
      if (splitTeams(group, teamSize)) return group;
    }
  }
  return null;
}

/**
 * Oldest-first subset of `candidates` with exactly `need` players, each
 * compatible with every party already `chosen` (backtracking; queues are small).
 */
function pickExact(candidates: QueuedParty[], need: number, chosen: QueuedParty[]): QueuedParty[] | null {
  if (need === 0) return [];
  for (let i = 0; i < candidates.length; i++) {
    const size = candidates[i].players.length;
    if (size > need || !chosen.every((c) => compatible(c, candidates[i]))) continue;
    const rest = pickExact(candidates.slice(i + 1), need - size, [...chosen, candidates[i]]);
    if (rest) return [candidates[i], ...rest];
  }
  return null;
}

/**
 * Split a group into two teams of `teamSize`, parties kept whole. With
 * ratings (`mus` on every party) it is the fairest split: the smallest gap in
 * total mu, then in the strongest player per team, ties broken at random.
 * Without, random among the valid ones (`random` is injectable for tests).
 * Returns null when parties can't be split evenly (for example a 4-stack and
 * a 3-stack in 5v5 with only three solos).
 */
export function splitTeams(
  group: QueuedParty[],
  teamSize: number,
  random: () => number = Math.random
): [QueuedParty[], QueuedParty[]] | null {
  const total = group.reduce((n, p) => n + p.players.length, 0);
  if (total !== teamSize * 2) return null;

  const splits: number[] = [];
  const count = group.length;
  // Party 0 always goes to team 1, so mirrored splits are counted once.
  for (let mask = 0; mask < 1 << count; mask++) {
    if (!(mask & 1)) continue;
    let size = 0;
    for (let i = 0; i < count; i++) if (mask & (1 << i)) size += group[i].players.length;
    if (size === teamSize) splits.push(mask);
  }
  if (splits.length === 0) return null;

  let candidates = splits;
  if (group.every((p) => p.mus && p.mus.length === p.players.length)) {
    const score = (mask: number): [number, number] => {
      const side = (inTeam1: boolean) => group.filter((_, i) => !!(mask & (1 << i)) === inTeam1).flatMap((p) => p.mus!);
      const a = side(true);
      const b = side(false);
      const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
      return [Math.abs(sum(a) - sum(b)), Math.abs(Math.max(...a) - Math.max(...b))];
    };
    const scored = splits.map((mask) => ({ mask, s: score(mask) }));
    const EPS = 1e-9;
    const bestTotal = Math.min(...scored.map((x) => x.s[0]));
    const byTotal = scored.filter((x) => x.s[0] <= bestTotal + EPS);
    const bestTop = Math.min(...byTotal.map((x) => x.s[1]));
    candidates = byTotal.filter((x) => x.s[1] <= bestTop + EPS).map((x) => x.mask);
  }

  const mask = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  const team1 = group.filter((_, i) => mask & (1 << i));
  const team2 = group.filter((_, i) => !(mask & (1 << i)));
  return random() < 0.5 ? [team1, team2] : [team2, team1];
}

/**
 * A party invite code: 10 characters from 32 without lookalikes (50 bits).
 * It is the only thing that lets someone join a party, so it comes from the
 * crypto RNG.
 */
export function inviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 10; i++) code += alphabet[randomInt(alphabet.length)];
  return code;
}

/**
 * Free servers a tournament match may take while matchmaking is in use:
 * tournaments go first, but `reserved` servers stay free for matchmaking
 * (decided 2026-09-29). Only while matchmaking has players waiting, so
 * nothing is held back for nobody.
 */
export function freeForTournament(free: number, reserved: number, matchmakingWaiting: boolean): number {
  if (!matchmakingWaiting || reserved <= 0) return free;
  return Math.max(0, free - reserved);
}

/** The admin's "servers kept free for matchmaking": a whole number 0-50, else 0. */
export function parseReservedServers(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 50 ? n : 0;
}
