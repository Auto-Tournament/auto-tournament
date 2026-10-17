import { test, expect } from '@playwright/test';
import { StandardBracketGenerator } from '../../api/src/services/standardBracketGenerator';
import type { TournamentResponse } from '../../api/src/types/tournament.types';

/**
 * Double elimination: upper-bracket losers drop into the lower bracket
 * crossed over (Vikunja 2181), so they do not meet a team they already played
 * in the upper bracket.
 *
 * Pure: generates 8- and 16-team brackets, plays them out (favourites win, and
 * seeded random results), and checks every lower-bracket round that takes
 * upper-bracket drop-ins. The round fed by the upper-bracket final has a
 * single match, so a rematch there cannot be avoided and is not checked.
 *
 * @tag api
 * @tag regression
 */

type Generated = {
  slug: string;
  bracket?: string;
  round: number;
  team1Id: string | null;
  team2Id: string | null;
  team1FromMatchSlug?: string | null;
  team1FromOutcome?: 'winner' | 'loser' | null;
  team2FromMatchSlug?: string | null;
  team2FromOutcome?: 'winner' | 'loser' | null;
};

/** Team ids in bracket seat order: adjacent seats (`natural`), or seed 1 v N, 4 v 5, ... */
function seats(n: number, seeding: 'natural' | 'bracket'): string[] {
  if (seeding === 'natural') return Array.from({ length: n }, (_, i) => `t${i + 1}`);
  let positions = [1, 2];
  while (positions.length < n) {
    const size = positions.length * 2;
    positions = positions.flatMap((p) => [p, size + 1 - p]);
  }
  return positions.map((p) => `t${p}`);
}

async function generate(
  n: number,
  seeding: 'natural' | 'bracket' = 'natural'
): Promise<Generated[]> {
  const teamIds = seats(n, seeding);
  const tournament = {
    name: 'crossover',
    type: 'double_elimination',
    format: 'bo1',
    teamIds,
    settings: { grandFinalMode: 'simple', seedingMethod: 'manual' },
  } as unknown as TournamentResponse;
  const { matches } = await new StandardBracketGenerator().generate(tournament);
  return matches as unknown as Generated[];
}

/** Lower team number = favourite. */
const strength = (team: string) => Number(team.slice(1));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Played = { slug: string; bracket: string; round: number; a: string; b: string };

/** Play the bracket through its slot wiring; returns every match with its two teams. */
function playOut(matches: Generated[], pick: (a: string, b: string) => string): Played[] {
  const result = new Map<string, { winner: string; loser: string }>();
  const played: Played[] = [];
  const slotTeam = (team: string | null, from?: string | null, outcome?: string | null) => {
    if (team) return team;
    if (!from) return null;
    const r = result.get(from);
    return r ? (outcome === 'loser' ? r.loser : r.winner) : null;
  };
  while (result.size < matches.length) {
    let progressed = false;
    for (const m of matches) {
      if (result.has(m.slug)) continue;
      const a = slotTeam(m.team1Id, m.team1FromMatchSlug, m.team1FromOutcome);
      const b = slotTeam(m.team2Id, m.team2FromMatchSlug, m.team2FromOutcome);
      if (!a || !b) continue;
      const winner = pick(a, b);
      result.set(m.slug, { winner, loser: winner === a ? b : a });
      played.push({ slug: m.slug, bracket: m.bracket ?? '', round: m.round, a, b });
      progressed = true;
    }
    if (!progressed) throw new Error(`bracket stuck after ${[...result.keys()].join(', ')}`);
  }
  return played;
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** Lower-bracket drop-in matches that are a rematch of an upper-bracket match. */
function dropInRematches(matches: Generated[], played: Played[]): string[] {
  const wbPairs = new Set(played.filter((p) => p.bracket === 'WB').map((p) => pairKey(p.a, p.b)));
  const lbRoundSize = new Map<number, number>();
  for (const m of matches) {
    if (m.bracket === 'LB') lbRoundSize.set(m.round, (lbRoundSize.get(m.round) ?? 0) + 1);
  }
  const dropIn = new Set(
    matches
      .filter((m) => m.bracket === 'LB' && m.round > 1 && m.team2FromOutcome === 'loser')
      .map((m) => m.slug)
  );
  return played
    .filter((p) => dropIn.has(p.slug) && (lbRoundSize.get(p.round) ?? 0) > 1)
    .filter((p) => wbPairs.has(pairKey(p.a, p.b)))
    .map((p) => `${p.slug}: ${p.a} vs ${p.b}`);
}

test.describe('Double elimination drop-in crossover (pure)', () => {
  for (const n of [8, 16]) {
    test(`${n} teams: every upper-bracket loser drops in exactly once`, async () => {
      const matches = await generate(n);
      const loserSources = matches
        .filter((m) => m.bracket === 'LB')
        .flatMap((m) => [
          m.team1FromOutcome === 'loser' ? m.team1FromMatchSlug : null,
          m.team2FromOutcome === 'loser' ? m.team2FromMatchSlug : null,
        ])
        .filter(Boolean);
      // The WB final's loser goes to the last LB round; every other WB match feeds one LB slot.
      const wbSlugs = matches.filter((m) => m.bracket === 'WB').map((m) => m.slug);
      expect([...loserSources].sort()).toEqual([...wbSlugs].sort());
    });

    for (const seeding of ['natural', 'bracket'] as const) {
      test(`${n} teams, ${seeding} seeding, favourites win: no rematch where a team drops in`, async () => {
        const matches = await generate(n, seeding);
        const played = playOut(matches, (a, b) => (strength(a) < strength(b) ? a : b));
        expect(dropInRematches(matches, played)).toEqual([]);
      });
    }

    test(`${n} teams, random results: no rematch where a team drops in`, async () => {
      const matches = await generate(n);
      for (let seed = 1; seed <= 300; seed++) {
        const rnd = mulberry32(seed);
        const played = playOut(matches, (a, b) => (rnd() < 0.5 ? a : b));
        expect(dropInRematches(matches, played), `seed ${seed}`).toEqual([]);
      }
    });
  }
});
