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
    const picked = pickExact(ordered.slice(anchor + 1), need - ordered[anchor].players.length);
    if (picked) {
      const group = [ordered[anchor], ...picked];
      if (splitTeams(group, teamSize)) return group;
    }
  }
  return null;
}

/** Oldest-first subset of `candidates` with exactly `need` players (backtracking; queues are small). */
function pickExact(candidates: QueuedParty[], need: number): QueuedParty[] | null {
  if (need === 0) return [];
  for (let i = 0; i < candidates.length; i++) {
    const size = candidates[i].players.length;
    if (size > need) continue;
    const rest = pickExact(candidates.slice(i + 1), need - size);
    if (rest) return [candidates[i], ...rest];
  }
  return null;
}

/**
 * Split a group into two teams of `teamSize`, parties kept whole. Phase 1 has
 * no ratings: the split is random among the valid ones (`random` is
 * injectable for tests). Returns null when parties can't be split evenly
 * (for example a 4-stack and a 3-stack in 5v5 with only three solos).
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

  const mask = splits[Math.min(splits.length - 1, Math.floor(random() * splits.length))];
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
