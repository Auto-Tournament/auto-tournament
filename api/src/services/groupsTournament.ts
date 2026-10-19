/**
 * Groups, then playoffs (tournament type `groups`): the teams are split into
 * 2–4 groups that each play a round robin, then the best of each group play
 * single or double elimination.
 *
 * Settings (`tournament.settings`):
 * - `groupCount` 2–4 (default 2)
 * - `advancePerGroup` 1 or 2 (default 1): who goes through from each group
 * - `groupSeeding` 'snake' (by the team order, which is the seeding) or 'random'
 * - `playoffType` 'single_elimination' (default) or 'double_elimination'
 * - `playoffFormat` 'bo1' | 'bo3' | 'bo5' (default: the tournament's format)
 *
 * Rows:
 * - group matches: slug `g{a..d}-r{round}m{n}`, `bracket` 'GA'…'GD', from round 1.
 * - playoffs: slug `po-…` (the elimination generator's slugs), rounds after the
 *   last group round, created with the tournament as empty slots. A round-one
 *   slot carries `team1_seed` / `team2_seed` (1…N): which qualifier goes there.
 *   When every group match is over, advanceGroupsTournament fills them.
 *
 * Qualifiers: `advancePerGroup` from each group, topped up to a power of two
 * with the best of the rest (3 groups: the 3 winners and the best runner-up).
 * Pairs put a team against another group's, the strongest against the weakest.
 * Ties in a group: as round robin (wins, head-to-head, round difference, rounds won).
 */
import { randomInt } from 'crypto';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { computeRoundRobinStandings, type RoundRobinStanding } from '../utils/roundRobinStandings';
import { loadSwissMatches, parseTeamIds, toSwissMatch } from './swissProgressionService';
import { standardBracketGenerator } from './standardBracketGenerator';
import { buildMatchConfigFor, serializeMatchConfig } from '../utils/matchIntegration';
import { tournamentRowToResponse } from '../utils/tournamentRow';
import { emitBracketUpdate } from './socketService';
import type { BracketGeneratorResult, IBracketGenerator } from './bracketGenerators/types';
import type { TournamentResponse } from '../types/tournament.types';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import type { Untrusted } from '../utils/untrusted';

export const GROUP_LETTERS = ['A', 'B', 'C', 'D'] as const;

export interface GroupsSettings {
  groupCount: number;
  advancePerGroup: number;
  groupSeeding: 'snake' | 'random';
  playoffType: 'single_elimination' | 'double_elimination';
  playoffFormat: 'bo1' | 'bo3' | 'bo5';
}

export function groupsSettingsOf(tournament: {
  settings?: Untrusted;
  format?: string;
}): GroupsSettings {
  const s = (tournament.settings ?? {}) as Record<string, Untrusted>;
  const n = Number(s.groupCount);
  const fmt = (v: Untrusted) => (v === 'bo1' || v === 'bo3' || v === 'bo5' ? v : null);
  return {
    groupCount: Number.isInteger(n) && n >= 2 && n <= 4 ? n : 2,
    advancePerGroup: Number(s.advancePerGroup) === 2 ? 2 : 1,
    groupSeeding: s.groupSeeding === 'random' ? 'random' : 'snake',
    playoffType:
      s.playoffType === 'double_elimination' ? 'double_elimination' : 'single_elimination',
    playoffFormat: fmt(s.playoffFormat) ?? fmt(tournament.format) ?? 'bo3',
  };
}

/** Checks a groups tournament's settings and team count; an error message, or null. */
export function groupsError(settings: Untrusted, teamCount: number): string | null {
  const s = (settings ?? {}) as Record<string, Untrusted>;
  if (s.groupCount !== undefined && ![2, 3, 4].includes(Number(s.groupCount)))
    return 'settings.groupCount must be 2, 3 or 4';
  if (s.advancePerGroup !== undefined && ![1, 2].includes(Number(s.advancePerGroup)))
    return 'settings.advancePerGroup must be 1 or 2';
  const g = groupsSettingsOf({ settings });
  if (teamCount > 0 && teamCount < g.groupCount * 2)
    return `${g.groupCount} groups need at least ${g.groupCount * 2} teams`;
  if (teamCount > 0 && Math.floor(teamCount / g.groupCount) <= g.advancePerGroup)
    return 'Each group needs more teams than go through';
  return null;
}

/** Powers of two up from `n` (at least 2). */
export function playoffSize(groupCount: number, advancePerGroup: number): number {
  let size = 2;
  while (size < groupCount * advancePerGroup) size *= 2;
  return size;
}

