/**
 * Matchmaking rules with no database: cooldowns, who gets matched together,
 * and how a found group is split into two teams (docs/design/matchmaking.md,
 * phase 1). Kept pure so it is tested on its own.
 */
import { randomInt } from 'crypto';

export type MatchmakingMode = '5v5';

/** Players per team for each mode. Wingman (2v2) comes after 3.1. */
export const TEAM_SIZE: Record<MatchmakingMode, number> = { '5v5': 5 };

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