/** The teams in each group: snake by seed (1 A, 2 B, 3 B, 4 A …), or at random (pure but for `random`). */
export function drawGroups(
  teamIds: string[],
  groupCount: number,
  method: 'snake' | 'random'
): string[][] {
  const order = [...teamIds];
  if (method === 'random') {
    for (let i = order.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  order.forEach((id, i) => {
    const lap = Math.floor(i / groupCount);
    const pos = i % groupCount;
    groups[lap % 2 === 0 ? pos : groupCount - 1 - pos].push(id);
  });
  return groups;
}

/** A group's letter from its matches' `bracket` ('GA' → 'A'), or null. */
export function groupOf(bracket: string | null | undefined): string | null {
  return bracket && /^G[A-D]$/.test(bracket) ? bracket[1] : null;
}

type Slot = BracketGeneratorResult['matches'][number];

class GroupsBracketGenerator implements IBracketGenerator {
  async generate(tournament: TournamentResponse): Promise<BracketGeneratorResult> {
    const g = groupsSettingsOf(tournament);
    const groups = drawGroups(tournament.teamIds, g.groupCount, g.groupSeeding);
    const matches: Slot[] = [];
    let lastGroupRound = 0;
    for (const [i, teamIds] of groups.entries()) {
      const letter = GROUP_LETTERS[i];
      // The generator keeps the last bracket it made: start each group afresh.
      standardBracketGenerator.reset?.();
      const rr = await standardBracketGenerator.generate({
        ...tournament,
        type: 'round_robin',
        teamIds,
      });
      for (const m of rr.matches) {
        lastGroupRound = Math.max(lastGroupRound, m.round);
        matches.push({
          ...m,
          slug: `g${letter.toLowerCase()}-${m.slug}`,
          bracket: `G${letter}` as Slot['bracket'],
        });
      }
    }
    // The playoffs: the elimination generator's slots with stand-in seeds, the teams left empty.
    const size = playoffSize(g.groupCount, g.advancePerGroup);
    const seeds = Array.from({ length: size }, (_, i) => `__seed${i + 1}`);
    standardBracketGenerator.reset?.();
    const po = await standardBracketGenerator.generate({
      ...tournament,
      type: g.playoffType,
      format: g.playoffFormat,
      teamIds: seeds,
    });
    const seedOf = (id: string | null) =>
      id && id.startsWith('__seed') ? Number(id.slice(6)) : null;
    const prefix = (slug: string | null | undefined) => (slug ? `po-${slug}` : slug);
    for (const m of po.matches) {
      matches.push({
        ...m,
        slug: `po-${m.slug}`,
        round: m.round + lastGroupRound,
        team1Id: null,
        team2Id: null,
        winnerId: null,
        status: 'pending',
        team1Seed: seedOf(m.team1Id),
        team2Seed: seedOf(m.team2Id),
        team1FromMatchSlug: prefix(m.team1FromMatchSlug) ?? null,
        team2FromMatchSlug: prefix(m.team2FromMatchSlug) ?? null,
        format: g.playoffFormat,
      });
    }
    return { matches };
  }
}

export const groupsBracketGenerator = new GroupsBracketGenerator();

export interface GroupStanding extends RoundRobinStanding {
  rank: number;
}

/** Each group's standings, best first (from the stored matches). */
export async function groupStandings(
  tournamentId: number
): Promise<Array<{ group: string; standings: GroupStanding[]; done: boolean }>> {
  const tournament = await db.queryOneAsync<DbTournamentRow>(
    'SELECT * FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (!tournament) return [];
  const seedOrder = parseTeamIds(tournament.team_ids);
  const rows = await loadSwissMatches(tournamentId);
  const out: Array<{ group: string; standings: GroupStanding[]; done: boolean }> = [];
  for (const letter of GROUP_LETTERS) {
    const mine = rows.filter((r) => groupOf(r.bracket) === letter);
    if (mine.length === 0) continue;
    const teams = new Set<string>();
    for (const r of mine) {
      if (r.team1_id) teams.add(r.team1_id);
      if (r.team2_id) teams.add(r.team2_id);
    }
    const teamIds = seedOrder.filter((id) => teams.has(id));
    const standings = computeRoundRobinStandings(teamIds, mine.map(toSwissMatch)).map((s, i) => ({
      ...s,
      rank: i + 1,
    }));
    out.push({ group: letter, standings, done: mine.every((r) => r.status === 'completed') });
  }
  return out;
}

/** The qualifiers in seed order (pairs: 1 v 2, 3 v 4 …), from finished groups (pure). */
export function seedPlayoffs(
  groups: Array<{ group: string; standings: RoundRobinStanding[] }>,
  advancePerGroup: number,
  size: number
): string[] {
  const strength = (s: RoundRobinStanding) => [s.wins, s.roundDiff, s.roundsWon];
  const better = (a: RoundRobinStanding, b: RoundRobinStanding) => {
    const x = strength(a);
    const y = strength(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return 0;
  };
  type Q = { teamId: string; group: string; place: number; s: RoundRobinStanding };
  const all: Q[] = groups.flatMap((g) =>
    g.standings.map((s, i) => ({ teamId: s.teamId, group: g.group, place: i + 1, s }))
  );
  // Through: the top `advancePerGroup` of each group, then the best of the rest to fill the bracket.
  const through = all.filter((q) => q.place <= advancePerGroup);
  const rest = all
    .filter((q) => q.place > advancePerGroup)
    .sort((a, b) => a.place - b.place || better(a.s, b.s));
  while (through.length < size && rest.length) through.push(rest.shift()!);
  // Strongest first: by place in the group, then record.
  const ranked = [...through].sort((a, b) => a.place - b.place || better(a.s, b.s));
  const out: string[] = [];
  const left = [...ranked];
  while (left.length) {
    const top = left.shift()!;
    // The weakest left from another group, else the weakest left.
    let idx = -1;
    for (let i = left.length - 1; i >= 0; i--) {
      if (left[i].group !== top.group) {
        idx = i;
        break;
      }
    }
    if (idx === -1) idx = left.length - 1;
    const [other] = left.splice(idx, 1);
    out.push(top.teamId, other ? other.teamId : '');
  }
  // Pairs of group winners go to opposite halves: interleave the pairs (1st, 3rd, … then 2nd, 4th, …).
  const pairs: string[][] = [];
  for (let i = 0; i < out.length; i += 2) pairs.push([out[i], out[i + 1]]);
  // Halves of the bracket: 1st and 2nd pair apart (4 pairs: 1 4 | 2 3).
  const ordered = pairs.length === 4 ? [pairs[0], pairs[3], pairs[1], pairs[2]] : pairs;
  return ordered.flat().filter(Boolean);
}

let chain: Promise<void> = Promise.resolve();

/** Every group match over: put the qualifiers into the playoffs (once; safe to call again). */
export function advanceGroupsTournament(tournamentId: number): Promise<void> {
  chain = chain
    .then(() => advanceOnce(tournamentId))
    .catch((error) => {
      log.error('[GROUPS] Could not start the playoffs', error as Error, { tournamentId });
    });
  return chain;
}

async function advanceOnce(tournamentId: number): Promise<void> {
  const tournament = await db.queryOneAsync<DbTournamentRow>(
    'SELECT * FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (!tournament || tournament.type !== 'groups') return;
  const groups = await groupStandings(tournamentId);
  if (groups.length === 0 || groups.some((g) => !g.done)) return;
  const slots = await db.queryAsync<
    DbMatchRow & { team1_seed: number | null; team2_seed: number | null }
  >(
    `SELECT * FROM matches WHERE tournament_id = ? AND (team1_seed IS NOT NULL OR team2_seed IS NOT NULL)`,
    [tournamentId]
  );
  if (slots.length === 0 || slots.some((s) => s.team1_id || s.team2_id)) return; // filled already
  const response = tournamentRowToResponse(tournament);
  const g = groupsSettingsOf(response);
  const seeds = seedPlayoffs(
    groups,
    g.advancePerGroup,
    playoffSize(g.groupCount, g.advancePerGroup)
  );
  const filled: DbMatchRow[] = [];
  for (const slot of slots) {
    const team1 = slot.team1_seed ? (seeds[slot.team1_seed - 1] ?? null) : null;
    const team2 = slot.team2_seed ? (seeds[slot.team2_seed - 1] ?? null) : null;
    const claimed = await db.queryAsync<{ id: number }>(
      `UPDATE matches SET team1_id = ?, team2_id = ?
        WHERE id = ? AND team1_id IS NULL AND team2_id IS NULL RETURNING id`,
      [team1, team2, slot.id]
    );
    if (!claimed.length) continue;
    const config = await buildMatchConfigFor(
      {
        slug: slot.slug,
        id: slot.id,
        game: slot.game,
        round: slot.round,
        bracket: slot.bracket ?? null,
        team1Id: team1,
        team2Id: team2,
      },
      { ...response, format: g.playoffFormat }
    );
    await db.updateAsync('matches', { config: serializeMatchConfig(config) }, 'id = ?', [slot.id]);
    const fresh = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      slot.id,
    ]);
    if (fresh) filled.push(fresh);
  }
  log.success(`[GROUPS] Playoffs drawn for tournament ${tournamentId}: ${seeds.join(', ')}`);
  emitBracketUpdate({ action: 'round_advanced', tournamentId });
  setImmediate(() => {
    void (async () => {
      const { makeMatchReady } = await import('../utils/matchProgression');
      for (const match of filled) {
        if (match.team1_id && match.team2_id) await makeMatchReady(match).catch(() => undefined);
      }
    })();
  });
}
